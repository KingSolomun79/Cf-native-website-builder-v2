import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { getObject } from "../src/lib/assets";
import { buildVersionSourceKey } from "../src/domain/artifact-keys";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

// Production build-pipeline wiring (issue #30): one REFERENCE_BOUND Build from
// Onboarding Submission through Release Ready through the REAL supported
// interfaces — only the provider seams (generate, image provider, preview
// deployer, QA capture) are the deterministic shared scripts. Proves the
// platform Form Service endpoint comes from PUBLIC_APP_URL (no placeholder
// default), the KIE spend-resume filter, and the bounded repair loop creating
// a new immutable Build Version that reaches Release Ready.

const env = providedEnv as unknown as Env;

async function startGeneration(screenshotKey: string): Promise<string> {
  await persistPipelineScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      // Screenshot+URL: issue #39 makes dimensions-only evidence INSUFFICIENT,
      // so pipeline fixtures carry a measured reference capture (see
      // createPipelineScripts' capture seam).
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

describe("production build pipeline (issue #30 wiring)", () => {
  it("runs one REFERENCE_BOUND Build to Release Ready through the real interfaces", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/happy.png");
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createPipelineScripts() });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.reasons).toEqual([]);
    expect(outcome.releaseReadyBuildVersionId).toBeTruthy();
    expect(outcome.artifactManifestHash).toBeTruthy();
    expect(outcome.previewUrl).toContain(".workers.dev");

    // Build state reached RELEASE_READY and the release record pins the version.
    const build = await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(outcome.buildId).first<{ state: string }>();
    expect(build?.state).toBe("RELEASE_READY");
    const release = await env.DB.prepare("SELECT build_version_id FROM build_release_records WHERE build_version_id = ?")
      .bind(outcome.releaseReadyBuildVersionId).first();
    expect(release).not.toBeNull();

    // The generated Contact form posts to the PLATFORM Form Service endpoint
    // (PUBLIC_APP_URL), never the placeholder default.
    const contactBody = await getObject(env, buildVersionSourceKey(outcome.buildId, 1, "contact.html"));
    expect(contactBody).not.toBeNull();
    const contact = await new Response(contactBody).text();
    expect(contact).toContain(`action="https://test.example.com/api/v2/forms/submit"`);
    expect(contact).not.toContain("forms.wazibiz.example");

    // Every AI stage recorded provenance with the canonical model seam output.
    const provenance = await env.DB.prepare(
      "SELECT DISTINCT model FROM ai_stage_runs WHERE build_id = ?"
    ).bind(outcome.buildId).all<{ model: string }>();
    expect(provenance.results).toEqual([{ model: "glm-5.3-flash" }]);

    // Images were generated within budget and persisted project-controlled.
    const spend = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd),0) AS spent FROM image_attempts WHERE build_id = ?")
      .bind(outcome.buildId).first<{ spent: number }>();
    expect(Number(spend?.spent ?? 0)).toBeLessThanOrEqual(3.0);
    const accepted = await env.DB.prepare("SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?")
      .bind(outcome.releaseReadyBuildVersionId).first<{ n: number }>();
    expect(accepted?.n).toBeGreaterThanOrEqual(7);
  });

  it("runs the bounded repair loop: failed QA -> new immutable Build Version -> Release Ready", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/repair.png");
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: createPipelineScripts({ firstQaAFails: true }),
    });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.repairApplied).toBe(true);

    // The repaired candidate is a NEW immutable Build Version (v2) and it —
    // not v1 — carries the Release Ready record.
    const versions = await env.DB.prepare(
      "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
    ).bind(outcome.buildId).all<{ id: string; version_number: number }>();
    expect(versions.results.map((version) => version.version_number)).toEqual([1, 2]);
    expect(outcome.releaseReadyBuildVersionId).toBe(versions.results[1].id);

    // Exactly one Fix Coordinator batch; v1 kept its (failed) QA evidence.
    const batches = await env.DB.prepare(
      "SELECT kind FROM repair_batches WHERE build_id = ?"
    ).bind(outcome.buildId).all<{ kind: string }>();
    expect(batches.results).toEqual([{ kind: "fix_coordinator" }]);

    // Repair reused the persisted Accepted Images instead of re-spending KIE.
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?"
    ).bind(outcome.buildId).first<{ n: number }>();
    const firstVersionAccepted = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?"
    ).bind(versions.results[0].id).first<{ n: number }>();
    expect(attempts?.n).toBe(firstVersionAccepted?.n);
  });

  it("confirmation resolution notes are not counted as active Release Blockers (issue #38)", async () => {
    // Production defect (build bbe8c8f9 v3): the repaired candidate was clean,
    // but confirmation QA re-reported the fixed P1 — original severity
    // retained — and the resolver counted the resolution note as an active
    // blocker, driving a factually clean candidate to HUMAN_REVIEW_REQUIRED.
    const siteGenerationId = await startGeneration("references/pipeline/resolved-note.png");
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: createPipelineScripts({ firstQaAFails: true, confirmationQaEmitsResolvedNote: true }),
    });

    // The RESOLVED note must not consume the Release Blocker Fix budget.
    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.reasons).toEqual([]);
    expect(outcome.repairApplied).toBe(true);

    const versions = await env.DB.prepare(
      "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
    ).bind(outcome.buildId).all<{ id: string; version_number: number }>();
    expect(versions.results.map((version) => version.version_number)).toEqual([1, 2]);
    expect(outcome.releaseReadyBuildVersionId).toBe(versions.results[1].id);

    // Exactly one Fix Coordinator batch — no Release Blocker Fix was burned
    // on a resolution note, and the Release Ready record pins the repaired v2.
    const batches = await env.DB.prepare(
      "SELECT kind FROM repair_batches WHERE build_id = ?"
    ).bind(outcome.buildId).all<{ kind: string }>();
    expect(batches.results).toEqual([{ kind: "fix_coordinator" }]);
    const release = await env.DB.prepare(
      "SELECT build_version_id FROM build_release_records WHERE build_version_id = ?"
    ).bind(outcome.releaseReadyBuildVersionId!).first();
    expect(release).not.toBeNull();
  });
});
