// Workflow-level single-flight retry-liveness tests (retry-liveness directive
// §7–§8, on top of issues #54–#56, #61, #64).
//
// The #54 single-flight yield (STAGE_EXECUTION_IN_PROGRESS) is only safe if a
// stale claim can actually be taken over BEFORE the Workflow step exhausts its
// retries. These tests prove that end to end with a policy-faithful simulated
// Workflow engine:
//
//   - retries.limit counts RETRIES, so limit 8 = the initial attempt + 8
//     retries = 9 attempts total. The Workflows docs describe limit as the
//     "total number of attempts"; the 2026-09-07 production canary proved
//     the engine's actual semantics (limit 2 produced 3 attempts, 30/30
//     instances). Issue #64 §3 pins the timeline against the PROVEN model.
//   - retries.delay may be a delay function receiving { ctx, error } (the
//     production config under test uses exactly this), and backoff
//     "constant" applies the returned value verbatim (#61).
//   - timeout ("10 minutes") is per attempt and is observed from the real
//     config the workflow hands the engine.
//   - The engine may rehydrate thrown errors so the delay function cannot
//     recognize them (#63 canary: 0/10 recognitions in production). The
//     rehydrateErrors option simulates that: correctness must hold on the
//     fallback schedule alone (#64 normative contract).
//
// The engine never sleeps: retry waits advance a virtual clock, and wall-time
// progression past a claim lease is simulated by backdating expired
// IN_PROGRESS rows in stage_execution_claims (scoped to the test's own Build),
// which is observationally identical to the lease simply going stale. The
// provider seam (the `generate` dep) stands in for the model: an owner that
// "dies" mid-call leaves its claim IN_PROGRESS with the provider call pending
// forever, exactly like a resource-killed isolate.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import type { BuildPipelineDeps } from "../src/domain/build-pipeline";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import {
  STAGE_EXECUTION_LEASE_MS,
  STAGE_EXECUTION_RETRY_MARGIN_MS,
  stageInProgressRetryAfterMs,
  StageExecutionInProgressError,
} from "../src/domain/stage-execution";
import { STAGE_STEP_RETRIES, stageStepFallbackDelayMs, WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import { submitOnboardingSubmission } from "../src/routes/v2.onboarding-submit";
import { generateId, hmacSha256 } from "../src/lib/crypto";
import { createPipelineScripts, persistPipelineScreenshot } from "./helpers/pipeline-scripts";

// ---------------------------------------------------------------------------
// stageInProgressRetryAfterMs unit behavior (the typed wait metadata).
// ---------------------------------------------------------------------------

describe("stageInProgressRetryAfterMs", () => {
  const future = new Date(Date.now() + 600_000).toISOString();

  it("computes wake time at lease expiry plus margin from the typed error", () => {
    const now = Date.now();
    const wait = stageInProgressRetryAfterMs(new StageExecutionInProgressError("k", future), now);
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(600_000);
    expect(wait!).toBeLessThanOrEqual(600_000 + STAGE_EXECUTION_RETRY_MARGIN_MS + 1);
  });

  it("recognizes a rehydrated plain Error by its stable message prefix", () => {
    const rehydrated = new Error(
      `STAGE_EXECUTION_IN_PROGRESS: another execution owns stage 'k' until ${future}; the provider call is single-flight (issue #54)`
    );
    const now = Date.now();
    expect(stageInProgressRetryAfterMs(rehydrated, now)).toEqual(
      stageInProgressRetryAfterMs(new StageExecutionInProgressError("k", future), now)
    );
  });

  it("returns null for unrelated transient errors so the fallback backoff applies", () => {
    expect(stageInProgressRetryAfterMs(new Error("provider 503"))).toBeNull();
    expect(stageInProgressRetryAfterMs(null)).toBeNull();
    expect(stageInProgressRetryAfterMs(new Error("STAGE_EXECUTION_IN_PROGRESS: corrupted payload until not-a-date;"))).toBeNull();
  });

  it("never returns a negative wait for an already-expired lease", () => {
    const slightlyStale = new Date(Date.now() - 5_000).toISOString();
    expect(stageInProgressRetryAfterMs(new StageExecutionInProgressError("k", slightlyStale))).toEqual(10_000);
    const longExpired = new Date(Date.now() - 600_000).toISOString();
    expect(stageInProgressRetryAfterMs(new StageExecutionInProgressError("k", longExpired))).toEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Simulated Workflow engine: implements the documented platform retry
// semantics against the REAL step config the workflow passes in.
// ---------------------------------------------------------------------------

interface EngineEvent {
  step: string;
  kind: "attempt" | "wait" | "killed" | "result" | "exhausted";
  attempt?: number;
  delayMs?: number;
  waitKind?: "in_progress_wait" | "fallback_backoff";
}

type StepConfig = {
  retries?: { limit?: number; delay?: unknown; backoff?: string };
  timeout?: string | number;
};

class ScenarioComplete extends Error {
  constructor(readonly result: unknown) {
    super("scenario drive complete");
  }
}

function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*(millisecond|second|minute|hour)s?$/.exec(value.trim());
  if (!match) throw new Error(`simulated engine cannot parse duration: ${value}`);
  const scale = match[2] === "millisecond" ? 1 : match[2] === "second" ? 1000 : match[2] === "minute" ? 60_000 : 3_600_000;
  return Number(match[1]) * scale;
}

class RetryEngine {
  readonly events: EngineEvent[] = [];
  readonly configsSeen = new Map<string, StepConfig>();
  private readonly attempts = new Map<string, number>();
  private virtualElapsedMs = 0;
  private readonly startedAtRealMs = Date.now();

  constructor(
    private readonly env: Env,
    /** Resolved when the engine observes the initial Build id (step 1.0). */
    private readonly buildIdRef: { current: string | null },
    private readonly options: {
      /** §7: resolves when the harness simulates a resource kill of the
       *  in-flight FIRST attempt of the site-generation step (owner dies
       *  mid-provider-call). */
      killFirstGenerateAttempt?: () => Promise<null>;
      /** §8: the engine pauses before advancing its clock past a retry wait
       *  until this resolves — lets the harness order a slow owner's real
       *  completion before a waiter's virtual wake-up. */
      holdClockUntil?: Promise<unknown>;
      /** §8: end the drive cleanly as soon as a step with this name prefix
       *  resolves. */
      completeAfterResultOf?: string;
      /** #64 §4/§5: simulate the production rehydration proven by the #63
       *  canary — the delay function receives a GENERIC Error with no
       *  recognizable identity or message structure, so the lease-aware
       *  branch can never fire and the fallback schedule governs. */
      rehydrateErrors?: boolean;
    } = {}
  ) {}

  waits(waitKind: EngineEvent["waitKind"]): EngineEvent[] {
    return this.events.filter((event) => event.kind === "wait" && event.waitKind === waitKind);
  }

  async do(_name: string, a: unknown, b?: unknown): Promise<unknown> {
    const name = _name as string;
    const hasConfig = typeof b === "function";
    const fn = (hasConfig ? b : a) as () => Promise<unknown>;
    const config = (hasConfig ? a : undefined) as StepConfig | undefined;
    this.configsSeen.set(name, config ?? {});
    const attempt = (this.attempts.get(name) ?? 0) + 1;
    this.attempts.set(name, attempt);
    this.events.push({ step: name, kind: "attempt", attempt });

    const isGenerateStep = name.startsWith("pipeline: generate site");
    if (attempt === 1 && isGenerateStep && this.options.killFirstGenerateAttempt) {
      const abandoned = fn();
      const killed = await Promise.race([
        abandoned.then(
          () => "done" as const,
          () => "done" as const
        ),
        this.options.killFirstGenerateAttempt().then(() => "killed" as const),
      ]);
      if (killed === "killed") {
        // The isolate died mid-provider-call: the attempt is abandoned (its
        // runStageSingleFlight never resolves or releases the claim) and the
        // platform re-attempts the step.
        this.events.push({ step: name, kind: "killed", attempt });
        await this.advanceClock(10_000);
        return await this.do(name, a, b);
      }
      if (this.options.completeAfterResultOf && name.startsWith(this.options.completeAfterResultOf)) {
        // Unreachable in these scenarios; kept for symmetry.
        throw new ScenarioComplete(undefined);
      }
      return await abandoned;
    }

    try {
      const result = await fn();
      this.events.push({ step: name, kind: "result", attempt });
      if (name === "1.0 resolve Build and immutable Build Version 1") {
        const buildId = (result as { buildId?: string }).buildId;
        if (buildId) this.buildIdRef.current = buildId;
      }
      if (this.options.completeAfterResultOf && name.startsWith(this.options.completeAfterResultOf)) {
        throw new ScenarioComplete(result);
      }
      return result;
    } catch (error) {
      if (error instanceof ScenarioComplete) throw error;
      // Proven platform semantics (#63 canary, 30/30 instances): limit counts
      // RETRIES — total attempts = limit + 1.
      const limit = config?.retries?.limit ?? 5; // documented platform default
      if (attempt >= limit + 1) {
        this.events.push({ step: name, kind: "exhausted", attempt });
        throw error;
      }
      // #64: under rehydrateErrors the delay function — and the wait
      // classification — observe the generic rehydrated shape, exactly as
      // production hands it to the WorkflowDelayFunction.
      const observedError = this.options.rehydrateErrors
        ? new Error("rehydrated: original error identity not preserved by the runtime")
        : error;
      const delayMs = this.resolveDelay(config, attempt, observedError);
      this.events.push({
        step: name,
        kind: "wait",
        attempt,
        delayMs,
        waitKind: stageInProgressRetryAfterMs(observedError) !== null ? "in_progress_wait" : "fallback_backoff",
      });
      if (this.options.holdClockUntil) await this.options.holdClockUntil;
      await this.advanceClock(delayMs);
      return await this.do(name, a, b);
    }
  }

  // The delay-resolution half of the platform contract, CORRECTED by the
  // 2026-09-07 forensics (raw REST evidence): the resolved delay — delay
  // function wins, then static config, then the documented default (10s) —
  // is then MULTIPLIED by the backoff curve. backoff defaults to
  // "exponential" (×2 per retry) when unspecified; "constant" applies the
  // delay value verbatim (issue #61 single ownership).
  private resolveDelay(config: StepConfig | undefined, failedAttempt: number, error: unknown): number {
    const raw = config?.retries?.delay;
    let resolved: number;
    if (typeof raw === "function") {
      const returned = (raw as (input: { ctx: { attempt: number }; error: Error }) => unknown)({
        ctx: { attempt: failedAttempt },
        error: error instanceof Error ? error : new Error(String(error)),
      });
      resolved = typeof returned === "number" ? returned : parseDurationSeconds(returned as string);
    } else if (typeof raw === "number") {
      resolved = raw;
    } else if (typeof raw === "string") {
      resolved = parseDurationSeconds(raw);
    } else {
      resolved = 10_000;
    }
    const backoff = config?.retries?.backoff ?? "exponential"; // platform default
    return backoff === "exponential" ? resolved * 2 ** (failedAttempt - 1) : resolved;
  }

  /** Advance the virtual clock by a retry wait and simulate wall-clock
   *  progression: any IN_PROGRESS claim of THIS Build whose lease the virtual
   *  clock has passed is backdated into the past, so the next attempt observes
   *  it exactly as it would after real time had elapsed. */
  private async advanceClock(delayMs: number): Promise<void> {
    this.virtualElapsedMs += delayMs;
    if (!this.buildIdRef.current) return;
    const virtualNowIso = new Date(this.startedAtRealMs + this.virtualElapsedMs).toISOString();
    await this.env.DB.prepare(
      `UPDATE stage_execution_claims SET lease_expires_at = ?1
       WHERE build_id = ?2 AND state = 'IN_PROGRESS' AND lease_expires_at <= ?3`
    )
      .bind(new Date(this.startedAtRealMs - 1_000).toISOString(), this.buildIdRef.current, virtualNowIso)
      .run();
  }
}

// ---------------------------------------------------------------------------
// Seeding helpers (screenshot+URL submission, mirroring tests/v2-lifecycle).
// ---------------------------------------------------------------------------

function runtimeEnv(): Env {
  return {
    ...(providedEnv as unknown as Env),
    WEBHOOK_SECRET: "test-webhook-secret",
    WEBSITE_BUILD_WORKFLOW: { create: async () => ({ id: `wf-${generateId()}` }) } as unknown as Workflow,
  };
}

async function postScreenshotSubmission(env: Env): Promise<string> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/onboarding-submissions", submitOnboardingSubmission);
  const key = `references/liveness/${generateId()}.png`;
  await persistPipelineScreenshot(env, key);
  const raw = JSON.stringify({
    submission: {
      buildMode: "REFERENCE_BOUND",
      facts: {
        businessName: "Liveness Overlap Traders",
        contactEmail: "hello@liveness.example",
        businessType: "trading desk",
        businessDescription: "Boutique trading desk for regional markets.",
        city: "Nakuru",
        country: "Kenya",
      },
      reference: { url: "https://meridian-atelier.example.com/", screenshotR2Key: key },
    },
  });
  const response = await app.request("https://test.example.com/api/v2/onboarding-submissions", {
    method: "POST",
    headers: { "content-type": "application/json", "X-Signature": await hmacSha256(env.WEBHOOK_SECRET, raw) },
    body: raw,
  }, env);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { siteGenerationId: string };
  return body.siteGenerationId;
}

async function driveWorkflow(
  env: Env,
  siteGenerationId: string,
  engine: RetryEngine,
  deps: BuildPipelineDeps,
  workflowInstanceId?: string
): Promise<unknown> {
  const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
  workflow.pipelineDeps = deps;
  const event = {
    payload: { siteGenerationId },
    instanceId: workflowInstanceId,
  } as unknown as WorkflowEvent<{ siteGenerationId: string }>;
  return await workflow.run(event, engine as unknown as WorkflowStep);
}

async function waitFor<T>(probe: () => T | null | Promise<T | null>, what: string): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

interface ClaimRow {
  execution_key: string;
  owner_token: string;
  lease_expires_at: string;
  state: string;
}

async function waitForLiveSiteCssClaim(env: Env, buildIdRef: { current: string | null }): Promise<ClaimRow> {
  return await waitFor(async () => {
    if (!buildIdRef.current) return null;
    return await env.DB.prepare(
      `SELECT execution_key, owner_token, lease_expires_at, state FROM stage_execution_claims
       WHERE build_id = ?1 AND stage_kind = 'generated_shared_source' AND subkey = 'site.css' AND state = 'IN_PROGRESS'
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(buildIdRef.current)
      .first<ClaimRow>();
  }, "live site.css execution claim");
}

// ---------------------------------------------------------------------------
// Workflow-level liveness scenarios.
// ---------------------------------------------------------------------------

describe("single-flight retry liveness (workflow level)", () => {
  it("pins the production stage-step retry constants the liveness math relies on (directive §1)", () => {
    expect(STAGE_EXECUTION_LEASE_MS).toEqual(660_000);
    // Repo-owned fallback schedule: even without the IN_PROGRESS delay
    // function, the cumulative fallback horizon from the first failure
    // through the last of 8 total attempts stays beyond the 660s lease.
    const horizon = [1, 2, 3, 4, 5, 6, 7].reduce((sum, attempt) => sum + stageStepFallbackDelayMs(attempt), 0);
    expect(stageStepFallbackDelayMs(1)).toEqual(10_000);
    expect(stageStepFallbackDelayMs(7)).toEqual(640_000);
    expect(stageStepFallbackDelayMs(9)).toEqual(1_280_000); // capped
    expect(horizon).toBeGreaterThan(660_000);
  });

  // Issue #64 §3: the exact fallback timeline under the PROVEN limit
  // semantics (limit counts retries — #63 canary, 30/30 instances; the old
  // "limit ambiguity" language is retired). Required invariant: the first
  // stale-eligible retry occurs before retry exhaustion, with at least one
  // attempt to spare.
  it("records the proven fallback timeline: stale takeover at retry 7 of 8, one spare attempt (issue #64 §3)", () => {
    const LEASE_HORIZON_MS = STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS; // 675s
    const LIMIT = 8; // production STAGE_STEP_RETRIES.limit = 8 retries
    const retryDelays = Array.from({ length: LIMIT }, (_, index) => stageStepFallbackDelayMs(index + 1));
    expect(retryDelays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000]);

    // Wake time of each post-initial attempt (attempt k starts after retries
    // 1..k-1 have elapsed).
    const timeline: Array<{ attempt: number; retry: number | null; wakeSeconds: number }> = [
      { attempt: 1, retry: null, wakeSeconds: 0 },
    ];
    let cumulative = 0;
    for (let retry = 1; retry <= LIMIT; retry++) {
      cumulative += retryDelays[retry - 1];
      timeline.push({ attempt: retry + 1, retry, wakeSeconds: cumulative / 1000 });
    }
    expect(timeline.map((row) => row.wakeSeconds)).toEqual([0, 10, 30, 70, 150, 310, 630, 1270, 2550]);

    // The invariant: the FIRST retry whose wake passes the lease horizon
    // (lease 660s + margin 15s = 675s) is retry 7 (attempt 8, t=1270s) —
    // before exhaustion (retry 8 / attempt 9 still unused).
    const firstStaleEligible = timeline.find((row) => row.retry !== null && row.wakeSeconds * 1000 >= LEASE_HORIZON_MS)!;
    expect(firstStaleEligible).toEqual({ attempt: 8, retry: 7, wakeSeconds: 1270 });
    const spareAttempts = LIMIT + 1 - firstStaleEligible.attempt;
    expect(spareAttempts).toBeGreaterThanOrEqual(1);
    // Delay values are finite, non-negative, clamped (issue #61 §26):
    for (const delay of retryDelays) {
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1_280_000);
    }
    // The full fallback horizon is bounded: 2550s (~42.5 min), not hours.
    expect(cumulative).toEqual(2_550_000);
  });

  // Issue #61 §3: the Workflow configuration is pinned to
  // delay = dynamic function + backoff = "constant". The 2026-09-07 forensic
  // run proved the engine DEFAULTS backoff to "exponential" when the key is
  // omitted and multiplies the delay function's return by 2^(attempt-1) —
  // turning the 10→20→40s schedule into 10→40→160→640→2560s (the "wedge").
  // Do not rely on the platform to infer single ownership.
  it("pins the stage-step retry config to a dynamic delay with constant backoff (issue #61 §1/§3)", () => {
    expect(STAGE_STEP_RETRIES.limit).toEqual(8);
    expect(STAGE_STEP_RETRIES.backoff).toEqual("constant");
    expect(typeof STAGE_STEP_RETRIES.delay).toEqual("function");
    // The dynamic function keeps both branches: the lease-aware IN_PROGRESS
    // wait (never multiplied in config — backoff is constant) and the
    // repo-owned fallback.
    const future = new Date(Date.now() + 600_000).toISOString();
    const leaseAware = STAGE_STEP_RETRIES.delay({ ctx: { attempt: 3 }, error: new StageExecutionInProgressError("k", future) });
    expect(leaseAware).toMatch(/^\d+ seconds$/);
    expect(leaseAware).not.toEqual("10 seconds");
    const fallback = STAGE_STEP_RETRIES.delay({ ctx: { attempt: 3 }, error: new Error("provider 503") });
    expect(fallback).toEqual(40_000); // repo-owned schedule, number-of-ms form
  });

  it("dead owner: stale takeover is reachable before retry exhaustion; the replacement owner alone completes the provider call (§7)", async () => {
    const env = runtimeEnv();
    const siteGenerationId = await postScreenshotSubmission(env);
    const buildIdRef = { current: null as string | null };

    const entries = { siteCss: 0 };
    let triggerKill: (() => void) | null = null;
    const killSignal = new Promise<null>((resolveKill) => {
      triggerKill = () => resolveKill(null);
    });

    const base = createPipelineScripts();
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("shared stylesheet")) {
        entries.siteCss += 1;
        if (entries.siteCss === 1) {
          triggerKill!(); // engine: simulate the resource kill of this attempt
          return new Promise<never>(() => {}); // owner hangs forever; claim stays IN_PROGRESS
        }
      }
      return base.generate(system, user);
    };
    const deps: BuildPipelineDeps = { ...base, generate };

    const engine = new RetryEngine(env, buildIdRef, { killFirstGenerateAttempt: () => killSignal });
    const result = (await driveWorkflow(env, siteGenerationId, engine, deps, "wf-liveness-dead-owner")) as {
      buildId: string;
      terminal: string;
    };

    // The workflow reached its domain terminal state — it did NOT exhaust.
    expect(result.terminal).toEqual("RELEASE_READY");
    expect(buildIdRef.current).toEqual(result.buildId);
    expect(engine.events.some((event) => event.kind === "exhausted")).toBe(false);

    // The Build carries the owning workflow instance (issue #56 sweep input —
    // the forensic snapshot found NO code path ever wrote this column).
    const buildRow = await env.DB.prepare("SELECT workflow_instance_id FROM builds WHERE id = ?1")
      .bind(result.buildId)
      .first<{ workflow_instance_id: string | null }>();
    expect(buildRow?.workflow_instance_id).toEqual("wf-liveness-dead-owner");

    // Attempt timeline for the generate step: killed owner -> IN_PROGRESS
    // yield -> takeover. Comfortably inside the 8 total attempts.
    const generateEvents = engine.events.filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(generateEvents.map((event) => event.kind)).toEqual(["attempt", "killed", "attempt", "wait", "attempt", "result"]);

    // The IN_PROGRESS wait targeted lease expiry (+ margin), not a blind
    // backoff step.
    const inProgressWaits = engine.waits("in_progress_wait").filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(inProgressWaits).toHaveLength(1);
    expect(inProgressWaits[0].delayMs!).toBeGreaterThan(600_000);
    expect(inProgressWaits[0].delayMs!).toBeLessThanOrEqual(STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS + 1_000);

    // The dead owner's call never completed; exactly one provider call — by
    // the replacement owner — produced the artifact.
    expect(entries.siteCss).toEqual(2);

    const claim = await env.DB.prepare(
      `SELECT state FROM stage_execution_claims WHERE build_id = ?1 AND stage_kind = 'generated_shared_source' AND subkey = 'site.css'`
    )
      .bind(result.buildId)
      .first<ClaimRow>();
    expect(claim?.state).toEqual("COMPLETED");

    // The production config the engine observed for the generate step
    // (directive §1's required record, pinned against drift). backoff is
    // pinned "constant" (issue #61 §3): the dynamic function owns the whole
    // schedule; the engine must not multiply it.
    const config = engine.configsSeen.get("pipeline: generate site (v1)") ?? {};
    expect((config.retries as { limit?: number }).limit).toEqual(8);
    expect(config.timeout).toEqual("10 minutes");
    expect(typeof (config.retries as { delay?: unknown }).delay).toEqual("function");
    expect((config.retries as { backoff?: string }).backoff).toEqual("constant");
  });

  it("healthy slow owner: overlapping execution never calls the provider, never steals the lease, and reuses the COMPLETED artifact (§8)", async () => {
    const env = runtimeEnv();
    const siteGenerationId = await postScreenshotSubmission(env);
    const buildIdRef = { current: null as string | null };

    const entries = { siteCss: 0 };
    const base = createPipelineScripts();
    const releaseGate: { release: (() => void) | null } = { release: null };
    // Shared provider seam for BOTH drives (one production provider surface).
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("shared stylesheet")) {
        entries.siteCss += 1;
        if (entries.siteCss === 1) {
          // Owner A hangs in the provider until the test releases it.
          return new Promise((resolve, reject) => {
            releaseGate.release = () => {
              void base.generate(system, user).then(resolve, reject);
            };
          });
        }
      }
      return base.generate(system, user);
    };
    const deps: BuildPipelineDeps = { ...base, generate };

    // Drive A: the legitimate slow owner.
    const engineA = new RetryEngine(env, buildIdRef);
    const driveA = driveWorkflow(env, siteGenerationId, engineA, deps, "wf-liveness-owner-a");
    const claimDuringOwnership = await waitForLiveSiteCssClaim(env, buildIdRef);
    expect(entries.siteCss).toEqual(1);

    // Drive B: an overlapping execution (engine restart / re-entry) of the
    // SAME generation while A's lease is live. B ends cleanly once its
    // generate step resolves (the scenario is complete at the reuse).
    // B's clock is held until A has fully completed, mirroring real time
    // (A finishes inside its lease, BEFORE any waiter's virtual wake-up).
    const ownerCompleted = new Promise<null>((resolve) => {
      void driveA.then(() => resolve(null), () => resolve(null));
    });
    const engineB = new RetryEngine(env, buildIdRef, {
      completeAfterResultOf: "pipeline: generate site",
      holdClockUntil: ownerCompleted,
    });
    const driveB = driveWorkflow(env, siteGenerationId, engineB, deps, "wf-liveness-overlap-b").catch((error) => {
      if (error instanceof ScenarioComplete) return error.result;
      throw error;
    });

    // B must yield with STAGE_EXECUTION_IN_PROGRESS exactly once, waiting out
    // the live owner's lease — it entered NO provider call.
    await waitFor(
      () => (engineB.waits("in_progress_wait").some((event) => event.step.startsWith("pipeline: generate site")) ? true : null),
      "B's IN_PROGRESS yield"
    );
    const bWait = engineB.waits("in_progress_wait").find((event) => event.step.startsWith("pipeline: generate site"))!;
    expect(bWait.delayMs!).toBeGreaterThan(600_000);
    expect(bWait.delayMs!).toBeLessThanOrEqual(STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS + 1_000);
    expect(entries.siteCss).toEqual(1);

    // While B waited, the claim was untouched (no steal): same owner token,
    // lease still live.
    const claimDuringWait = await waitForLiveSiteCssClaim(env, buildIdRef);
    expect(claimDuringWait.owner_token).toEqual(claimDuringOwnership.owner_token);
    expect(claimDuringWait.execution_key).toEqual(claimDuringOwnership.execution_key);

    // A completes its legitimate provider call and its whole drive.
    releaseGate.release!();
    const resultA = (await driveA) as { buildId: string; terminal: string };
    expect(resultA.terminal).toEqual("RELEASE_READY");
    expect(entries.siteCss).toEqual(1);

    // B's parked attempt now wakes past lease expiry, finds the COMPLETED
    // claim with its artifact, and reuses — zero provider calls.
    const resultB = (await driveB) as unknown;
    expect(resultB).toBeDefined();
    expect(entries.siteCss).toEqual(1);

    const bGenerateEvents = engineB.events.filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(bGenerateEvents.map((event) => event.kind)).toEqual(["attempt", "wait", "attempt", "result"]);

    const claim = await env.DB.prepare(
      `SELECT state FROM stage_execution_claims WHERE build_id = ?1 AND stage_kind = 'generated_shared_source' AND subkey = 'site.css'`
    )
      .bind(resultA.buildId)
      .first<ClaimRow>();
    expect(claim?.state).toEqual("COMPLETED");

    // B (a different instance) adopted the Build but never stole A's
    // instance mapping — first writer wins (issue #56 sweep input stays
    // truthful about the instance that owns the Build).
    const buildRow = await env.DB.prepare("SELECT workflow_instance_id FROM builds WHERE id = ?1")
      .bind(resultA.buildId)
      .first<{ workflow_instance_id: string | null }>();
    expect(buildRow?.workflow_instance_id).toEqual("wf-liveness-owner-a");
  });

  // ---------------------------------------------------------------------------
  // #64 §4/§5: the NORMATIVE fallback-only contract. The engine rehydrates
  // every thrown error into a generic Error (as the #63 canary proved
  // production does), so the lease-aware branch can never fire. Correctness
  // must come from the atomic claim + immutable reuse + bounded fallback
  // schedule + stale takeover — never from error recognition.
  // ---------------------------------------------------------------------------

  it("fallback-only dead owner: takeover lands on attempt 8 of 9 via the fallback schedule; exactly one replacement provider call (§4)", async () => {
    const env = runtimeEnv();
    const siteGenerationId = await postScreenshotSubmission(env);
    const buildIdRef = { current: null as string | null };

    const entries = { siteCss: 0 };
    let triggerKill: (() => void) | null = null;
    const killSignal = new Promise<null>((resolveKill) => {
      triggerKill = () => resolveKill(null);
    });

    const base = createPipelineScripts();
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("shared stylesheet")) {
        entries.siteCss += 1;
        if (entries.siteCss === 1) {
          triggerKill!(); // owner dies mid-provider-call; claim stays IN_PROGRESS
          return new Promise<never>(() => {});
        }
      }
      return base.generate(system, user);
    };
    const deps: BuildPipelineDeps = { ...base, generate };

    const engine = new RetryEngine(env, buildIdRef, {
      killFirstGenerateAttempt: () => killSignal,
      rehydrateErrors: true, // recognition deliberately disabled — generic Errors only
    });
    const result = (await driveWorkflow(env, siteGenerationId, engine, deps, "wf-fallback-dead-owner")) as {
      buildId: string;
      terminal: string;
      reasons?: string[];
    };

    // The workflow completed on the fallback schedule alone.
    if (result.terminal !== "RELEASE_READY") {
      const events = await env.DB.prepare("SELECT to_state, stage, detail FROM build_workflow_events WHERE build_id = ?1 ORDER BY created_at DESC LIMIT 6")
        .bind(result.buildId)
        .all<{ to_state: string; stage: string; detail: string }>();
      console.log(
        `(diag) fallback_only_dead_owner_failure ${JSON.stringify(
          { terminal: result.terminal, reasons: result.reasons, exhausted: engine.events.filter((event) => event.kind === "exhausted"), tail: events.results },
          null,
          1
        )}`
      );
    }
    expect(result.terminal).toEqual("RELEASE_READY");
    expect(engine.events.some((event) => event.kind === "exhausted")).toBe(false);

    // No lease-aware wait ever fired: every retry wait is the plain fallback.
    expect(engine.waits("in_progress_wait")).toHaveLength(0);
    // Retry 1 (after the kill) is the engine's own 10s re-schedule (not a
    // recorded wait); retries 2-7 record the fallback values 20s..640s.
    const fallbackWaits = engine.waits("fallback_backoff").filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(fallbackWaits.map((event) => event.delayMs)).toEqual([20_000, 40_000, 80_000, 160_000, 320_000, 640_000]);

    // Attempt timeline: killed owner -> 6 protected IN_PROGRESS yields while
    // the lease is live -> takeover on attempt 8 (t=1270s, past the 660s
    // lease) -> success. Attempt 9 stays unused (one spare).
    const generateEvents = engine.events.filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(generateEvents.map((event) => event.kind)).toEqual([
      "attempt", "killed",
      "attempt", "wait",
      "attempt", "wait",
      "attempt", "wait",
      "attempt", "wait",
      "attempt", "wait",
      "attempt", "wait",
      "attempt", "result",
    ]);
    const attempts = generateEvents.filter((event) => event.kind === "attempt").length;
    expect(attempts).toEqual(8);

    // Exactly one replacement provider call; the hung initial call never
    // produced an artifact; the claim ended COMPLETED under the new owner.
    expect(entries.siteCss).toEqual(2);
    const claim = await env.DB.prepare(
      `SELECT state FROM stage_execution_claims WHERE build_id = ?1 AND stage_kind = 'generated_shared_source' AND subkey = 'site.css'`
    )
      .bind(result.buildId)
      .first<ClaimRow>();
    expect(claim?.state).toEqual("COMPLETED");
  });

  it("fallback-only healthy owner: the contender's fallback re-entry finds the COMPLETED artifact and never calls the provider (§5)", async () => {
    const env = runtimeEnv();
    const siteGenerationId = await postScreenshotSubmission(env);
    const buildIdRef = { current: null as string | null };

    const entries = { siteCss: 0 };
    const base = createPipelineScripts();
    const releaseGate: { release: (() => void) | null } = { release: null };
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("shared stylesheet")) {
        entries.siteCss += 1;
        if (entries.siteCss === 1) {
          // Owner A hangs in the provider until released; it legitimately
          // owns the claim and finishes well inside its lease.
          return new Promise((resolve, reject) => {
            releaseGate.release = () => {
              void base.generate(system, user).then(resolve, reject);
            };
          });
        }
      }
      return base.generate(system, user);
    };
    const deps: BuildPipelineDeps = { ...base, generate };

    // Drive A: the legitimate slow owner (its own drive, no rehydration —
    // the owner never yields anyway).
    const engineA = new RetryEngine(env, buildIdRef);
    const driveA = driveWorkflow(env, siteGenerationId, engineA, deps, "wf-fallback-owner-a");
    await waitForLiveSiteCssClaim(env, buildIdRef);
    expect(entries.siteCss).toEqual(1);

    // Drive B: overlapping contender with recognition DISABLED. Its yield is
    // classified as an ordinary fallback wait, never a lease-aware one.
    const ownerCompleted = new Promise<null>((resolve) => {
      void driveA.then(() => resolve(null), () => resolve(null));
    });
    const engineB = new RetryEngine(env, buildIdRef, {
      completeAfterResultOf: "pipeline: generate site",
      holdClockUntil: ownerCompleted,
      rehydrateErrors: true,
    });
    const driveB = driveWorkflow(env, siteGenerationId, engineB, deps, "wf-fallback-overlap-b").catch((error) => {
      if (error instanceof ScenarioComplete) return error.result;
      throw error;
    });

    // B yields once on the fallback schedule while A's claim is live.
    await waitFor(
      () => (engineB.waits("fallback_backoff").some((event) => event.step.startsWith("pipeline: generate site")) ? true : null),
      "B's fallback yield"
    );
    const bWait = engineB.waits("fallback_backoff").find((event) => event.step.startsWith("pipeline: generate site"))!;
    expect(bWait.delayMs).toEqual(10_000);
    expect(engineB.waits("in_progress_wait")).toHaveLength(0);
    // The live claim was never stolen and never re-called the provider.
    expect(entries.siteCss).toEqual(1);

    // A finishes; B's next fallback wake loads the COMPLETED artifact.
    releaseGate.release!();
    const resultA = (await driveA) as { buildId: string; terminal: string };
    expect(resultA.terminal).toEqual("RELEASE_READY");
    const resultB = (await driveB) as unknown;
    expect(resultB).toBeDefined();
    expect(entries.siteCss).toEqual(1); // contender provider calls = 0

    const bGenerateEvents = engineB.events.filter((event) => event.step.startsWith("pipeline: generate site"));
    expect(bGenerateEvents.map((event) => event.kind)).toEqual(["attempt", "wait", "attempt", "result"]);
  });
});
