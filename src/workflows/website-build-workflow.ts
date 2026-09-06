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
import { StageExecutionCollisionError } from "../domain/stage-execution";
import { StageArtifactError } from "../domain/stage-artifacts";

// Terminal state/provenance corruption must not burn the workflow step retry
// budget (issue #54 §11): a foreign artifact under an immutable slot cannot
// heal through retries, so these errors fail the step non-retryably and the
// failure becomes domain-visible (issue #56 reconciliation). Everything else —
// including the transient STAGE_EXECUTION_IN_PROGRESS single-flight yield —
// stays retryable under the step policy below.
export function toWorkflowStepError(error: unknown): unknown {
  if (
    error instanceof StageExecutionCollisionError ||
    (error instanceof StageArtifactError && error.code === "REPAIR_ARTIFACT_MISMATCH")
  ) {
    return new NonRetryableError(error.message);
  }
  return error;
}

// Retry policy for every pipeline stage step (retry-liveness directive §1–§9).
// Platform facts this is derived from (Workflows docs, "Sleeping and
// retrying"): retries.limit is the TOTAL number of attempts (limit 8 = one
// initial + 7 retries); the delay may be a WorkflowDelayFunction receiving the
// thrown error; the timeout is per attempt. The static exponential backoff
// formula is NOT documented by the platform, so the repo owns the whole
// schedule explicitly:
//
// - STAGE_EXECUTION_IN_PROGRESS (a live owner holds the claim): wait until
//   that owner's lease expires (+ margin) via stageInProgressRetryAfterMs, so
//   stale takeover is reachable on the very next attempt — the required
//   liveness invariant does not depend on any backoff formula. One yield
//   consumes one retry slot; it is a cheap waiting condition, not an error
//   storm (directive §6).
// - Every other transient error: repo-owned exponential schedule (10s, 20s,
//   40s, ... capped at 1280s). Its cumulative horizon (~21 min over 7
//   retries) stays beyond the 660s lease, so the fallback path alone
//   satisfies the invariant; the IN_PROGRESS wait makes it exact.
//
// timeout ("10 minutes", per attempt) is explicit and derived, not incidental:
// one owner attempt is bounded by 2 x 300s provider aborts plus
// validation/store overhead, and it must be dead BEFORE its 660s claim lease
// expires so a contender can never take over a claim from a still-running
// attempt (600s < 660s < IN_PROGRESS wait horizon).
// Repo-owned exponential fallback schedule (milliseconds) for ordinary
// transient errors: starts at the documented 10s and doubles per attempt,
// capped at 1280s (the 8th/final attempt's delay). The horizon is
// indexing-proof: whether the engine's ctx.attempt is 0- or 1-based, the
// cumulative fallback schedule from the first failure (10+20+...+640 =
// ~21 min) stays far beyond the 660s claim lease.
export function stageStepFallbackDelayMs(attempt: number): number {
  return 10_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7);
}

const STAGE_STEP_RETRIES = {
  limit: 8,
  delay: ({ ctx, error }: { ctx: { attempt: number }; error: unknown }) => {
    const retryAfterMs = stageInProgressRetryAfterMs(error);
    if (retryAfterMs !== null) return `${Math.ceil(retryAfterMs / 1000)} seconds`;
    return stageStepFallbackDelayMs(ctx.attempt);
  },
};

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
            try {
              return (await step.do(
                name,
                {
                  retries: { ...STAGE_STEP_RETRIES } as never,
                  timeout: "10 minutes",
                } as never,
                () => fn() as never
              )) as T;
            } catch (error) {
              throw toWorkflowStepError(error);
            }
          },
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
