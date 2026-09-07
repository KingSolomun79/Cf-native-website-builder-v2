// Retry-semantics production canary (issue #63) — temporary diagnostic
// surface, retained as an OPERATOR-ONLY diagnostic after validation.
//
// Constraints honored (#63 §23):
//   - NO public route and NO unauthenticated action: instances are created
//     exclusively by the operator through wrangler/REST instance creation.
//   - No Business/Site/Build records, no provider calls, no spend, no
//     production secrets: the workflow touches nothing but its own steps.
//
// Purpose: validate the #61 containment against the real engine.
//   Canary A ("A") — the EXACT production delay composition
//     (STAGE_STEP_RETRIES.delay: lease-aware stageInProgressRetryAfterMs
//     branch + repo-owned fallback) with backoff "constant", throwing the
//     real typed StageExecutionInProgressError with a SHORT test lease
//     (45s). Must wake at ~lease-expiry + margin (~60s), NOT at the 10s
//     fallback and NOT at a multiplied multiple.
//   Canary B ("B") — fixed-delay control: delay "10 seconds", backoff
//     "constant", two observed gaps must both be ~10s (no exponential
//     multiplication).
//
// Attempt detection without side channels: the "canary-origin" step freezes
// the instance's creation timestamp in the engine step cache; the probe
// compares elapsed wall time against a per-variant threshold. A correct wake
// completes the instance; a fallback wake (< threshold) re-throws and — at
// this limit — fails the instance LOUDLY. Raw REST attempt timestamps remain
// the authoritative pass evidence (#63 §19/§22); the completion is the
// runtime-level sanity signal.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../env.d";
import { StageExecutionInProgressError } from "../domain/stage-execution";
import { STAGE_STEP_RETRIES } from "./website-build-workflow";

export interface RetrySemanticsCanaryParams {
  variant: "A" | "B";
}

/** A must not pass before ~lease+margin (60s); B observes TWO fixed 10s gaps,
 *  so it must not pass before ~20s. Thresholds sit well below the correct
 *  wake so engine jitter cannot false-fail, and well above the fallback wake
 *  so a fallback delay can never false-pass. */
const PASS_THRESHOLD_MS: Record<RetrySemanticsCanaryParams["variant"], number> = { A: 30_000, B: 18_000 };
const CANARY_LEASE_MS = 45_000; // short test lease (#63 §18), margin stays 15s

export class RetrySemanticsCanaryWorkflow extends WorkflowEntrypoint<Env, RetrySemanticsCanaryParams> {
  async run(
    event: WorkflowEvent<RetrySemanticsCanaryParams>,
    step: WorkflowStep
  ): Promise<{ variant: string; pass: string; elapsedMs: number }> {
    const { variant } = event.payload;
    const threshold = PASS_THRESHOLD_MS[variant] ?? PASS_THRESHOLD_MS.A;

    // Cached forever after its first completion: the stable elapsed-time
    // origin across engine invocations.
    const originIso = await step.do("canary-origin", async () => new Date().toISOString());

    const probeConfig: { retries: Record<string, unknown>; timeout: string } =
      variant === "B"
        ? { retries: { limit: 3, delay: "10 seconds", backoff: "constant" }, timeout: "5 minutes" }
        : // A uses the EXACT production retry composition — the exported
          // STAGE_STEP_RETRIES object itself — so the engine observes the
          // precise delay function, limit and backoff the pipeline uses.
          { retries: { ...STAGE_STEP_RETRIES, limit: 2 } as Record<string, unknown>, timeout: "5 minutes" };

    return await step.do(
      "canary-probe",
      probeConfig as never,
      async (): Promise<{ variant: string; pass: string; elapsedMs: number }> => {
        const elapsedMs = Date.now() - Date.parse(originIso);
        if (elapsedMs < threshold) {
          if (variant === "B") {
            throw new Error(`CANARY_B_TRANSIENT: attempt before the fixed-delay horizon (elapsed ${elapsedMs}ms)`);
          }
          // The REAL typed error with a SHORT test lease — the production
          // delay function recognizes it (typed or by its stable message
          // prefix) and returns lease-expiry + margin.
          throw new StageExecutionInProgressError(
            "canary-lease-aware-delay",
            new Date(Date.now() + CANARY_LEASE_MS).toISOString()
          );
        }
        return {
          variant,
          pass: `PASS: woke past the threshold (elapsed ${elapsedMs}ms); raw REST attempt gaps are the authoritative evidence (#63 §19)`,
          elapsedMs,
        };
      }
    );
  }
}
