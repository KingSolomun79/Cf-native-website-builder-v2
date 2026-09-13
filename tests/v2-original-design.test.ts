import { canonicalStructuredFacts } from "./helpers/canonical-facts";
// ORIGINAL_DESIGN Site Generation (issue #24): the SAME SIMPLE downstream
// pipeline as REFERENCE_BOUND — only the Blueprint inputs/prompt and the
// Visual QA authority/prompt diverge. Reference-only stages are SKIPPED, never
// faked; no fallback exists in either direction; the creative direction rides
// the immutable Onboarding Submission with checksum coverage.
//
// Provider seams are scripted (tests/helpers/simple-scripts) — the SAME
// deterministic fixtures answer both modes, proving schema and stage reuse.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild, getSiteGenerationView } from "../src/domain/lifecycle";
import { createRevisionBuild } from "../src/domain/revision";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { validateOnboardingSubmissionPayload } from "../src/domain/lifecycle-schema";
import { creativeDirectionChecksum, parseCreativeDirection } from "../src/domain/creative-direction";
import { runSimpleVisualQaStage } from "../src/simple-design/visual-qa";
import { validateDesignBlueprintV2 } from "../src/simple-design/contracts";
import { getObject, putObject } from "../src/lib/assets";
import { buildDecodableSolidPng } from "./helpers/png";
import { createSimpleScripts, simpleBlueprintFixture } from "./helpers/simple-scripts";

const env = providedEnv as unknown as Env;

const CREATIVE_DIRECTION = {
  direction: "Sun-baked editorial minimalism: warm plaster surfaces, oversized serif display type, close-crop photography breaking the container edge",
  audience: "Design-conscious homeowners planning full renovations",
  conversionGoal: "Project enquiries",
  preferredPalette: "Terracotta #C4552D on warm off-white #F7F2EA, ink #26201B",
  tone: "Calm, assured, craft-led",
  avoidances: "No generic three-card feature rows, no purple gradients",
};

function originalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildMode: "ORIGINAL_DESIGN",
    facts: {
      businessName: "Terra & Beam Studio",
      contactEmail: "studio@terrabeam.example",
      businessType: "Architecture and interior renovation studio",
      businessDescription: "A small studio designing warm, modern renovations for family homes.",
    ...(canonicalStructuredFacts())},
    creativeDirection: CREATIVE_DIRECTION,
    ...overrides,
  };
}

async function startOriginalGeneration(overrides: Record<string, unknown> = {}): Promise<{
  siteGenerationId: string;
  buildMode: string;
}> {
  const started = await startSiteGeneration(env, { payload: originalPayload(overrides) });
  return { siteGenerationId: started.siteGenerationId, buildMode: started.buildMode };
}

const LEGACY_DESIGN_STAGES = [
  "reference-analyzer",
  "visual-blueprint-generator",
  "website-generator",
  "fix-coordinator",
];

describe("ORIGINAL_DESIGN onboarding input authority (issue #24)", () => {
  it("accepts a fresh ORIGINAL_DESIGN submission with NO Reference and freezes the creative direction into the immutable payload", async () => {
    const started = await startOriginalGeneration();
    expect(started.buildMode).toBe("ORIGINAL_DESIGN");

    const view = await getSiteGenerationView(env, started.siteGenerationId);
    expect(view!.submission.reference).toBeNull();
    expect(view!.submission.creativeDirection).toEqual(CREATIVE_DIRECTION);
    expect(view!.submission.buildMode).toBe("ORIGINAL_DESIGN");
  });

  it("REJECTS an ORIGINAL_DESIGN submission that supplies a Reference — the mode must never behave as Reference-bound", () => {
    const invalid = validateOnboardingSubmissionPayload(
      originalPayload({ reference: { url: "https://reference.example.com/" } })
    );
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues.some((issue) => issue.path === "$.reference")).toBe(true);
    }
  });

  it("REJECTS an ORIGINAL_DESIGN submission without creativeDirection — it is the design-intent authority", () => {
    const payload = originalPayload();
    delete (payload as Record<string, unknown>).creativeDirection;
    const invalid = validateOnboardingSubmissionPayload(payload);
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues.some((issue) => issue.path === "$.creativeDirection")).toBe(true);
    }
  });

  it("REJECTS creativeDirection on a REFERENCE_BOUND submission — design-origin inputs never leak across modes", () => {
    const invalid = validateOnboardingSubmissionPayload({
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Roasters", contactEmail: "hello@rift.example" , ...(canonicalStructuredFacts()) },
      reference: { url: "https://reference.example.com/" },
      creativeDirection: { direction: "should not be allowed here" },
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues.some((issue) => issue.path === "$.creativeDirection")).toBe(true);
    }
  });

  it("REFERENCE_BOUND still requires Reference authority (unchanged)", () => {
    const invalid = validateOnboardingSubmissionPayload({
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Roasters", contactEmail: "hello@rift.example" , ...(canonicalStructuredFacts()) },
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues.some((issue) => issue.path === "$.reference")).toBe(true);
    }
  });
});

describe("ORIGINAL_DESIGN pipeline (SAME downstream, Reference stages skipped)", () => {
  it("runs intake-free to first-pass RELEASE_READY on the SAME blueprint schema, builder, images and release machinery", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createSimpleScripts() });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.reasons).toEqual([]);
    expect(outcome.repairApplied).toBe(false);
    // SAME Builder implementation.
    expect(outcome.builderStrategy).toBe("SIX_CALL_FILE_REALIZATION");

    // SAME DesignBlueprintV2 schema (design-blueprint/2), validated.
    const stored = await validateDesignBlueprintV2(simpleBlueprintFixture());
    expect(stored.valid).toBe(true);
    const blueprintArtifact = await env.DB.prepare(
      "SELECT schema_version, artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'design_blueprint'"
    )
      .bind(outcome.releaseReadyBuildVersionId!)
      .first<{ schema_version: string; artifact_r2_key: string }>();
    expect(blueprintArtifact!.schema_version).toBe("design-blueprint/2");
    expect(await getObject(env, blueprintArtifact!.artifact_r2_key)).not.toBeNull();

    // SAME image materialization: the four deterministic page heroes are
    // CRITICAL accepted images.
    const heroes = await env.DB.prepare(
      `SELECT slot_id FROM accepted_images WHERE build_version_id = ? AND slot_id IN ('home-hero','about-hero','services-hero','contact-hero')`
    )
      .bind(outcome.releaseReadyBuildVersionId!)
      .all<{ slot_id: string }>();
    expect(heroes.results.length).toBe(4);

    // SAME release machinery: a release record exists for exactly version 1.
    const release = await env.DB.prepare(
      "SELECT build_version_id FROM build_release_records WHERE build_version_id = ?"
    )
      .bind(outcome.releaseReadyBuildVersionId!)
      .first();
    expect(release).not.toBeNull();
    const versions = await env.DB.prepare("SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(outcome.buildId)
      .all<{ version_number: number }>();
    expect(versions.results.map((v) => v.version_number)).toEqual([1]);
  });

  it("skips the Reference stages entirely — no intake event, no Reference artifacts, provenance records NOT_APPLICABLE", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const events = await env.DB.prepare(
      "SELECT stage, detail, from_state FROM build_workflow_events WHERE build_id = ?"
    )
      .bind(outcome.buildId)
      .all<{ stage: string; detail: string | null; from_state: string | null }>();
    const stages = events.results.map((event) => event.stage);
    // NO Reference capture ran.
    expect(stages).not.toContain("simple_reference_capture");
    // The ORIGINAL_DESIGN intake provenance event recorded the NOT_APPLICABLE
    // reference evidence and the creative-direction identity (GO §30).
    const intake = events.results.find((event) => event.stage === "original_design_intake");
    expect(intake).toBeDefined();
    expect(intake!.detail).toContain("buildMode=ORIGINAL_DESIGN");
    expect(intake!.detail).toContain("referenceEvidence=NOT_APPLICABLE");
    expect(intake!.from_state).toBe("INTAKE_READY");

    // No Reference screenshot artifacts were fabricated.
    const referenceArtifacts = await env.DB.prepare(
      `SELECT kind FROM build_stage_artifacts WHERE build_id = ? AND kind LIKE '%reference%'`
    )
      .bind(outcome.buildId)
      .all();
    expect(referenceArtifacts.results).toEqual([]);
  });

  it("runs the ORIGINAL_DESIGN prompt variants — recorded in ai_stage_runs with the canonical prompt ids", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const stages = await env.DB.prepare(
      "SELECT DISTINCT stage, prompt_id, prompt_version, schema_version FROM ai_stage_runs WHERE build_id = ?"
    )
      .bind(outcome.buildId)
      .all<{ stage: string; prompt_id: string; prompt_version: string; schema_version: string }>();
    const byStage = new Map(stages.results.map((row) => [row.stage, row]));

    const blueprint = byStage.get("simple-original-design-blueprint");
    expect(blueprint).toBeDefined();
    expect(blueprint!.prompt_id).toBe("simple-original-design-blueprint");
    expect(blueprint!.prompt_version).toBe("v1");
    expect(blueprint!.schema_version).toBe("design-blueprint/2");

    const visualQa = byStage.get("simple-original-design-visual-qa");
    expect(visualQa).toBeDefined();
    expect(visualQa!.prompt_id).toBe("simple-original-design-visual-qa");
    expect(visualQa!.prompt_version).toBe("v1");

    // SAME shared downstream stages.
    expect(byStage.get("simple-website-builder")).toBeDefined();
    expect(byStage.get("simple-visual-qa")).toBeUndefined();
    expect(byStage.get("simple-design-blueprint")).toBeUndefined();

    // NO legacy design stage ran.
    const legacy = await env.DB.prepare(
      `SELECT DISTINCT stage FROM ai_stage_runs WHERE build_id = ? AND stage IN (${LEGACY_DESIGN_STAGES.map(() => "?").join(",")})`
    )
      .bind(outcome.buildId, ...LEGACY_DESIGN_STAGES)
      .all();
    expect(legacy.results).toEqual([]);
  });

  it("records NO Reference screenshot identity in the qa-package (null, never fake)", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const row = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'qa_package'"
    )
      .bind(outcome.releaseReadyBuildVersionId!)
      .first<{ artifact_r2_key: string }>();
    const pkg = JSON.parse(await new Response(await getObject(env, row!.artifact_r2_key)).text()) as {
      referenceScreenshotKeys: { desktop: string } | null;
      visual: { scores: { overall: number } } | null;
    };
    expect(pkg.referenceScreenshotKeys).toBeNull();
    expect(pkg.visual!.scores.overall).toBeGreaterThanOrEqual(90);
  });

  it("the creative direction is provenance-immutable: the checksum covers the frozen input and lands in provenance", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const checksum = await creativeDirectionChecksum(parseCreativeDirection(CREATIVE_DIRECTION)!);
    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const intake = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'original_design_intake'"
    )
      .bind(outcome.buildId)
      .first<{ detail: string }>();
    expect(intake!.detail).toContain(`creativeDirectionSha256=${checksum}`);

    // The immutable submission payload still carries the exact creative
    // direction (frozen before any Build existed).
    const submission = await env.DB.prepare(
      `SELECT o.payload_json FROM onboarding_submissions o
       JOIN site_generations g ON g.onboarding_submission_id = o.id WHERE g.id = ?`
    )
      .bind(siteGenerationId)
      .first<{ payload_json: string }>();
    const payload = JSON.parse(submission!.payload_json) as { creativeDirection: unknown };
    expect(await creativeDirectionChecksum(parseCreativeDirection(payload.creativeDirection)!)).toBe(checksum);
  });

  it("the ONE repair is the SAME architecture: a failing first QA creates Build Version 2 and re-evaluates with Original Visual QA", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: createSimpleScripts({ firstVisualQaFails: true }),
    });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.repairApplied).toBe(true);
    expect(outcome.releaseReadyBuildVersionId).toBeTruthy();

    const versions = await env.DB.prepare("SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(outcome.buildId)
      .all<{ version_number: number }>();
    expect(versions.results.map((v) => v.version_number)).toEqual([1, 2]);

    // Exactly one repair stage ran, on the SAME shared stage id.
    const repairs = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-site-repair'"
    )
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(repairs!.n).toBe(1);
    // Two Original Visual QA evaluations (initial + repaired re-evaluation).
    const qaRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-original-design-visual-qa'"
    )
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(qaRuns!.n).toBe(2);
  });

  it("NO fallback: a blueprint that fails the deterministic gate escalates to HUMAN_REVIEW_REQUIRED in ORIGINAL_DESIGN — never a mode switch or Reference generation", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: createSimpleScripts({ blueprintFailsGate: true }),
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    // The escalation reason is the deterministic blueprint gate boundary
    // (schema/gate ordering matches the REFERENCE_BOUND pipeline's behavior
    // for the same broken output — see v2-simple-pipeline).
    expect(outcome.reasons[0]).toContain("DESIGN_BLUEPRINT_REVIEW_REQUIRED");

    // Only the intake provenance event exists — no Reference stages were
    // invoked as a fallback.
    const events = await env.DB.prepare("SELECT stage FROM build_workflow_events WHERE build_id = ?")
      .bind(outcome.buildId)
      .all<{ stage: string }>();
    expect(events.results.map((event) => event.stage)).not.toContain("simple_reference_capture");

    const generationMode = await env.DB.prepare("SELECT build_mode FROM site_generations WHERE id = ?")
      .bind(siteGenerationId)
      .first<{ build_mode: string }>();
    expect(generationMode!.build_mode).toBe("ORIGINAL_DESIGN");
  });
});

describe("ORIGINAL_DESIGN lifecycle parity (issue #24)", () => {
  it("createInitialBuild accepts ORIGINAL_DESIGN — the deferred-mode lock is gone from the active path", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const created = await createInitialBuild(env, { siteGenerationId });
    expect(created.buildVersionNumber).toBe(1);
  });

  it("a Revision Request on an ORIGINAL_DESIGN lineage creates a new Build in the SAME mode — no 423, no mode change", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: {} } },
    });
    expect(revision.buildId).not.toBe(initial.buildId);

    const revisionRow = await env.DB.prepare(
      `SELECT g.build_mode FROM builds b JOIN site_generations g ON g.id = b.site_generation_id WHERE b.id = ?`
    )
      .bind(revision.buildId)
      .first<{ build_mode: string }>();
    expect(revisionRow!.build_mode).toBe("ORIGINAL_DESIGN");
  });

  it("changing Build Mode on the same Site starts a fresh Site Generation with a fresh submission (existing domain semantics)", async () => {
    const first = await startSiteGeneration(env, { payload: originalPayload() });
    const second = await startSiteGeneration(env, {
      siteId: first.siteId,
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: originalPayload().facts,
        reference: { url: "https://reference.example.com/" },
      },
    });
    expect(second.sequenceNumber).toBe(2);
    const view = await getSiteGenerationView(env, first.siteGenerationId);
    expect(view!.siteGeneration.buildMode).toBe("ORIGINAL_DESIGN");
    expect(view!.submission.checksum).toBeTruthy();
  });
});

describe("visual QA mode boundary (issue #24)", () => {
  it("Original visual QA evaluates candidate renders WITHOUT any Reference input", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    const candidateKey = "candidates/original/desktop.png";
    await putObject(env, candidateKey, await buildDecodableSolidPng(1440, 3200));

    const { report } = await runSimpleVisualQaStage(env, {
      siteGenerationId,
      buildId: initial.buildId,
      buildVersionId: initial.buildVersionId,
      buildVersionNumber: 1,
      blueprint: simpleBlueprintFixture(),
      originalDesign: {
        creativeDirectionBrief: "- Business: Terra & Beam Studio\n- Creative direction: Sun-baked editorial minimalism",
      },
      candidateDesktopR2Key: candidateKey,
      generate: async () => ({
        content: JSON.stringify({
          version: "1",
          scores: {
            macroLayout: 95, typography: 94, spacingRhythm: 93, surfaceColor: 92,
            imageTreatment: 91, components: 93, signatureElements: 94, responsive: 92,
            overall: 94,
          },
          findings: [],
          summary: "Distinctive and faithful to the blueprint.",
        }),
        provider: "simple-script",
        model: "glm-5.3-flash",
      }),
    });
    expect(report.scores.overall).toBe(94);
  });

  it("REFERENCE_BOUND visual QA still requires Reference inputs (no silent candidate-only mode)", async () => {
    const { siteGenerationId } = await startOriginalGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    await expect(
      runSimpleVisualQaStage(env, {
        siteGenerationId,
        buildId: initial.buildId,
        buildVersionId: initial.buildVersionId,
        buildVersionNumber: 1,
        blueprint: simpleBlueprintFixture(),
        candidateDesktopR2Key: "does-not-matter.png",
        generate: async () => ({ content: "{}", provider: "simple-script", model: "glm-5.3-flash" }),
      })
    ).rejects.toThrow(/REFERENCE_BOUND visual QA requires Reference visual inputs/);
  });
});
