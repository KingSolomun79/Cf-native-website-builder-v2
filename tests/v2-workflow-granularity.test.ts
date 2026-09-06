// Workflow granularity tests (issue #57).
//
// The REFERENCE_BOUND pipeline used to run inside ONE enclosing workflow step
// ("2.0 run REFERENCE_BOUND pipeline to terminal state"), whose per-attempt
// timeout applied to the WHOLE pipeline — three production generations died
// there while waiting on slow image providers. These tests prove the flattened
// topology:
//
//   1. no enclosing aggregate step exists — the workflow's step attempts are
//      the durable stages themselves;
//   2. completed-stage replay invariant: when a LATE stage fails and the
//      workflow re-runs, every earlier completed stage is served from the
//      engine's step cache (callback executed exactly once), and per-stage
//      bounded retry policies are retained.
//
// The simulated engine models the documented platform replay semantics: a
// completed step's result is cached under its stable name and re-served on
// every re-entry without re-executing the callback.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import type { BuildPipelineDeps } from "../src/domain/build-pipeline";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

const env = providedEnv as unknown as Env;

interface StepConfig {
  retries?: { limit?: number; delay?: unknown; backoff?: string };
  timeout?: string | number;
}

/** Replay-faithful engine: completed steps are cached under their stable name
 *  and re-served without re-executing the callback; the first execution of a
 *  step in `failFirstExecutionOf` throws (a simulated in-flight fault), which
 *  aborts that run() drive the way an engine-level failure does. */
class StepCacheEngine {
  readonly executions = new Map<string, number>();
  readonly replays: string[] = [];
  readonly attempted: string[] = [];
  readonly configsSeen = new Map<string, StepConfig>();
  readonly sleeps: Array<{ name: string; ms: number }> = [];
  private readonly cache = new Map<string, unknown>();
  private readonly attempts = new Map<string, number>();

  constructor(private readonly failFirstExecutionOf: Set<string> = new Set()) {}

  executionsOf(name: string): number {
    return this.executions.get(name) ?? 0;
  }

  async do(_name: string, a: unknown, b?: unknown): Promise<unknown> {
    const name = _name as string;
    const hasConfig = typeof b === "function";
    const fn = (hasConfig ? b : a) as () => Promise<unknown>;
    const config = (hasConfig ? a : undefined) as StepConfig | undefined;
    this.configsSeen.set(name, config ?? {});
    this.attempted.push(name);

    if (this.cache.has(name)) {
      this.replays.push(name);
      return this.cache.get(name);
    }

    const attempt = (this.attempts.get(name) ?? 0) + 1;
    this.attempts.set(name, attempt);
    if (attempt === 1 && this.failFirstExecutionOf.has(name)) {
      this.failFirstExecutionOf.delete(name);
      throw new Error(`simulated in-flight fault at '${name}'`);
    }
    this.executions.set(name, (this.executions.get(name) ?? 0) + 1);
    const result = await fn();
    this.cache.set(name, result);
    return result;
  }

  async sleep(name: string, duration: number | string): Promise<void> {
    const ms = typeof duration === "number" ? duration : Number.parseInt(duration, 10) * 1000;
    this.sleeps.push({ name, ms });
  }

  sleepUntil(): Promise<void> {
    return Promise.resolve();
  }
}

async function startGeneration(screenshotKey: string): Promise<string> {
  await persistPipelineScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

async function driveWorkflow(
  siteGenerationId: string,
  engine: StepCacheEngine,
  deps: BuildPipelineDeps
): Promise<{ terminal?: string; buildId?: string; releaseReadyBuildVersionId?: string | null }> {
  const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
  workflow.pipelineDeps = deps;
  const event = {
    payload: { siteGenerationId },
    instanceId: "wf-granularity-" + siteGenerationId.slice(0, 8),
  } as unknown as WorkflowEvent<{ siteGenerationId: string }>;
  return (await workflow.run(event, engine as unknown as WorkflowStep)) as {
    terminal?: string;
    buildId?: string;
    releaseReadyBuildVersionId?: string | null;
  };
}

const STABLE_PIPELINE_STEPS = [
  "1.0 resolve Build and immutable Build Version 1",
  "pipeline: reference analysis",
  "pipeline: visual blueprint",
  "pipeline: implementation contract",
  "pipeline: generate site (v1)",
  "pipeline: assemble + preview (v1)",
  "pipeline: QA evidence (v1)",
  "pipeline: QA verdicts (v1)",
];

describe("workflow granularity (issue #57)", () => {
  it("runs the pipeline as granular durable stage steps — no enclosing aggregate '2.0' step exists", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/granularity-smoke.png");
    const engine = new StepCacheEngine();

    const result = await driveWorkflow(siteGenerationId, engine, createPipelineScripts({}));

    expect(result.terminal).toBe("RELEASE_READY");
    expect(result.releaseReadyBuildVersionId).not.toBeNull();

    // The monolithic outer pipeline step is GONE: no step attempt may carry
    // the old envelope name (or any aggregate "run the whole pipeline" step).
    expect(engine.attempted.filter((name) => name.includes("2.0"))).toEqual([]);
    expect(engine.attempted.filter((name) => /run REFERENCE_BOUND pipeline/i.test(name))).toEqual([]);

    // Every canonical stage executed as its own durable step attempt.
    for (const stage of STABLE_PIPELINE_STEPS) {
      expect(engine.executionsOf(stage)).toBe(1);
    }
    // The image lifecycle ran as durable step attempts too (per-slot names
    // under the durable driver, or the stage step pre-#58).
    expect(engine.attempted.some((name) => name.startsWith("image:") || name.startsWith("pipeline: image"))).toBe(true);

    // Per-stage bounded policies are retained (directive #28): each stage step
    // still carries its explicit per-attempt timeout and retry budget.
    const verdictConfig = engine.configsSeen.get("pipeline: QA verdicts (v1)");
    expect(verdictConfig?.timeout).toBe("10 minutes");
    expect(verdictConfig?.retries?.limit).toBe(8);
  });

  it("required regression: a late-stage fault re-runs ONLY the failed stage — earlier completed stages replay from cache", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/granularity-replay.png");
    const engine = new StepCacheEngine(new Set(["pipeline: QA verdicts (v1)"]));
    const scripted = createPipelineScripts({});

    // Run 1: everything through QA evidence completes and caches; the QA
    // verdicts fault aborts the drive (domain-recorded FAILED terminal).
    const first = await driveWorkflow(siteGenerationId, engine, scripted);
    expect(first.terminal).toBe("FAILED");
    expect(engine.executionsOf("pipeline: QA evidence (v1)")).toBe(1);
    expect(engine.executionsOf("pipeline: QA verdicts (v1)")).toBe(0);

    // Run 2 (the engine re-runs the instance): every completed stage replays
    // from the step cache — analysis, blueprint, contract, generation, images,
    // assembly and QA evidence callbacks NEVER execute again — and only the
    // failed stage runs fresh, releasing the Build.
    const second = await driveWorkflow(siteGenerationId, engine, createPipelineScripts({}));
    expect(second.terminal).toBe("RELEASE_READY");

    for (const stage of STABLE_PIPELINE_STEPS.slice(0, 7)) {
      expect(engine.executionsOf(stage), `executions map: ${JSON.stringify([...engine.executions])}`).toBe(1);
      expect(engine.replays).toContain(stage);
    }
    expect(engine.executionsOf("pipeline: QA verdicts (v1)")).toBe(1);

    // The Build has exactly one immutable Build Version — the restart never
    // regenerated the candidate or re-spent image budget.
    const versions = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(first.buildId!)
      .first<{ n: number }>();
    expect(versions?.n).toBe(1);
  });
});
