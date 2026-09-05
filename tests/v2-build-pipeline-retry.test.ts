import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { applyRepairBatch, AutomatedRepairError, type FixPlan } from "../src/domain/automated-repair";
import { runImageWave, type ImageGenerationProvider, type ImagePromptRecord } from "../src/domain/image-pipeline";
import type { ImageSlot } from "../src/domain/site-generator";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

// Regression tests for the repair-loop Workflow-retry defect (issue #34):
// runBuildPipeline's control flags are memory-only, and the Cloudflare
// Workflows engine may re-run the whole function after a Durable Object reset
// or isolate eviction. Each test simulates that re-entry by aborting a run at
// a chosen durable step and then invoking the pipeline again against the same
// D1/R2 truth, proving:
//   1. existing repair batches are detected;
//   2. existing Build Versions are not regenerated incorrectly;
//   3. the remaining repair budget is reconstructed correctly;
//   4. a retry never produces a premature REPAIR_BUDGET_EXHAUSTED;
//   5. the bounded repair ceilings are still enforced.

const env = providedEnv as unknown as Env;

function stageLabel(user: string): string {
  if (user.includes("Interpret the frozen versioned Reference Evidence")) return "reference_analysis";
  if (user.includes("Produce the binding Visual Blueprint")) return "blueprint";
  if (user.includes("page id '")) {
    return user.includes("BOUNDED REPAIR DIRECTIVES") ? "page_repair" : "page";
  }
  if (user.includes("shared stylesheet") || user.includes("minimal shared runtime")) {
    return user.includes("BOUNDED REPAIR DIRECTIVES") ? "shared_source_repair" : "shared_source";
  }
  if (user.includes("Generate KIE image prompts")) return "image_prompts";
  if (user.includes("QA-A Confirmation")) return "qa_a_confirmation";
  if (user.includes("hard composition gate")) return "qa_a";
  if (user.includes("browser/technical review")) return "qa_b";
  if (user.includes("Plan ONE coordinated main Automated Repair batch")) return "fix_coordinator_plan";
  if (user.includes("Plan at most ONE narrow final Automated Repair batch")) return "release_blocker_fix_plan";
  return "other";
}

/** Scripted deps whose LLM calls are audited across pipeline invocations. */
function auditedScripts(options: Parameters<typeof createPipelineScripts>[0], audit: string[]): BuildPipelineDeps {
  const base = createPipelineScripts(options);
  const generate: RawAiGenerate = async (system, user) => {
    audit.push(stageLabel(user));
    return base.generate!(system, user);
  };
  return { ...base, generate };
}

/** Deps that abort the run when the named durable step is reached. */
function crashAt(scripted: BuildPipelineDeps, stepName: string): BuildPipelineDeps {
  return {
    ...scripted,
    step: async <T,>(name: string, fn: () => Promise<T>) => {
      if (name === stepName) throw new Error(`simulated Durable Object reset at '${stepName}'`);
      return fn();
    },
  };
}

async function startGeneration(screenshotKey: string): Promise<string> {
  await persistPipelineScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      // Screenshot+URL: issue #39 makes dimensions-only evidence INSUFFICIENT,
      // so pipeline fixtures carry a measured reference capture.
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

async function repairBatchKinds(buildId: string): Promise<string[]> {
  const batches = await env.DB.prepare("SELECT kind FROM repair_batches WHERE build_id = ? ORDER BY created_at")
    .bind(buildId)
    .all<{ kind: string }>();
  return batches.results.map((batch) => batch.kind);
}

async function versionNumbers(buildId: string): Promise<number[]> {
  const versions = await env.DB.prepare("SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
    .bind(buildId)
    .all<{ version_number: number }>();
  return versions.results.map((version) => version.version_number);
}

describe("build pipeline Workflow-retry safety (issue #34)", () => {
  it("resumes mid-repair re-entry from D1 truth and releases the repaired version without a second Fix Coordinator batch", async () => {
    const audit: string[] = [];
    const scripted = auditedScripts({ firstQaAFails: true }, audit);
    const siteGenerationId = await startGeneration("references/pipeline/retry-mid-repair.png");

    // Phase 1: crash right after the Fix Coordinator batch was durably
    // applied (the fault fires at the first repaired-version step — the
    // batch row, the new Build Version and the artifact inheritance already
    // exist in D1, but no preview or confirmation does).
    const crashed = await runBuildPipeline(env, {
      siteGenerationId,
      deps: crashAt(scripted, "pipeline: generate site (v2)"),
    });
    expect(crashed.terminal).toBe("FAILED");

    // D1 truth at the reset: exactly one Fix Coordinator batch and its version.
    const buildId = crashed.buildId;
    expect(await repairBatchKinds(buildId)).toEqual(["fix_coordinator"]);
    expect(await versionNumbers(buildId)).toEqual([1, 2]);

    // Phase 2: the engine re-runs the pipeline from the top; only D1 survives.
    // (The workflow's step 1.0 re-resolves the same Build, so re-entry passes
    // its buildId.)
    const outcome = await runBuildPipeline(env, { siteGenerationId, buildId, deps: scripted });
    expect(outcome.terminal).toBe("RELEASE_READY");
    // The re-entered pipeline releases the repaired version through the full
    // QA evaluation path (strictly stronger than a focused confirmation), so
    // no NEW repair was applied by THIS invocation — the batch lives in D1.
    expect(outcome.repairApplied).toBe(false);

    // (1) existing batch detected, (3) budget reconstructed: the re-entry
    // took the post-fix-coordinator path — the released candidate IS the
    // batch-created version 2, never a regenerated v3.
    const versions = await env.DB.prepare("SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(buildId)
      .all<{ id: string; version_number: number }>();
    expect(versions.results.map((version) => version.version_number)).toEqual([1, 2]);
    expect(outcome.releaseReadyBuildVersionId).toBe(versions.results[1].id);

    // (4) no premature REPAIR_BUDGET_EXHAUSTED: still exactly one batch.
    expect(await repairBatchKinds(buildId)).toEqual(["fix_coordinator"]);

    // (2) the repaired version's realization was regenerated exactly once,
    // WITH the batch's directives (issue #35) — never a plain re-roll and
    // never a verbatim copy; the frozen design stages were produced exactly
    // once (phase 1, v1) and reused on re-entry; the Fix Coordinator planned
    // exactly once.
    expect(audit.filter((label) => label === "reference_analysis")).toHaveLength(1);
    expect(audit.filter((label) => label === "blueprint")).toHaveLength(1);
    expect(audit.filter((label) => label === "shared_source")).toHaveLength(2);
    expect(audit.filter((label) => label === "shared_source_repair")).toHaveLength(2);
    expect(audit.filter((label) => label === "page")).toHaveLength(4);
    expect(audit.filter((label) => label === "page_repair")).toHaveLength(4);
    expect(audit.filter((label) => label === "image_prompts")).toHaveLength(1);
    expect(audit.filter((label) => label === "fix_coordinator_plan")).toHaveLength(1);

    // The repaired version inherits the frozen design stages (v1 R2 keys) and
    // regenerates its own realization under the batch directives (v2 keys).
    const v2ArtifactKeys = await env.DB.prepare(
      "SELECT kind, subkey, artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind IN ('reference_analysis','visual_blueprint','implementation_contract','generated_page','image_plan')"
    )
      .bind(versions.results[1].id)
      .all<{ kind: string; subkey: string; artifact_r2_key: string }>();
    const designRows = v2ArtifactKeys.results.filter(
      (row) => row.kind === "reference_analysis" || row.kind === "visual_blueprint" || row.kind === "implementation_contract"
    );
    expect(designRows).toHaveLength(3);
    expect(designRows.every((row) => row.artifact_r2_key.includes("/v1/"))).toBe(true);
    const pageRows = v2ArtifactKeys.results.filter((row) => row.kind === "generated_page");
    expect(pageRows).toHaveLength(4);
    expect(pageRows.every((row) => row.artifact_r2_key.includes("/v2/"))).toBe(true);

    // Fresh QA evaluated the NEW immutable version (v1 failed, v2 released).
    expect(audit.filter((label) => label === "qa_a")).toHaveLength(2);

    // Repair reused Accepted Images: no new KIE spend after the reset.
    const attempts = await env.DB.prepare("SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?")
      .bind(buildId)
      .first<{ n: number }>();
    const v1Accepted = await env.DB.prepare("SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ?")
      .bind(versions.results[0].id)
      .first<{ n: number }>();
    expect(attempts?.n).toBe(v1Accepted?.n);
  });

  it("re-entry before any repair batch still applies exactly one Fix Coordinator batch", async () => {
    const audit: string[] = [];
    const scripted = auditedScripts({ firstQaAFails: true }, audit);
    const siteGenerationId = await startGeneration("references/pipeline/retry-pre-repair.png");

    // Phase 1: crash inside the first evaluation (before any repair batch).
    const crashed = await runBuildPipeline(env, {
      siteGenerationId,
      deps: crashAt(scripted, "pipeline: QA verdicts (v1)"),
    });
    expect(crashed.terminal).toBe("FAILED");

    // Phase 2: re-entry reconstructs repairApplied=false (no batch exists)
    // and runs the normal bounded repair to Release Ready.
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: crashed.buildId,
      deps: scripted,
    });
    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(outcome.repairApplied).toBe(true);

    const buildId = outcome.buildId;
    expect(await repairBatchKinds(buildId)).toEqual(["fix_coordinator"]);
    expect(await versionNumbers(buildId)).toEqual([1, 2]);
    expect(outcome.releaseReadyBuildVersionId).not.toBeNull();

    // Exactly one Fix Coordinator plan across the crash and the re-entry. The
    // crash happened inside the QA verdicts step (before any QA-A call), so
    // phase 2's re-evaluation of v1 is the only full QA-A run. The repaired
    // version regenerated its realization once, under the batch directives.
    expect(audit.filter((label) => label === "fix_coordinator_plan")).toHaveLength(1);
    expect(audit.filter((label) => label === "qa_a")).toHaveLength(1);
    expect(audit.filter((label) => label === "page")).toHaveLength(4);
    expect(audit.filter((label) => label === "page_repair")).toHaveLength(4);
  });

  it("re-invoking a completed build reuses the frozen verdict and consumes nothing", async () => {
    const audit: string[] = [];
    const scripted = auditedScripts({ firstQaAFails: true }, audit);
    const siteGenerationId = await startGeneration("references/pipeline/retry-completed.png");

    const first = await runBuildPipeline(env, { siteGenerationId, deps: scripted });
    expect(first.terminal).toBe("RELEASE_READY");

    const buildId = first.buildId;
    const auditLengthBefore = audit.length;
    const batchesBefore = await repairBatchKinds(buildId);
    const versionsBefore = await versionNumbers(buildId);
    const attemptsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?")
      .bind(buildId)
      .first<{ n: number }>();

    // The engine losing the completed step result re-runs the whole pipeline.
    const second = await runBuildPipeline(env, {
      siteGenerationId,
      buildId,
      deps: scripted,
    });

    expect(second.terminal).toBe("RELEASE_READY");
    expect(second.releaseReadyBuildVersionId).toBe(first.releaseReadyBuildVersionId);
    // Zero new LLM calls: the frozen qa_report verdict was reused.
    expect(audit.length).toBe(auditLengthBefore);
    expect(await repairBatchKinds(buildId)).toEqual(batchesBefore);
    expect(await versionNumbers(buildId)).toEqual(versionsBefore);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM image_attempts WHERE build_id = ?")
      .bind(buildId)
      .first<{ n: number }>()).toEqual(attemptsBefore);
  });

  it("enforces the bounded ceiling on re-entry after both batches, routing to human review — never a budget crash", async () => {
    const audit: string[] = [];
    const scripted = auditedScripts({ allQaAFails: true, confirmationQaAFails: true }, audit);
    const siteGenerationId = await startGeneration("references/pipeline/retry-ceiling.png");

    // Phase 1: v1 fails -> Fix Coordinator -> v2 -> failed confirmation ->
    // Release Blocker Fix -> v3, then crash before v3 is evaluated.
    const crashed = await runBuildPipeline(env, {
      siteGenerationId,
      deps: crashAt(scripted, "pipeline: generate site (v3)"),
    });
    expect(crashed.terminal).toBe("FAILED");
    const buildId = crashed.buildId;
    expect(await repairBatchKinds(buildId)).toEqual(["fix_coordinator", "release_blocker_fix"]);
    expect(await versionNumbers(buildId)).toEqual([1, 2, 3]);

    // Phase 2: re-entry reconstructs the fully consumed budget, evaluates v3,
    // and stops automation at the domain-correct terminal.
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId,
      deps: scripted,
    });
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons[0]).toContain("bounded repair budget consumed");
    expect(outcome.repairApplied).toBe(true);

    // Exactly one plan per batch kind across crash + re-entry; no third batch.
    // Both repaired versions regenerated their realization with their own
    // batch's directives (v2 with the Fix Coordinator plan, v3 with the
    // Release Blocker Fix plan — reconstructed from D1 on re-entry).
    expect(audit.filter((label) => label === "fix_coordinator_plan")).toHaveLength(1);
    expect(audit.filter((label) => label === "release_blocker_fix_plan")).toHaveLength(1);
    expect(audit.filter((label) => label === "page")).toHaveLength(4);
    expect(audit.filter((label) => label === "page_repair")).toHaveLength(8);
    expect(await repairBatchKinds(buildId)).toEqual(["fix_coordinator", "release_blocker_fix"]);
    expect(await versionNumbers(buildId)).toEqual([1, 2, 3]);

    // (5) storage ceiling: further batches are rejected and reject WITHOUT
    // burning an orphan immutable Build Version.
    const versionsBefore = await versionNumbers(buildId);
    const latestVersionId = await env.DB.prepare(
      "SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1"
    )
      .bind(buildId)
      .first<{ id: string }>();
    const plan: FixPlan = {
      version: "1",
      rootCauses: [{ findingRef: "qa/home-1440-first.png", domain: "visual-fidelity", rootCause: "residual contrast gap" }],
      repairs: [{ target: "implementation", strategy: "css_geometry_crop", description: "Raise hero heading weight one step." }],
      blueprintReviewRequired: false,
    };
    for (const kind of ["fix_coordinator", "release_blocker_fix"] as const) {
      let error: AutomatedRepairError | null = null;
      try {
        await applyRepairBatch(env, {
          siteGenerationId,
          buildId,
          sourceBuildVersionId: latestVersionId!.id,
          kind,
          plan,
        });
      } catch (caught) {
        error = caught as AutomatedRepairError;
      }
      expect(error).toBeInstanceOf(AutomatedRepairError);
      expect(error?.code).toBe("REPAIR_BUDGET_EXHAUSTED");
    }
    expect(await versionNumbers(buildId)).toEqual(versionsBefore);
  });

  it("resumes image attempt numbering on re-entry instead of crash-looping on the attempt UNIQUE index", async () => {
    const imageSlot: ImageSlot = {
      id: "about-main",
      page: "about",
      semanticRole: "editorial supporting image",
      blueprintRole: "role-detail",
      priority: "NORMAL",
      orientation: "landscape",
      negativeSpaceForText: false,
    };
    const prompts: Map<string, ImagePromptRecord> = new Map([
      [
        imageSlot.id,
        {
          slotId: imageSlot.id,
          promptText: "Editorial documentary photograph realizing an editorial supporting image.",
          altText: "supporting photograph",
          shotType: "wide editorial",
          lighting: "natural window light",
          avoidance: "no text overlays",
        },
      ],
    ]);
    const succeedingProvider: ImageGenerationProvider = {
      createTask: async (task) => ({ taskId: `kie-${task.slotId}-${Math.random().toString(36).slice(2, 8)}`, costUsd: 0.1 }),
      fetchResult: async (taskId) => ({
        status: "complete" as const,
        bytes: new TextEncoder().encode(`WEBP-${taskId}`),
        temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
      }),
    };

    async function newImageBuild(): Promise<{ buildId: string; buildVersionId: string }> {
      const screenshotR2Key = `references/pipeline/img-${Math.random().toString(36).slice(2)}.png`;
      await persistPipelineScreenshot(env, screenshotR2Key);
      const started = await startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
          reference: { screenshotR2Key },
        },
      });
      const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      return { buildId: created.buildId, buildVersionId: created.buildVersionId };
    }
    async function attemptRows(buildVersionId: string): Promise<{ attempt_number: number; status: string }[]> {
      const rows = await env.DB.prepare(
        "SELECT attempt_number, status FROM image_attempts WHERE build_version_id = ? AND slot_id = 'about-main' ORDER BY attempt_number"
      )
        .bind(buildVersionId)
        .all<{ attempt_number: number; status: string }>();
      return rows.results;
    }

    // Scenario A: a re-entered wave for a slot whose TWO bounded attempts
    // already exist (both failed in the earlier pass) must SKIP the slot —
    // no UNIQUE collision, no new spend — and complete the wave.
    {
      const { buildId, buildVersionId } = await newImageBuild();
      const failingProvider: ImageGenerationProvider = {
        createTask: async (task) => ({ taskId: `kie-${task.slotId}-a`, costUsd: 0.1 }),
        fetchResult: async () => ({ status: "failed" as const }),
      };
      await runImageWave(env, {
        buildId, buildVersionId, buildVersionNumber: 1, wave: 2,
        slots: [imageSlot], promptRecords: prompts, provider: failingProvider,
      });
      expect(await attemptRows(buildVersionId)).toEqual([
        { attempt_number: 1, status: "failed" },
        { attempt_number: 2, status: "failed" },
      ]);

      const outcomes = await runImageWave(env, {
        buildId, buildVersionId, buildVersionNumber: 1, wave: 2,
        slots: [imageSlot], promptRecords: prompts, provider: succeedingProvider,
      });
      expect(outcomes.map((outcome) => outcome.status)).toEqual(["failed"]);
      expect(await attemptRows(buildVersionId)).toEqual([
        { attempt_number: 1, status: "failed" },
        { attempt_number: 2, status: "failed" },
      ]);
    }

    // Scenario B: a wave interrupted after attempt 1 (one failed row) resumes
    // at attempt 2 on re-entry and can still accept the slot.
    {
      const { buildId, buildVersionId } = await newImageBuild();
      await env.DB.prepare(
        `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
         VALUES ('seed-a1', ?, ?, 'about-main', 2, 1, 'failed', 0, ?)`
      )
        .bind(buildId, buildVersionId, new Date().toISOString())
        .run();

      const outcomes = await runImageWave(env, {
        buildId, buildVersionId, buildVersionNumber: 1, wave: 2,
        slots: [imageSlot], promptRecords: prompts, provider: succeedingProvider,
      });
      expect(outcomes.map((outcome) => outcome.status)).toEqual(["accepted"]);
      expect(await attemptRows(buildVersionId)).toEqual([
        { attempt_number: 1, status: "failed" },
        { attempt_number: 2, status: "succeeded" },
      ]);
      const accepted = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM accepted_images WHERE build_version_id = ? AND slot_id = 'about-main'"
      )
        .bind(buildVersionId)
        .first<{ n: number }>();
      expect(accepted?.n).toBe(1);
    }
  });

  it("re-words a boundary-tripping fix plan once and applies it; a persistent violator routes to human review without consuming budget (issue #36)", async () => {
    // Case 1: the first plan trips the text-boundary heuristic, the bounded
    // re-word complies, and the batch applies to Release Ready.
    const audit1: string[] = [];
    const scripted1 = auditedScripts({ firstQaAFails: true, fixCoordinatorPlanTrips: "once" }, audit1);
    const siteGenerationId1 = await startGeneration("references/pipeline/retry-reword.png");
    const outcome1 = await runBuildPipeline(env, { siteGenerationId: siteGenerationId1, deps: scripted1 });
    expect(outcome1.terminal).toBe("RELEASE_READY");
    expect(outcome1.repairApplied).toBe(true);
    // Exactly two planner calls (original + re-word), one batch, versions [1,2].
    expect(audit1.filter((label) => label === "fix_coordinator_plan")).toHaveLength(2);
    expect(await repairBatchKinds(outcome1.buildId)).toEqual(["fix_coordinator"]);
    expect(await versionNumbers(outcome1.buildId)).toEqual([1, 2]);

    // Case 2: a planner that keeps violating stops automation at the bounded
    // terminal — no batch consumed, no new Build Version, candidate recorded.
    const scripted2 = auditedScripts({ firstQaAFails: true, fixCoordinatorPlanTrips: "always" }, []);
    const siteGenerationId2 = await startGeneration("references/pipeline/retry-violator.png");
    const outcome2 = await runBuildPipeline(env, { siteGenerationId: siteGenerationId2, deps: scripted2 });
    expect(outcome2.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome2.reasons[0]).toContain("bounds-compliant plan");
    expect(outcome2.previewUrl).not.toBeNull();
    expect(await repairBatchKinds(outcome2.buildId)).toEqual([]);
    expect(await versionNumbers(outcome2.buildId)).toEqual([1]);
  });
});
