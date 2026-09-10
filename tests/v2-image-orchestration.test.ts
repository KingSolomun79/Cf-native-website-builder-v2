// Durable KIE image job lifecycle tests (issue #58).
//
// The production image stage is a durable submit → sleep → poll state machine
// (src/domain/image-orchestration.ts). These tests simulate the Workflow
// engine semantics that matter for it:
//
//   - completed steps replay from cache under their stable name without
//     re-executing the callback;
//   - an engine kill mid-run is a fresh drive against the same D1 truth;
//   - step.sleep is recorded, never actually waited.
//
// against a scripted provider whose remote tasks report per-probe states, and
// prove: submission persists immediately, replay never double-submits, slow
// providers survive past the old 10-minute outer step bound, never-completing
// tasks fail as bounded DOMAIN attempts, partial waves keep their accepted
// slots, the budget gate rejects before spending, and the worst-case durable
// step count stays inside the documented Workflow limit.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  runImageGenerationDurable,
  imagePollIntervalMs,
  imageAttemptTimeoutMs,
  imageMaxPollsPerAttempt,
  IMAGE_POLL_INTERVAL_MS_DEFAULT,
  IMAGE_ATTEMPT_TIMEOUT_MS_DEFAULT,
  type ImageOrchestrationSeams,
} from "../src/domain/image-orchestration";
import { MAX_ATTEMPTS_PER_SLOT, type ImageGenerationProvider, type ImageProviderFetchResult, type ResolvedSlotTask } from "../src/domain/image-pipeline";
import type { ImageSlot } from "../src/domain/site-contracts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { WRANGLER_CONFIG } from "./_generated-wrangler-config";
import { encodePng } from "../src/lib/png-codec";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import { createSimpleScripts, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS } from "./helpers/simple-scripts";

const env = providedEnv as unknown as Env;

function slot(overrides: Partial<ImageSlot> & { id: string }): ImageSlot {
  return {
    page: "home",
    semanticRole: "editorial supporting photograph",
    blueprintRole: "role-detail",
    priority: "NORMAL",
    orientation: "landscape",
    negativeSpaceForText: false,
    ...overrides,
  };
}

function promptRecordsFor(slots: ImageSlot[]): RawAiGenerate {
  const records = slots.map((entry) => ({
    slotId: entry.id,
    promptText: `Editorial documentary photograph realizing ${entry.semanticRole} with natural window light and generous negative space for the ${entry.orientation} frame.`,
    altText: `${entry.semanticRole} photograph`,
    shotType: "wide editorial",
    lighting: "natural window light",
    avoidance: "no text overlays, no logos, no watermarks",
  }));
  return async () => ({
    content: JSON.stringify({ records }),
    provider: "test",
    model: "test-model-images",
  });
}

/** Scripted provider: each created task reports its state sequence one probe
 *  at a time (last state repeats). checkResult is ONE probe — no waiting. */
class ScriptedProvider implements ImageGenerationProvider {
  readonly created: string[] = [];
  readonly probesByTask = new Map<string, number>();
  private readonly sequences = new Map<string, ImageProviderFetchResult["status"][]>();
  private counter = 0;
  private scriptedCount = 0;

  constructor(
    private readonly costUsd = 0.1,
    private readonly bytes: (taskId: string) => Uint8Array = (taskId) => new TextEncoder().encode(`WEBP-${taskId}`)
  ) {}

  /** Scripts the state sequence for the Nth task that WILL be created (tasks
   *  are named task-1..task-N in creation order). The last state repeats. */
  scriptTask(sequence: ImageProviderFetchResult["status"][]): void {
    this.scriptedCount += 1;
    this.sequences.set(`task-${this.scriptedCount}`, [...sequence]);
  }

  estimateCost(): number {
    return this.costUsd;
  }

  async createTask(task: ResolvedSlotTask): Promise<{ taskId: string; costUsd: number }> {
    this.counter += 1;
    const taskId = `task-${this.counter}`;
    this.created.push(`${task.slotId}:${taskId}`);
    return { taskId, costUsd: this.costUsd };
  }

  async checkResult(taskId: string): Promise<ImageProviderFetchResult> {
    const n = (this.probesByTask.get(taskId) ?? 0) + 1;
    this.probesByTask.set(taskId, n);
    const sequence = this.sequences.get(taskId) ?? ["complete"];
    const state = sequence[Math.min(n - 1, sequence.length - 1)];
    if (state === "pending") return { status: "pending" };
    if (state === "failed") return { status: "failed" };
    return {
      status: "complete",
      bytes: this.bytes(taskId),
      temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
    };
  }
}

/** Replay-faithful seam engine: cached step results replay without executing;
 *  `failAt` simulates an engine kill at a named step's first execution. */
class SeamHarness {
  readonly executed = new Map<string, number>();
  readonly replays: string[] = [];
  readonly sleeps: Array<{ name: string; ms: number }> = [];
  private readonly cache = new Map<string, unknown>();
  failAt = new Set<string>();

  async stepDo<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (this.cache.has(name)) {
      this.replays.push(name);
      return this.cache.get(name) as T;
    }
    if (this.failAt.has(name)) {
      this.failAt.delete(name);
      throw new Error("simulated instance crash");
    }
    this.executed.set(name, (this.executed.get(name) ?? 0) + 1);
    const result = await fn();
    this.cache.set(name, result);
    return result;
  }

  async sleep(name: string, ms: number): Promise<void> {
    this.sleeps.push({ name, ms });
  }

  seams(): ImageOrchestrationSeams {
    return {
      stepDo: (name, fn) => this.stepDo(name, fn),
      sleep: (name, ms) => this.sleep(name, ms),
    };
  }
}

async function newBuild(prefix: string): Promise<{ buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Orchestration Roasters", contactEmail: "hi@orch.example" },
      reference: { screenshotR2Key: `references/uploads/${prefix}-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  return await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
}

async function attemptRows(envOverride: Env, buildId: string, slotId: string): Promise<{ attempt_number: number; status: string; provider_task_id: string | null; cost_usd: number }[]> {
  const rows = await envOverride.DB.prepare(
    "SELECT attempt_number, status, provider_task_id, cost_usd FROM image_attempts WHERE build_id = ? AND slot_id = ? ORDER BY attempt_number"
  )
    .bind(buildId, slotId)
    .all<{ attempt_number: number; status: string; provider_task_id: string | null; cost_usd: number }>();
  return rows.results ?? [];
}

async function seedSpend(buildId: string, buildVersionId: string, rows: number, costEach: number): Promise<void> {
  for (let i = 0; i < rows; i++) {
    await env.DB.prepare(
      `INSERT INTO image_attempts (id, build_id, build_version_id, slot_id, wave, attempt_number, status, cost_usd, created_at)
       VALUES (?, ?, ?, ?, 2, 1, 'succeeded', ?, '2026-09-01T00:00:00Z')`
    )
      .bind(`seed-${buildId}-${i}`, buildId, buildVersionId, `seed-slot-${i}`, costEach)
      .run();
  }
}

describe("durable image lifecycle (issue #58)", () => {
  it("persists the attempt with its remote task id at SUBMISSION time and accepts through durable polls", async () => {
    const { buildId, buildVersionId } = await newBuild("submit");
    const provider = new ScriptedProvider();
    provider.scriptTask(["pending", "pending", "complete"]);
    const harness = new SeamHarness();

    // Crash the drive at the SECOND poll: the submission has long been
    // durable, the task is still pending — exactly the operator-visible
    // mid-flight state the old runner hid until a slot call returned.
    harness.failAt.add("image:home-hero:a1:poll:2");
    await expect(
      runImageGenerationDurable(
        env,
        { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], provider, generate: promptRecordsFor([slot({ id: "home-hero" })]), expandToTarget: false },
        harness.seams()
      )
    ).rejects.toThrow("simulated instance crash");

    const midFlight = await attemptRows(env, buildId, "home-hero");
    expect(midFlight).toHaveLength(1);
    expect(midFlight[0].status).toBe("pending");
    expect(midFlight[0].provider_task_id).toBe("task-1");
    expect(midFlight[0].cost_usd).toBeCloseTo(0.1, 4);

    // Pending waiting is control flow: durable sleeps between polls, never
    // errors, never CPU-active polling.
    expect(harness.sleeps.length).toBe(1);
    expect(harness.sleeps[0].ms).toBe(IMAGE_POLL_INTERVAL_MS_DEFAULT);
    expect(harness.sleeps[0].name).toBe("image:home-hero:a1:wait:1");
  });

  it("recovers an engine restart on the persisted task id — no second KIE submission", async () => {
    const { buildId, buildVersionId } = await newBuild("restart");
    const provider = new ScriptedProvider();
    provider.scriptTask(["pending", "complete"]);
    const crashed = new SeamHarness();
    crashed.failAt.add("image:home-hero:a1:poll:1");
    const input = { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], expandToTarget: false };

    await expect(
      runImageGenerationDurable(env, { ...input, provider, generate: promptRecordsFor(input.slots) }, crashed.seams())
    ).rejects.toThrow("simulated instance crash");
    expect(provider.created).toEqual(["home-hero:task-1"]);

    // Fresh engine (step cache gone), same D1 truth, same provider: the
    // submission resumes the EXISTING remote task.
    const resumed = new SeamHarness();
    const result = await runImageGenerationDurable(
      env,
      { ...input, provider, generate: promptRecordsFor(input.slots) },
      resumed.seams()
    );
    expect(provider.created).toEqual(["home-hero:task-1"]);
    expect(result.outcomes[0].status).toBe("accepted");
    const rows = await attemptRows(env, buildId, "home-hero");
    expect(rows).toEqual([{ attempt_number: 1, status: "succeeded", provider_task_id: "task-1", cost_usd: 0.1 }]);
    // The submit step re-executed (no cache to replay) but took the
    // persisted-task-id fast path — zero provider calls.
    expect(resumed.executed.get("image:home-hero:a1:submit")).toBe(1);
  });

  it("survives a provider task pending for longer than 10 minutes — accepted when it completes", async () => {
    const { buildId, buildVersionId } = await newBuild("slow");
    const provider = new ScriptedProvider();
    // 25 x 30s pending probes = 12.5 simulated minutes before completion —
    // far beyond the 10-minute outer-step timeout that used to kill runs.
    provider.scriptTask([...Array(25).fill("pending"), "complete"]);
    const harness = new SeamHarness();

    const result = await runImageGenerationDurable(
      env,
      { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], provider, generate: promptRecordsFor([slot({ id: "home-hero" })]), expandToTarget: false },
      harness.seams()
    );

    expect(result.outcomes[0].status).toBe("accepted");
    expect(provider.created).toEqual(["home-hero:task-1"]);
    expect(harness.sleeps).toHaveLength(25);
    expect(harness.sleeps.every((wait) => wait.ms === 30_000)).toBe(true);
    expect(harness.executed.get("image:home-hero:a1:poll:26")).toBe(1);
    const rows = await attemptRows(env, buildId, "home-hero");
    expect(rows[0].status).toBe("succeeded");
  });

  it("fails a never-completing provider task as a bounded DOMAIN attempt, then exhausts the attempt budget", async () => {
    const { buildId, buildVersionId } = await newBuild("stuck");
    const provider = new ScriptedProvider();
    provider.scriptTask(["pending"]);
    provider.scriptTask(["pending"]); // second attempt also never completes
    const harness = new SeamHarness();
    const tightEnv = { ...env, KIE_POLL_INTERVAL_MS: "1000", KIE_ATTEMPT_TIMEOUT_MS: "5000" } as Env;

    const result = await runImageGenerationDurable(
      tightEnv,
      { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], provider, generate: promptRecordsFor([slot({ id: "home-hero" })]), expandToTarget: false },
      harness.seams()
    );

    // Both bounded attempts timed out into explicit domain failures; nothing
    // threw, and the Workflow-equivalent drive stayed healthy.
    expect(result.outcomes[0]).toEqual({ slotId: "home-hero", status: "failed", costUsd: 0.1 });
    const rows = await attemptRows(env, buildId, "home-hero");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "failed")).toBe(true);
    expect(harness.executed.get("image:home-hero:a1:timeout")).toBe(1);
    expect(harness.executed.get("image:home-hero:a2:timeout")).toBe(1);
    expect(provider.created).toEqual(["home-hero:task-1", "home-hero:task-2"]);
    // Poll count per attempt is bounded by ceil(timeout / interval) = 5.
    expect(harness.executed.get("image:home-hero:a1:poll:6")).toBeUndefined();
  });

  it("keeps a partial wave intact: accepted slots are retained and per-slot failures never reset the wave", async () => {
    const slots = [
      slot({ id: "about-a" }),
      slot({ id: "about-b" }),
      slot({ id: "about-c" }),
      slot({ id: "about-d" }),
    ];
    const { buildId, buildVersionId } = await newBuild("partial");
    const provider = new ScriptedProvider();
    provider.scriptTask(["complete"]); // about-a/task-1
    provider.scriptTask(["pending", "complete"]); // about-b/task-2
    provider.scriptTask(["failed"]); // about-c/task-3 (attempt 1)
    provider.scriptTask(["complete"]); // about-c/task-4 (attempt 2)
    provider.scriptTask(["pending"]); // about-d/task-5 never completes
    provider.scriptTask(["pending"]); // about-d/task-6 never completes
    const harness = new SeamHarness();
    const tightEnv = { ...env, KIE_POLL_INTERVAL_MS: "1000", KIE_ATTEMPT_TIMEOUT_MS: "5000" } as Env;

    const result = await runImageGenerationDurable(
      tightEnv,
      { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots, provider, generate: promptRecordsFor(slots), expandToTarget: false },
      harness.seams()
    );

    expect(result.outcomes.map((outcome) => [outcome.slotId, outcome.status])).toEqual([
      ["about-a", "accepted"],
      ["about-b", "accepted"],
      ["about-c", "accepted"],
      ["about-d", "failed"],
    ]);
    expect(provider.created).toEqual([
      "about-a:task-1",
      "about-b:task-2",
      "about-c:task-3",
      "about-c:task-4",
      "about-d:task-5",
      "about-d:task-6",
    ]);
    const accepted = await env.DB.prepare("SELECT slot_id FROM accepted_images WHERE build_version_id = ? ORDER BY slot_id")
      .bind(buildVersionId)
      .all<{ slot_id: string }>();
    expect(accepted.results.map((row) => row.slot_id)).toEqual(["about-a", "about-b", "about-c"]);
    // The failed slot stayed bounded at the same MAX_ATTEMPTS_PER_SLOT.
    expect((await attemptRows(env, buildId, "about-d")).length).toBe(MAX_ATTEMPTS_PER_SLOT);
  });

  it("rejects budget BEFORE any remote submission when the provider estimates deterministically", async () => {
    // Hard gate: $2.75 spent + $0.50 next would cross $3.00 — no KIE call.
    const hard = await newBuild("hard");
    const expensive = new ScriptedProvider(0.5);
    await seedSpend(hard.buildId, hard.buildVersionId, 11, 0.25);
    const hardHarness = new SeamHarness();
    await expect(
      runImageGenerationDurable(
        env,
        { siteGenerationId: "sg", buildId: hard.buildId, buildVersionId: hard.buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], provider: expensive, generate: promptRecordsFor([slot({ id: "home-hero" })]), expandToTarget: false },
        hardHarness.seams()
      )
    ).rejects.toThrow("Hard KIE spend gate");
    expect(expensive.created).toEqual([]);
    expect((await attemptRows(env, hard.buildId, "home-hero"))[0].status).toBe("rejected_budget");

    // Generation-phase reserve: a CRITICAL (Wave 1) slot stops past the
    // reserve without failing the drive, before any remote call. (Wave 2's
    // ceiling legitimately IS the hard limit.)
    const reserve = await newBuild("reserve");
    const provider = new ScriptedProvider(0.4);
    await seedSpend(reserve.buildId, reserve.buildVersionId, 5, 0.4);
    const harness = new SeamHarness();
    const criticalSlot = slot({ id: "home-hero", priority: "CRITICAL" });
    const result = await runImageGenerationDurable(
      env,
      { siteGenerationId: "sg", buildId: reserve.buildId, buildVersionId: reserve.buildVersionId, buildVersionNumber: 1, slots: [criticalSlot], provider, generate: promptRecordsFor([criticalSlot]), expandToTarget: false },
      harness.seams()
    );
    expect(result.outcomes[0].status).toBe("rejected_budget");
    expect(provider.created).toEqual([]);
    expect((await attemptRows(env, reserve.buildId, "home-hero"))[0].status).toBe("rejected_budget");
  });

  it("enforces orientation conformance at acceptance exactly like the synchronous runner (issue #47)", async () => {
    const { buildId, buildVersionId } = await newBuild("orientation");
    const portrait = slot({ id: "about-split", orientation: "portrait" });
    const landscape = await encodePng({ width: 1344, height: 768, rgb: new Uint8Array(1344 * 768 * 3).fill(90) });
    const conforming = await encodePng({ width: 768, height: 1152, rgb: new Uint8Array(768 * 1152 * 3).fill(90) });
    const provider = new ScriptedProvider(0.15, (taskId) => (taskId === "task-1" ? landscape : conforming));
    provider.scriptTask(["complete"]);
    provider.scriptTask(["complete"]);
    const harness = new SeamHarness();

    const result = await runImageGenerationDurable(
      env,
      { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [portrait], provider, generate: promptRecordsFor([portrait]), expandToTarget: false },
      harness.seams()
    );

    expect(result.outcomes[0].status).toBe("accepted");
    const rows = await attemptRows(env, buildId, "about-split");
    expect(rows.map((row) => row.status)).toEqual(["failed", "succeeded"]);
    const accepted = await env.DB.prepare("SELECT r2_key FROM accepted_images WHERE build_version_id = ? AND slot_id = 'about-split'")
      .bind(buildVersionId)
      .all<{ r2_key: string }>();
    expect(accepted.results[0].r2_key).toContain("about-split-a2.webp");
  });

  it("serializes overlapping executions through the #54 claim — at most ONE KIE task per submission", async () => {
    const { buildId, buildVersionId } = await newBuild("overlap");
    const provider = new ScriptedProvider();
    let releaseOwner: (() => void) | null = null;
    const ownerDone = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    const slowProvider: ImageGenerationProvider = {
      estimateCost: () => 0.1,
      createTask: async (task) => {
        const created = await provider.createTask(task);
        await ownerDone; // the owner holds the claim while submitting
        return created;
      },
      checkResult: (taskId) => provider.checkResult(taskId),
      fetchResult: (taskId) => provider.fetchResult(taskId),
    };

    const input = { siteGenerationId: "sg", buildId, buildVersionId, buildVersionNumber: 1, slots: [slot({ id: "home-hero" })], expandToTarget: false } as const;
    const ownerDrive = runImageGenerationDurable(env, { ...input, provider: slowProvider, generate: promptRecordsFor(input.slots) }, new SeamHarness().seams());

    // Wait until the owner holds the claim inside its remote call.
    let claimed = false;
    for (let i = 0; i < 400 && !claimed; i++) {
      const row = await env.DB.prepare("SELECT state FROM stage_execution_claims WHERE stage_kind = 'kie_image_submission' AND build_version_id = ?")
        .bind(buildVersionId)
        .first<{ state: string }>();
      claimed = row?.state === "IN_PROGRESS";
      if (!claimed) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(claimed).toBe(true);

    // An overlapping execution for the SAME deterministic submission must
    // yield (never co-submit): the transient yield is exactly what the step
    // retry policy waits out.
    const contenderDrive = runImageGenerationDurable(env, { ...input, provider: slowProvider, generate: promptRecordsFor(input.slots) }, new SeamHarness().seams());
    await expect(contenderDrive).rejects.toThrow("STAGE_EXECUTION_IN_PROGRESS");

    releaseOwner!();
    const result = await ownerDrive;
    expect(result.outcomes[0].status).toBe("accepted");
    expect(provider.created).toEqual(["home-hero:task-1"]);
  });

  it("keeps the worst-case durable step count inside the documented Workflow limit", async () => {
    // step.sleep does NOT count toward the step limit (Workflows limits docs);
    // poll steps do. Defaults: 12 slots x 2 attempts x (1 submit + 30 polls).
    const maxPolls = imageMaxPollsPerAttempt(env);
    expect(imagePollIntervalMs(env)).toBe(IMAGE_POLL_INTERVAL_MS_DEFAULT);
    expect(imageAttemptTimeoutMs(env)).toBe(IMAGE_ATTEMPT_TIMEOUT_MS_DEFAULT);
    const imageSteps = 12 * MAX_ATTEMPTS_PER_SLOT * (1 + maxPolls);
    // Plus prompts (x2 candidate passes), wave events (x2 passes x2 waves)
    // and the non-image pipeline stages (~15 durable steps).
    const worstCase = imageSteps + 2 + 4 + 15;
    expect(worstCase).toBeLessThan(10_000); // documented paid-plan default

    // The deployed config matches the defaults this budget was calculated
    // with (issue #58 §21: calculated, not assumed).
    expect(WRANGLER_CONFIG.vars.KIE_POLL_INTERVAL_MS).toBe("30000");
    expect(WRANGLER_CONFIG.vars.KIE_ATTEMPT_TIMEOUT_MS).toBe("900000");
  });
});

// ── Pipeline + workflow integration ─────────────────────────────────────────

async function startPipelineGeneration(screenshotKey: string): Promise<string> {
  await persistSimpleScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: SIMPLE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

/** Slow provider over the scripted pipeline helper's semantics: every task is
 *  pending for two durable probes, then completes. */
function slowPipelineProvider(): ImageGenerationProvider {
  let counter = 0;
  const pendingCounts = new Map<string, number>();
  return {
    estimateCost: () => 0.15,
    createTask: async (task) => {
      counter += 1;
      const taskId = `slow-${counter}`;
      void task;
      pendingCounts.set(taskId, 0);
      return { taskId, costUsd: 0.15 };
    },
    checkResult: async (taskId) => {
      const seen = (pendingCounts.get(taskId) ?? 0) + 1;
      pendingCounts.set(taskId, seen);
      if (seen <= 2) return { status: "pending" as const };
      return {
        status: "complete" as const,
        bytes: new TextEncoder().encode(`WEBP-${taskId}`),
        temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
      };
    },
    fetchResult: async (taskId) => ({
      status: "complete" as const,
      bytes: new TextEncoder().encode(`WEBP-${taskId}`),
      temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
    }),
  };
}

describe("durable image lifecycle integration (issue #57/#58)", () => {
  it("drives the full production pipeline to Release Ready through slow durable image polls", async () => {
    const siteGenerationId = await startPipelineGeneration("references/pipeline/orchestration-pipeline.png");
    const scripted = createSimpleScripts({});
    const slowProvider = slowPipelineProvider();

    const outcome = await runBuildPipelineWithSeams(siteGenerationId, scripted, slowProvider);
    expect(outcome.terminal).toBe("RELEASE_READY");

    const attempts = await env.DB.prepare("SELECT status, provider_task_id FROM image_attempts WHERE build_id = ? ORDER BY created_at")
      .bind(outcome.buildId!)
      .all<{ status: string; provider_task_id: string | null }>();
    expect(attempts.results.length).toBeGreaterThan(0);
    expect(attempts.results.every((row) => row.status === "succeeded" && row.provider_task_id)).toBe(true);
  });

  it("wires the workflow's durable sleep: pending image polls produce step.sleep calls, never a '2.0' step", async () => {
    const siteGenerationId = await startPipelineGeneration("references/pipeline/orchestration-workflow.png");
    const sleeps: Array<{ name: string; ms: number }> = [];
    const executed: string[] = [];
    const cache = new Map<string, unknown>();
    const engine = {
      async do(name: string, a: unknown, b?: unknown) {
        const fn = (typeof b === "function" ? b : a) as () => Promise<unknown>;
        executed.push(name);
        if (cache.has(name)) return cache.get(name);
        const result = await fn();
        cache.set(name, result);
        return result;
      },
      async sleep(name: string, duration: number | string) {
        sleeps.push({ name, ms: typeof duration === "number" ? duration : Number.parseInt(duration, 10) });
      },
      async sleepUntil() {},
    };

    const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
    workflow.pipelineDeps = { ...createSimpleScripts({}), imageProvider: slowPipelineProvider() };
    const event = { payload: { siteGenerationId }, instanceId: "wf-orchestration" } as unknown as WorkflowEvent<{ siteGenerationId: string }>;
    const result = (await workflow.run(event, engine as unknown as WorkflowStep)) as { terminal?: string };

    expect(result.terminal).toBe("RELEASE_READY");
    // The old aggregate envelope is gone (issue #57)...
    expect(executed.filter((name) => name.includes("2.0"))).toEqual([]);
    // ...and provider waiting happened through durable sleeps mapped to
    // step.sleep (issue #58 §11).
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((wait) => wait.name.startsWith("image:") && wait.name.includes(":wait:"))).toBe(true);
    expect(sleeps.every((wait) => wait.ms === 30)).toBe(true); // "30 seconds" parsed
  });
});

// runBuildPipeline with durable image seams: passthrough steps + instant
// sleeps keep the domain drive synchronous while exercising the real driver.
async function runBuildPipelineWithSeams(
  siteGenerationId: string,
  scripted: BuildPipelineDeps,
  imageProvider: ImageGenerationProvider
): Promise<{ terminal?: string; buildId?: string }> {
  const outcome = await runBuildPipeline(env, {
    siteGenerationId,
    deps: {
      ...scripted,
      imageProvider,
      sleep: async () => {},
    },
  });
  return { terminal: outcome.terminal, buildId: outcome.buildId };
}
