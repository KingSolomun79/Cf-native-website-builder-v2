// Ported infrastructure assertions (legacy-cleanup C4, operator GO §9).
//
// These unit/config assertions previously lived inside legacy-pipeline-driven
// test files (v2-workflow-retry-liveness, v2-deterministic-stage-failures,
// v2-do-reset-resilience). The legacy pipeline is gone; the CONTRACTS these
// assertions pin are shared Workflow/stage infrastructure and must survive:
//
//   - stageInProgressRetryAfterMs typed-wait math (#54/#64),
//   - the production stage-step retry constants and fallback schedule
//     (#61/#63/#64 — limit counts retries; backoff must stay "constant"),
//   - stage-failure classification semantics (#62 §5/#70 §23),
//   - the engine boundary NonRetryableError mapping.
//
// The workflow-level takeover/replay SCENARIOS that drove the legacy chain are
// retired with it; the takeover mechanism itself (claim steal, collision
// classification, single-flight yield) remains covered by
// tests/v2-stage-single-flight.test.ts, and the terminal reconciliation sweep
// by tests/v2-workflow-reconciliation.test.ts.
import { describe, expect, it } from "vitest";
import { NonRetryableError } from "cloudflare:workflows";
import {
  STAGE_EXECUTION_LEASE_MS,
  STAGE_EXECUTION_RETRY_MARGIN_MS,
  stageInProgressRetryAfterMs,
  StageExecutionInProgressError,
  StageExecutionCollisionError,
} from "../src/domain/stage-execution";
import { STAGE_STEP_RETRIES, stageStepFallbackDelayMs, toWorkflowStepError } from "../src/workflows/website-build-workflow";
import { classifyStageFailure, isTransientPlatformResetError } from "../src/domain/stage-failure";
import { StageArtifactError } from "../src/domain/stage-artifacts";
import { ImageBudgetExceededError } from "../src/domain/image-pipeline";
import { AiStageSchemaInvalidError } from "../src/domain/ai-boundary";
import { OriginalDesignNotEnabledError } from "../src/domain/original-design-lock";
import { ZaiCodingPlanTransportError } from "../src/lib/zai-coding-plan";

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

describe("single-flight retry liveness pins", () => {
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

  it("records the proven fallback timeline: stale takeover at retry 7 of 8, one spare attempt (issue #64 §3)", () => {
    const LEASE_HORIZON_MS = STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS; // 675s
    const LIMIT = 8; // production STAGE_STEP_RETRIES.limit = 8 retries
    const retryDelays = Array.from({ length: LIMIT }, (_, index) => stageStepFallbackDelayMs(index + 1));
    expect(retryDelays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 320_000, 640_000, 1_280_000]);

    const timeline: Array<{ attempt: number; retry: number | null; wakeSeconds: number }> = [
      { attempt: 1, retry: null, wakeSeconds: 0 },
    ];
    let cumulative = 0;
    for (let retry = 1; retry <= LIMIT; retry++) {
      cumulative += retryDelays[retry - 1];
      timeline.push({ attempt: retry + 1, retry, wakeSeconds: cumulative / 1000 });
    }
    expect(timeline.map((row) => row.wakeSeconds)).toEqual([0, 10, 30, 70, 150, 310, 630, 1270, 2550]);

    const firstStaleEligible = timeline.find((row) => row.retry !== null && row.wakeSeconds * 1000 >= LEASE_HORIZON_MS)!;
    expect(firstStaleEligible).toEqual({ attempt: 8, retry: 7, wakeSeconds: 1270 });
    const spareAttempts = LIMIT + 1 - firstStaleEligible.attempt;
    expect(spareAttempts).toBeGreaterThanOrEqual(1);
    for (const delay of retryDelays) {
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1_280_000);
    }
    expect(cumulative).toEqual(2_550_000);
  });

  it("pins the stage-step retry config to a dynamic delay with constant backoff (issue #61 §1/§3)", () => {
    expect(STAGE_STEP_RETRIES.limit).toEqual(8);
    expect(STAGE_STEP_RETRIES.backoff).toEqual("constant");
    expect(typeof STAGE_STEP_RETRIES.delay).toEqual("function");
    const future = new Date(Date.now() + 600_000).toISOString();
    const leaseAware = STAGE_STEP_RETRIES.delay({ ctx: { attempt: 3 }, error: new StageExecutionInProgressError("k", future) });
    expect(leaseAware).toMatch(/^\d+ seconds$/);
    expect(leaseAware).not.toEqual("10 seconds");
    const fallback = STAGE_STEP_RETRIES.delay({ ctx: { attempt: 3 }, error: new Error("provider 503") });
    expect(fallback).toEqual(40_000); // repo-owned schedule, number-of-ms form
  });
});

describe("stage-failure classification (issue #62 §5, legacy stages removed)", () => {
  it("classifies schema-invalid AI output after bounded internal repair as DETERMINISTIC_REVIEW_REQUIRED", () => {
    expect(classifyStageFailure(new AiStageSchemaInvalidError("simple-website-builder", "run-1", []))).toEqual(
      "DETERMINISTIC_REVIEW_REQUIRED"
    );
  });

  it("classifies the ORIGINAL_DESIGN deferred-mode lock as TERMINAL_INVARIANT — no retry burn on a deterministic refusal", () => {
    expect(classifyStageFailure(new OriginalDesignNotEnabledError())).toEqual("TERMINAL_INVARIANT");
  });

  it("classifies integrity/spend violations as TERMINAL_INVARIANT", () => {
    expect(classifyStageFailure(new StageExecutionCollisionError("claim corruption"))).toEqual("TERMINAL_INVARIANT");
    expect(classifyStageFailure(new ImageBudgetExceededError(3.0, 0.15, 3.0))).toEqual("TERMINAL_INVARIANT");
    expect(
      classifyStageFailure(new StageArtifactError("REPAIR_ARTIFACT_MISMATCH", "fingerprint mismatch"))
    ).toEqual("TERMINAL_INVARIANT");
  });

  it("keeps transient and unknown failures retryable (§17) — never routed to review", () => {
    expect(classifyStageFailure(new StageExecutionInProgressError("k", "2026-01-01T00:00:00.000Z"))).toEqual(
      "TRANSIENT_RETRYABLE"
    );
    expect(classifyStageFailure(new Error("temporary provider outage: 503"))).toEqual("TRANSIENT_RETRYABLE");
    // The Coding Plan transport already bounded its own attempts; a spent
    // transport budget stays an operational transient for the engine schedule.
    expect(classifyStageFailure(new ZaiCodingPlanTransportError("stage", []))).toEqual("TRANSIENT_RETRYABLE");
    expect(classifyStageFailure(null)).toEqual("TRANSIENT_RETRYABLE");
  });

  it("maps non-transient classes to NonRetryableError at the engine boundary and leaves transients untouched", () => {
    expect(toWorkflowStepError(new AiStageSchemaInvalidError("simple-website-builder", "run-1", []))).toBeInstanceOf(
      NonRetryableError
    );
    expect(toWorkflowStepError(new StageExecutionCollisionError("mismatch"))).toBeInstanceOf(NonRetryableError);
    const transient = new StageExecutionInProgressError("k", "2026-01-01T00:00:00.000Z");
    expect(toWorkflowStepError(transient)).toBe(transient);
    const ordinary = new Error("provider 503");
    expect(toWorkflowStepError(ordinary)).toBe(ordinary);
  });
});

describe("platform reset classification (issue #70 §23)", () => {
  const DO_RESET = "Durable Object reset because its code was updated";

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
    expect(classifyStageFailure(new (class extends Error {})("synthetic"))).toEqual("TRANSIENT_RETRYABLE");
    expect(classifyStageFailure({ name: "SiteGenerationValidationError", findings: [] })).not.toEqual(
      "TERMINAL_INVARIANT"
    );
  });
});
