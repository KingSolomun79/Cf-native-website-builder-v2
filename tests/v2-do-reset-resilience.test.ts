import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../src/env.d";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { classifyStageFailure, isTransientPlatformResetError } from "../src/domain/stage-failure";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import { failBuildForWorkflowTermination } from "../src/domain/workflow-reconciliation";
import { persistPipelineScreenshot, createPipelineScripts, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";

// Issue #70 — Durable Object reset / Workflow terminal-state resilience.
//
// The 2026-09-07 production incident (Build 7aa3e678 / Workflow 66d5b164): a
// "Durable Object reset because its code was updated" abort unwound through
// the pipeline's catch and terminal-failed the Build WHILE the Workflow
// engine still owned recovery — the engine's retry completed the analysis
// stage afterwards, leaving an orphaned FAILED-build/RUNNING-workflow pair
// until an operator terminated it. The #70 contract:
//
//   TRANSIENT_RETRYABLE -> rethrow/yield to the engine -> NO terminal Build
//   mutation. The engine resumes from persisted state (D1 rows, R2 immutable
//   artifacts, step cache, single-flight claims — §24). Terminal mutation
//   happens only for deliberate domain outcomes or genuine instance death
//   applied by the #56 reconciliation sweep, exactly once (§26/§27).

const env = providedEnv as unknown as Env;
const DO_RESET = "Durable Object reset because its code was updated";

describe("platform reset classification (issue #70 §23)", () => {
  it("classifies the documented DO code-update reset as TRANSIENT_RETRYABLE (message fallback)", () => {
    expect(classifyStageFailure(new Error(DO_RESET))).toEqual("TRANSIENT_RETRYABLE");
    expect(isTransientPlatformResetError(new Error(DO_RESET))).toBe(true);
  });

  it("honors a structured retryable property when the platform provides one", () => {
    const structured = { retryable: true, message: "something platform-specific" };
    expect(isTransientPlatformResetError(structured)).toBe(true);
    expect(classifyStageFailure(structured)).toEqual("TRANSIENT_RETRYABLE");
  });

  it("does not match broad keywords — the fallback matcher is narrow", () => {
    expect(isTransientPlatformResetError(new Error("Durable Object reset unexpectedly"))).toBe(false);
    expect(isTransientPlatformResetError(new Error("reset because its code was updated"))).toBe(false);
    expect(isTransientPlatformResetError(null)).toBe(false);
  });

  it("leaves deterministic and terminal classes untouched", () => {
    const findings = [{ id: "ORPHANED_CLASS", detail: "about: narrow-narrative" }];
    expect(classifyStageFailure(new (class extends Error {})("synthetic"))).toEqual("TRANSIENT_RETRYABLE");
    expect(classifyStageFailure({ name: "SiteGenerationValidationError", findings })).not.toEqual("TERMINAL_INVARIANT");
  });
});

// ---------------------------------------------------------------------------
// §25: a DO-reset transient injected ONCE mid-analysis — the engine-retry
// seam (the workflow's step wrapper semantics) retries the stage, the Build
// stays NONTERMINAL throughout the retry window, and the pipeline completes
// from persisted state with no operator intervention.
// ---------------------------------------------------------------------------

describe("single transient DO reset yields to the engine (issue #70 §25)", () => {
  it("build stays non-terminal through the retry and the run completes RELEASE_READY", async () => {
    const screenshotKey = "references/uploads/do-reset-once.png";
    await persistPipelineScreenshot(env, screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });

    const base = createPipelineScripts({ visionReference: true });
    let resetThrown = false;
    const sampledStates: Array<string | null> = [];
    const visionSeam: RawAiGenerate = async (system, user) => {
      if (!resetThrown) {
        resetThrown = true;
        throw new Error(DO_RESET);
      }
      return base.visionGenerate!(system, user);
    };
    // Mimic the workflow's step wrapper: transient errors retry the stage
    // closure; between attempts the Build state is sampled to prove no
    // terminal mutation happened while the engine owned recovery.
    const engineStep = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (attempt > 8) throw error;
          const row = await env.DB.prepare("SELECT state FROM builds WHERE site_generation_id = ?")
            .bind(started.siteGenerationId)
            .first<{ state: string }>();
          sampledStates.push(row?.state ?? null);
        }
      }
    };
    const deps: BuildPipelineDeps = {
      ...base,
      visionGenerate: visionSeam,
      step: (name, fn) => engineStep(name, fn) as never,
    };

    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps });

    expect(resetThrown).toBe(true);
    expect(outcome.terminal).toBe("RELEASE_READY");
    // The transient never terminal-failed the Build: every mid-retry sample
    // is a non-terminal pipeline state, and no failure marker was written.
    expect(sampledStates.length).toBeGreaterThan(0);
    for (const state of sampledStates) expect(state).not.toBe("FAILED");
    const failureEvents = await env.DB.prepare(
      "SELECT id FROM build_workflow_events WHERE build_id = ? AND stage = 'pipeline_failure'"
    )
      .bind(outcome.buildId)
      .all<{ id: string }>();
    expect((failureEvents.results ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §26/§27: a transient that recurs until the step retry budget genuinely
// exhausts — the workflow instance errors WITHOUT terminal Build mutation
// (run() rethrows), and the #56 reconciliation applies Build = FAILED
// exactly once. No endless limbo.
// ---------------------------------------------------------------------------

type StepConfig = { retries?: { limit?: number } };

class RetryingEngine {
  readonly attempts = new Map<string, number>();

  async do(name: string, a: unknown, b?: unknown): Promise<unknown> {
    const hasConfig = typeof b === "function";
    const fn = (hasConfig ? b : a) as () => Promise<unknown>;
    const config = (hasConfig ? a : undefined) as StepConfig | undefined;
    const attempt = (this.attempts.get(name) ?? 0) + 1;
    this.attempts.set(name, attempt);
    try {
      return await fn();
    } catch (error) {
      if (error instanceof NonRetryableError) throw error;
      const limit = config?.retries?.limit ?? 5;
      if (attempt >= limit + 1) throw error;
      return await this.do(name, a, b);
    }
  }

  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

describe("transient exhaustion -> instance death -> reconciliation owns FAILED (issue #70 §26/§27)", () => {
  it("run() rethrows without terminal mutation; the sweep fails the Build exactly once", async () => {
    const screenshotKey = "references/uploads/do-reset-exhaustion.png";
    await persistPipelineScreenshot(env, screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });

    const base = createPipelineScripts({ visionReference: true });
    const visionSeam: RawAiGenerate = async () => {
      throw new Error(DO_RESET);
    };
    const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
    workflow.pipelineDeps = { ...base, visionGenerate: visionSeam };
    const engine = new RetryingEngine();
    const event = { payload: { siteGenerationId: started.siteGenerationId }, instanceId: "wf-do-reset-exhaustion" } as unknown as WorkflowEvent<{ siteGenerationId: string }>;

    // The workflow rethrows the transient: the instance errors with NO
    // in-process terminal Build mutation.
    await expect(workflow.run(event, engine as unknown as WorkflowStep)).rejects.toThrow(DO_RESET);

    const buildRow = await env.DB.prepare("SELECT id, state FROM builds WHERE site_generation_id = ?")
      .bind(started.siteGenerationId)
      .first<{ id: string; state: string }>();
    expect(buildRow?.state).not.toBe("FAILED");
    const inProcessFailure = await env.DB.prepare(
      "SELECT id FROM build_workflow_events WHERE build_id = ? AND stage = 'pipeline_failure'"
    )
      .bind(buildRow!.id)
      .all<{ id: string }>();
    expect((inProcessFailure.results ?? []).length).toBe(0);

    // The #56 reconciliation sweep owns the terminal transition: exactly once.
    await failBuildForWorkflowTermination(env, {
      buildId: buildRow!.id,
      workflowInstanceId: "wf-do-reset-exhaustion",
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
      detail: DO_RESET,
    });
    const afterSweep = await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(buildRow!.id).first<{ state: string }>();
    expect(afterSweep?.state).toBe("FAILED");
    await failBuildForWorkflowTermination(env, {
      buildId: buildRow!.id,
      workflowInstanceId: "wf-do-reset-exhaustion",
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
      detail: DO_RESET,
    });
    const audits = await env.DB.prepare(
      "SELECT id FROM build_workflow_events WHERE build_id = ? AND stage = 'workflow_execution' AND detail LIKE '%WORKFLOW_EXECUTION_EXHAUSTED%'"
    )
      .bind(buildRow!.id)
      .all<{ id: string }>();
    expect((audits.results ?? []).length).toBe(1);
  });
});
