// Primary V2 lifecycle orchestrator (issue #4, PRD section 23; full pipeline
// wiring landed with issue #30; granularity flattened with issue #57).
//
// WebsiteBuildWorkflow owns the V2 lifecycle. Step 1.0 creates the initial
// Build and its immutable Build Version from one Site Generation (or adopts
// an existing Build — e.g. a Revision Request Build — when buildId is
// supplied). The pipeline itself is NOT one enclosing step: run() orchestrates
// the canonical REFERENCE_BOUND stages directly, and every stage executes as
// its own durable top-level step (issue #57 — a slow image provider must never
// own the timeout/retry fate of analysis, Blueprint, generation, assembly and
// QA, and the Cloudflare rule "make steps granular" forbids wrapping an entire
// workflow in one step). Stages run to terminal state: Release Ready,
// HUMAN_REVIEW_REQUIRED, DEGRADED or FAILED. Helper services do the bounded
// work; this class sequences them durably.
//
// Step-occurrence note (issue #57 §2): flattening removed the "2.0 run
// REFERENCE_BOUND pipeline to terminal state" envelope, so the per-stage
// steps are now top-level occurrences of the instance instead of nested steps
// inside one outer step. Stage names are unchanged, so completed-stage cache,
// retry provenance and observability keep their identities.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../env.d";
import type { InitialBuildCreated } from "../domain/lifecycle";
import type { BuildPipelineDeps } from "../domain/build-pipeline";
import { stageInProgressRetryAfterMs } from "../domain/stage-execution";
import { classifyStageFailure } from "../domain/stage-failure";

// Terminal/provenance corruption, the hard KIE spend gate, and deterministic
// stage failures must not burn the workflow step retry budget (issues #54 §11
// and #62): collisions under immutable slots, a ledger-capped spend gate, and
// post-repair deterministic validation findings cannot change their verdict
// by repeating, so these fail the step non-retryably ON THE THROWING ATTEMPT.
// Deterministic stage failures carry a richer domain outcome than this
// boundary mapping (candidate exists -> HUMAN_REVIEW_REQUIRED) — the pipeline
// handles those in-step with terminal-result markers before they ever reach
// here (issue #62 §7); this classification is the backstop for any stray one.
// Everything else — including the transient STAGE_EXECUTION_IN_PROGRESS
// single-flight yield — stays retryable under the step policy below.
export function toWorkflowStepError(error: unknown): unknown {
  if (classifyStageFailure(error) !== "TRANSIENT_RETRYABLE") {
    return new NonRetryableError((error as Error).message);
  }
  return error;
}

// Retry policy for every pipeline stage step (retry-liveness directive §1–§9;
// issue #61 single-ownership correction; issue #64 fallback-only contract).
//
// Platform facts, corrected by production evidence (raw REST, 2026-09-06/07
// forensics + the #63 canary): the delay may be a WorkflowDelayFunction
// receiving the thrown error; `backoff` defaults to "exponential" when
// unspecified, multiplying the delay value by 2^(attempt-1); and
// retries.limit counts RETRIES — limit 8 = 8 retries after the initial
// attempt = 9 attempts total (canary-proven: limit 2 produced 3 attempts;
// the docs' "total number of attempts" wording is not what the engine does).
// The omitted backoff key here once compounded the repo-owned 10→20→40s
// schedule into 10→40→160→640→2560s… (~15h horizon) and produced the
// 2026-09-06/07 "wedge". With backoff: "constant" the dynamic function below
// is the single owner of the schedule.
//
// NORMATIVE SAFETY PATH (issue #64): the engine may rehydrate thrown errors
// into shapes the delay function cannot recognize (canary-proven — the
// lease-aware branch never fired in 10/10 production instances), so
// correctness NEVER depends on custom error recognition. The invariant chain
// is: atomic single-flight claim + immutable artifact reuse + the bounded
// repo-owned fallback schedule + stale-claim takeover:
//
//   attempt 1:  t=0      (initial)
//   retry 1  -> attempt 2: t=10s
//   retry 2  -> attempt 3: t=30s
//   retry 3  -> attempt 4: t=70s
//   retry 4  -> attempt 5: t=150s
//   retry 5  -> attempt 6: t=310s
//   retry 6  -> attempt 7: t=630s
//   retry 7  -> attempt 8: t=1270s  <- first wake past the 660s lease (+15s margin)
//   retry 8  -> attempt 9: t=2550s  (spare — takeover lands on attempt 8)
//
// First stale-eligible retry occurs BEFORE exhaustion, with one spare
// attempt. While a claim is live, a contender's re-entry makes NO provider
// call (it yields IN_PROGRESS); after expiry the atomic CAS takeover assigns
// exactly one replacement owner.
//
// The lease-aware IN_PROGRESS wait below (stageInProgressRetryAfterMs) is an
// OPPORTUNISTIC OPTIMIZATION ONLY (#64 §1/§6): when the runtime preserves
// error identity it wakes takeover at lease-expiry + margin (~11.2 min
// instead of ~21.2 min); when it does not, the fallback timeline above is
// the contract. One yield consumes one retry slot either way.
//
// timeout ("10 minutes", per attempt) is explicit and derived, not incidental:
// one owner attempt is bounded by 2 x 300s provider aborts plus
// validation/store overhead, and it must be dead BEFORE its 660s claim lease
// expires so a contender can never take over a claim from a still-running
// attempt (600s < 660s < lease horizon).
// Repo-owned exponential fallback schedule (milliseconds) for ordinary
// transient errors: starts at the documented 10s and doubles per retry,
// capped at 1280s (the final retry's delay). Cumulative horizon over 8
// retries: 2550s (~42.5 min) — bounded, and past the 660s claim lease from
// retry 7 onward.
export function stageStepFallbackDelayMs(attempt: number): number {
  return 10_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7);
}

// Exported for config-pinning tests (issue #61 §3): the Workflow
// configuration MUST be delay = dynamic function + backoff = "constant";
// do not rely on the platform default.
export const STAGE_STEP_RETRIES = {
  limit: 8,
  // Issue #61: WITHOUT this key the engine defaults to "exponential" and
  // multiplies the delay function's return by 2^(attempt-1) — the production
  // 2026-09-07 forensic finding. "constant" pins single ownership.
  backoff: "constant",
  delay: ({ ctx, error }: { ctx: { attempt: number }; error: unknown }) => {
    const retryAfterMs = stageInProgressRetryAfterMs(error);
    if (retryAfterMs !== null) return `${Math.ceil(retryAfterMs / 1000)} seconds`;
    return stageStepFallbackDelayMs(ctx.attempt);
  },
} as const;

export interface WebsiteBuildParams {
  siteGenerationId: string;
  /** Existing Build (e.g. a Revision Request Build) instead of creating the initial one. */
  buildId?: string;
}

export interface WebsiteBuildResult {
  buildId: string;
  buildVersionId?: string;
  terminal?: string;
  releaseReadyBuildVersionId?: string | null;
  artifactManifestHash?: string | null;
  previewUrl?: string | null;
  reasons?: string[];
}

export class WebsiteBuildWorkflow extends WorkflowEntrypoint<Env, WebsiteBuildParams> {
  /** Test seam: deterministic provider scripts for the pipeline step. The
   *  production runtime never sets it — the real provider defaults apply. */
  pipelineDeps?: BuildPipelineDeps;

  async run(event: WorkflowEvent<WebsiteBuildParams>, step: WorkflowStep): Promise<WebsiteBuildResult> {
    const { siteGenerationId, buildId } = event.payload;

    const created = await step.do<InitialBuildCreated | { buildId: string }>(
      "1.0 resolve Build and immutable Build Version 1",
      async () => {
        let resolved: InitialBuildCreated | { buildId: string };
        if (buildId) {
          resolved = { buildId };
        } else {
          const { createInitialBuild, adoptExistingInitialBuild } = await import("../domain/lifecycle");
          try {
            resolved = await createInitialBuild(this.env, { siteGenerationId });
          } catch (error) {
            // Engine/operator restart of an in-flight generation: the initial
            // Build already exists — adopt it so the restart resumes the
            // pipeline on its frozen artifacts instead of erroring forever.
            if ((error as { code?: string }).code === "INITIAL_BUILD_ALREADY_EXISTS") {
              const existing = await adoptExistingInitialBuild(this.env, siteGenerationId);
              if (existing) resolved = existing;
              else throw error;
            } else {
              throw error;
            }
          }
        }
        // Record the owning workflow instance on the Build (issue #56 sweep
        // input): without it the reconciliation sweep's
        // `workflow_instance_id IS NOT NULL` selector can never see any Build,
        // and resource-killed instances stay invisible to the sweep (found by
        // the 2026-09-06 forensic snapshot — no code path ever wrote this
        // column). First writer wins; engine restarts of the same instance are
        // no-ops, and a later DIFFERENT instance never steals the mapping.
        // Idempotent under step retries.
        if (event.instanceId) {
          await this.env.DB.prepare(
            "UPDATE builds SET workflow_instance_id = ?2, updated_at = ?3 WHERE id = ?1 AND workflow_instance_id IS NULL"
          )
            .bind(resolved.buildId, event.instanceId, new Date().toISOString())
            .run();
        }
        return resolved;
      }
    );

    // Catchable failures (step retry exhaustion, NonRetryableError terminal
    // collisions) record the domain failure BEFORE the instance dies, so the
    // Build never sits non-terminal with only platform evidence (issue #56).
    // Resource kills cannot rely on this catch running — the scheduled
    // reconciliation sweep (reconcileWorkflowTerminations) covers those via
    // the workflow status API.
    //
    // Issue #57: the pipeline is orchestrated DIRECTLY by run() — no enclosing
    // aggregate step and therefore no aggregate per-attempt timeout that a
    // slow image provider could trip. Each stage below executes as its own
    // durable step through the deps.step seam; completed stages replay from
    // the engine's step cache while later stages retry.
    try {
      const { runBuildPipeline } = await import("../domain/build-pipeline");
      const result = await runBuildPipeline(this.env, {
        siteGenerationId,
        buildId: created.buildId,
        // Every pipeline stage executes as its own durable step: a mid-flight
        // isolate eviction retries only that stage, and each stage is
        // idempotent (frozen-artifact reuse / KIE spend-resume).
        deps: {
          ...(this.pipelineDeps ?? {}),
          // Transient platform faults (D1 "Durable Object no longer
          // active", isolate evictions) heal via bounded engine retries;
          // every step is idempotent (artifact reuse / spend-resume /
          // single-flight provider claims — issue #54).
          step: async <T,>(name: string, fn: () => Promise<T>) => {
            // Issue #62: the classification converts INSIDE the step closure
            // so a NonRetryableError reaches the engine on the throwing
            // attempt. Converting after step.do rejects would only run once
            // the retry budget was already burned.
            return (await step.do(
              name,
              {
                retries: { ...STAGE_STEP_RETRIES } as never,
                timeout: "10 minutes",
              } as never,
              () =>
                fn().catch((error: unknown): unknown => {
                  throw toWorkflowStepError(error);
                }) as never
            )) as T;
          },
          // Durable image-poll waiting (issue #58 §11): provider PENDING
          // sleeps the INSTANCE via step.sleep instead of occupying a running
          // step — no Worker timers, no CPU-active polling. step.sleep does
          // not count toward the Workflow step limit.
          sleep: (name: string, ms: number) =>
            step.sleep(name, `${Math.max(1, Math.ceil(ms / 1000))} seconds`) as never,
        },
      });
      return {
        buildId: result.buildId,
        buildVersionId: result.releaseReadyBuildVersionId ?? undefined,
        terminal: result.terminal,
        releaseReadyBuildVersionId: result.releaseReadyBuildVersionId,
        artifactManifestHash: result.artifactManifestHash,
        previewUrl: result.previewUrl,
        reasons: result.reasons,
      };
    } catch (error) {
      try {
        const { failBuildForWorkflowTermination } = await import("../domain/workflow-reconciliation");
        await failBuildForWorkflowTermination(this.env, {
          buildId: created.buildId,
          workflowInstanceId: event.instanceId,
          reason: "WORKFLOW_EXECUTION_EXHAUSTED",
          detail: (error as Error)?.message?.slice(0, 250),
        });
      } catch (reconciliationError) {
        console.error(
          `(error) workflow_failure_reconciliation_failed { buildId: '${created.buildId}', message: '${(reconciliationError as Error).message.replace(/'/g, "")}' }`
        );
      }
      throw error;
    }
  }
}
