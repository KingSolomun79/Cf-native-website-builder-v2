// SIMPLE design pipeline end-to-end (experiment spec sections 8-9, 37, 48,
// 49-54, 59, 70, 72): one REFERENCE_BOUND Build through the REAL pipeline
// seam (runBuildPipeline → simple branch) with only the provider seams
// scripted. Proves: first-pass RELEASE_READY, the ONE repair creating a new
// immutable Build Version, terminal HUMAN_REVIEW_REQUIRED after a failed
// final QA, blueprint gate escalation, NO legacy design-stage invocation, and
// no automatic publication.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { getObject } from "../src/lib/assets";
import { buildVersionRoot } from "../src/domain/artifact-keys";
import { createSimpleScripts, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS, simpleBlueprintFixture } from "./helpers/simple-scripts";
import { validateDesignBlueprint } from "../src/simple-design/contracts";

const env = providedEnv as unknown as Env;

// SIMPLE suites opt in explicitly: wrangler.test.jsonc pins legacy_v2 so the
// ~60 legacy suites keep testing the legacy chain; this env spread flips the
// experiment selector for the simple branch only.
const simpleEnv = { ...env, DESIGN_PIPELINE_VERSION: "simple_blueprint_v1" } as unknown as Env;

async function startGeneration(screenshotKey: string): Promise<string> {
  await persistSimpleScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: {
        businessName: SIMPLE_SCRIPTS_BUSINESS,
        contactEmail: "ops@rankforge.example",
        businessType: "SEO agency",
        businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
      },
      reference: { screenshotR2Key: screenshotKey, url: "https://reference.example.com/" },
    },
  });
  return started.siteGenerationId;
}

const LEGACY_AI_STAGES = [
  "reference-analyzer",
  "visual-blueprint-generator",
  "website-generator",
  "kie-image-prompt-generator",
  "qa-a-visual-content",
  "qa-b-browser-technical",
  "fix-coordinator",
  "qa-a-confirmation",
  "qa-b-confirmation",
  "release-blocker-fix",
  "realization-repair",
];

describe("SIMPLE pipeline end-to-end (experiment/simplified-design-pipeline)", () => {
  it("first-pass success: blueprint → images → build → QA → RELEASE_READY with NO repair", async () => {
    const siteGenerationId = await startGeneration("references/simple/happy.png");
    const outcome = await runBuildPipeline(simpleEnv, { siteGenerationId, deps: createSimpleScripts() });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.reasons).toEqual([]);
    expect(outcome.repairApplied).toBe(false);
    expect(outcome.builderStrategy).toBe("ONE_CALL");
    expect(outcome.designBlueprintR2Key).toBeTruthy();

    // Release Ready pinned on the exact first Build Version.
    const release = await env.DB.prepare("SELECT build_version_id FROM build_release_records WHERE build_version_id = ?")
      .bind(outcome.releaseReadyBuildVersionId)
      .first();
    expect(release).not.toBeNull();

    // Design Blueprint artifact + human-readable markdown exist.
    const blueprintArtifact = await env.DB.prepare(
      "SELECT kind FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'design_blueprint'"
    )
      .bind(outcome.releaseReadyBuildVersionId)
      .first();
    expect(blueprintArtifact).not.toBeNull();
    const markdown = await getObject(env, `${buildVersionRoot(outcome.buildId, 1)}/design-blueprint/DESIGN-BLUEPRINT.md`);
    expect(markdown).not.toBeNull();

    // qa-package stored with the passing verdict.
    const qaPackage = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'qa_package'"
    )
      .bind(outcome.releaseReadyBuildVersionId)
      .first<{ artifact_r2_key: string }>();
    expect(qaPackage).not.toBeNull();
    const pkg = JSON.parse(await new Response(await getObject(env, qaPackage!.artifact_r2_key)).text());
    expect(pkg.releaseReady).toBe(true);
    expect(pkg.truth.blockerCount).toBe(0);
    expect(pkg.technical.blockerCount).toBe(0);
    expect(pkg.visual.scores.overall).toBeGreaterThanOrEqual(90);

    // NO repair version exists (v1 only).
    const versions = await env.DB.prepare("SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(outcome.buildId)
      .all<{ version_number: number }>();
    expect(versions.results.map((v) => v.version_number)).toEqual([1]);

    // NO legacy AI stage ran (spec section 70).
    const legacyStages = await env.DB.prepare(
      `SELECT DISTINCT stage FROM ai_stage_runs WHERE build_id = ? AND stage IN (${LEGACY_AI_STAGES.map(() => "?").join(",")})`
    )
      .bind(outcome.buildId, ...LEGACY_AI_STAGES)
      .all();
    expect(legacyStages.results).toEqual([]);

    // The SIMPLE stages that DID run used the canonical model.
    const models = await env.DB.prepare("SELECT DISTINCT model FROM ai_stage_runs WHERE build_id = ?")
      .bind(outcome.buildId)
      .all<{ model: string }>();
    expect(models.results).toEqual([{ model: "glm-5.3-flash" }]);
  });

  it("ONE repair: failed first QA → new immutable Build Version v2 → final QA RELEASE_READY", async () => {
    const siteGenerationId = await startGeneration("references/simple/repair.png");
    const outcome = await runBuildPipeline(simpleEnv, {
      siteGenerationId,
      deps: createSimpleScripts({ firstVisualQaFails: true }),
    });

    expect({ terminal: outcome.terminal, reasons: outcome.reasons }).toEqual({ terminal: "RELEASE_READY", reasons: [] });
    expect(outcome.repairApplied).toBe(true);

    // The repair produced a NEW immutable Build Version carrying the release.
    const versions = await env.DB.prepare("SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(outcome.buildId)
      .all<{ id: string; version_number: number }>();
    expect(versions.results.map((v) => v.version_number)).toEqual([1, 2]);
    expect(outcome.releaseReadyBuildVersionId).toBe(versions.results[1].id);

    // The repair script enforces max ONE call (throws on a second invocation).
    // v1 keeps its failing qa_package; v2 carries the passing one.
    const pkgVersions = await env.DB.prepare(
      "SELECT build_version_id FROM build_stage_artifacts WHERE build_id = ? AND kind = 'qa_package' ORDER BY build_version_id"
    )
      .bind(outcome.buildId)
      .all<{ build_version_id: string }>();
    expect(pkgVersions.results.length).toBe(2);

    // Accepted Images were reused, not re-spent: attempt count unchanged by repair.
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    const acceptedV1 = await env.DB.prepare("SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?")
      .bind(versions.results[0].id)
      .first<{ n: number }>();
    const acceptedV2 = await env.DB.prepare("SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?")
      .bind(versions.results[1].id)
      .first<{ n: number }>();
    expect(acceptedV2?.n).toBe(acceptedV1?.n);
    expect(Number(attempts?.n ?? 0)).toBeGreaterThan(0);
  });

  it("final QA still failing after the ONE repair → HUMAN_REVIEW_REQUIRED, no second repair", async () => {
    const siteGenerationId = await startGeneration("references/simple/still-failing.png");
    const outcome = await runBuildPipeline(simpleEnv, {
      siteGenerationId,
      deps: createSimpleScripts({ allVisualQaFails: true }),
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.repairApplied).toBe(true);

    const build = await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(outcome.buildId).first<{ state: string }>();
    expect(build?.state).toBe("HUMAN_REVIEW_REQUIRED");

    // Exactly two versions; no release record anywhere.
    const versions = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(versions?.n).toBe(2);
    const records = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_release_records WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(records?.n).toBe(0);
  });

  it("blueprint that fails the deterministic quality gate escalates to HUMAN_REVIEW_REQUIRED without generating images or a site", async () => {
    const siteGenerationId = await startGeneration("references/simple/gate-fail.png");
    const outcome = await runBuildPipeline(simpleEnv, {
      siteGenerationId,
      deps: createSimpleScripts({ blueprintFailsGate: true }),
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons[0]).toContain("DESIGN_BLUEPRINT_REVIEW_REQUIRED");

    // No images burned, no site bundle, no builder call.
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(attempts?.n).toBe(0);
    const bundles = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_id = ? AND kind = 'site_bundle'")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(bundles?.n).toBe(0);
  });

  it("does not auto-publish: preview deployment only, no published deployment rows", async () => {
    const siteGenerationId = await startGeneration("references/simple/no-publish.png");
    const outcome = await runBuildPipeline(simpleEnv, { siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const roles = await env.DB.prepare("SELECT DISTINCT role FROM build_deployments WHERE build_id = ?")
      .bind(outcome.buildId)
      .all<{ role: string }>();
    expect(roles.results.map((r) => r.role)).toEqual(["preview"]);
    const build = await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(outcome.buildId).first<{ state: string }>();
    expect(build?.state).toBe("RELEASE_READY");
  });

  it("legacy_v2 env still routes the legacy chain (A/B selector works)", async () => {
    const siteGenerationId = await startGeneration("references/simple/legacy-route.png");
    // Run with the UNTOUCHED test env (legacy_v2) and the LEGACY scripted deps.
    const { createPipelineScripts, persistPipelineScreenshot } = await import("./helpers/pipeline-scripts");
    await persistPipelineScreenshot(env, "references/simple/legacy-route-ref.png");
    const legacyStarted = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/simple/legacy-route-ref.png", url: "https://meridian-atelier.example.com/" },
      },
    });
    const legacyOutcome = await runBuildPipeline(env, { siteGenerationId: legacyStarted.siteGenerationId, deps: createPipelineScripts() });
    expect(legacyOutcome.terminal).toBe("RELEASE_READY");
    // Legacy chain produced a legacy Visual Blueprint artifact, not a SIMPLE one.
    const simpleBlueprint = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_id = ? AND kind = 'design_blueprint'"
    )
      .bind(legacyOutcome.buildId)
      .first<{ n: number }>();
    expect(simpleBlueprint?.n).toBe(0);
    void siteGenerationId;
  });

  it("the fixture blueprint itself satisfies the runtime schema gate", () => {
    const validated = validateDesignBlueprint(simpleBlueprintFixture());
    expect(validated.valid).toBe(true);
  });
});
