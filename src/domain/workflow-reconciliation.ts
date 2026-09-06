// V2 workflow terminal-failure reconciliation (issue #56).
//
// A platform execution failure must become domain-visible: production
// (build 91764d47, 2026-09-06) ended with the workflow instance Errored while
// the Build sat non-terminal (IMPLEMENTATION_PLAN) forever — a silent wedge
// with no operator-facing evidence.
//
// Two complementary paths close that gap:
//   1. `failBuildForWorkflowTermination` — the single idempotent domain
//      transition (Build -> FAILED with an explicit reason and audit event).
//   2. `reconcileWorkflowTerminations` — a bounded sweep over non-terminal
//      Builds whose workflow instance the platform reports as errored or
//      terminated. Resource kills (CPU exhaustion) cannot rely on
//      catch/finally inside the dying invocation; the external status check
//      can.
//
// Domain meaning is preserved: a dead workflow has no candidate, so the Build
// outcome is FAILED — never HUMAN_REVIEW_REQUIRED (that state is reserved for
// builds with a candidate awaiting a human gate). The audit event carries the
// instance id and cause so the operator-facing build record explains the
// failure without exposing secrets or provider payloads.

import type { Env } from "../env.d";
import { nowIso } from "../lib/crypto";
import { appendBuildWorkflowEvent } from "./lifecycle";
import type { BuildLifecycleState } from "./lifecycle-schema";

// States a Build reaches that reconciliation must NEVER mutate — a successful
// or human-gated build stays exactly as the domain left it (issue #56 §25).
const TERMINAL_BUILD_STATES: readonly BuildLifecycleState[] = [
  "RELEASE_READY",
  "APPROVED",
  "PUBLISHED",
  "DEGRADED",
  "FAILED",
  "HUMAN_REVIEW_REQUIRED",
];

export type WorkflowFailureReason = "WORKFLOW_EXECUTION_EXHAUSTED" | "WORKFLOW_TERMINATED";

export interface WorkflowFailureInput {
  buildId: string;
  workflowInstanceId: string | null;
  reason: WorkflowFailureReason;
  detail?: string | null;
}

/** Transition a non-terminal Build to FAILED exactly once, with one audit
 *  event. Re-running on an already-terminal build (including by concurrent
 *  reconcilers) is a no-op: the conditional update admits exactly one winner,
 *  and only the winner writes the audit. */
export async function failBuildForWorkflowTermination(
  env: Env,
  input: WorkflowFailureInput
): Promise<{ transitioned: boolean; fromState: BuildLifecycleState | null }> {
  const build = await env.DB.prepare("SELECT state FROM builds WHERE id = ?")
    .bind(input.buildId)
    .first<{ state: BuildLifecycleState }>();
  if (!build || TERMINAL_BUILD_STATES.includes(build.state)) {
    return { transitioned: false, fromState: build?.state ?? null };
  }

  // The state-conditional UPDATE is the exactly-once point: concurrent
  // reconcilers race, one reports changes = 1, and only that winner audits.
  const updated = await env.DB.prepare(
    "UPDATE builds SET state = 'FAILED', updated_at = ?2 WHERE id = ?1 AND state = ?3"
  )
    .bind(input.buildId, nowIso(), build.state)
    .run();
  if (updated.meta.changes !== 1) {
    return { transitioned: false, fromState: build.state };
  }

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    fromState: build.state,
    toState: "FAILED",
    stage: "workflow_execution",
    detail: `${input.reason}: workflow instance ${input.workflowInstanceId ?? "unknown"} terminated the pipeline${input.detail ? ` — ${input.detail}` : ""}`.slice(0, 500),
  });
  return { transitioned: true, fromState: build.state };
}

export interface ReconciliationSummary {
  examined: number;
  reconciled: number;
  skipped: number;
  errors: number;
}

/** Bounded sweep: find non-terminal Builds with a workflow instance id and
 *  reconcile those whose instance the platform reports as errored or
 *  terminated. Designed for the existing scheduled sweep (no new cron) —
 *  idempotent across runs (issue #56 §25), V2-only. */
export async function reconcileWorkflowTerminations(
  env: Env,
  options?: { limit?: number }
): Promise<ReconciliationSummary> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const placeholders = TERMINAL_BUILD_STATES.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, state, workflow_instance_id FROM builds
     WHERE workflow_instance_id IS NOT NULL
       AND state NOT IN (${placeholders})
     ORDER BY updated_at
     LIMIT ?`
  )
    .bind(...TERMINAL_BUILD_STATES, limit)
    .all<{ id: string; state: BuildLifecycleState; workflow_instance_id: string }>();

  const summary: ReconciliationSummary = { examined: rows.results.length, reconciled: 0, skipped: 0, errors: 0 };
  for (const row of rows.results) {
    try {
      const instance = await env.WEBSITE_BUILD_WORKFLOW.get(row.workflow_instance_id);
      const status = (await instance.status()) as { status: string; error?: { name?: string; message?: string } };
      if (status.status !== "errored" && status.status !== "terminated") {
        summary.skipped += 1;
        continue;
      }
      const reason: WorkflowFailureReason =
        status.status === "terminated" ? "WORKFLOW_TERMINATED" : "WORKFLOW_EXECUTION_EXHAUSTED";
      const cause = status.error?.message ? status.error.message.slice(0, 200) : null;
      const result = await failBuildForWorkflowTermination(env, {
        buildId: row.id,
        workflowInstanceId: row.workflow_instance_id,
        reason,
        detail: cause,
      });
      if (result.transitioned) {
        summary.reconciled += 1;
        console.log(
          `(info) workflow_failure_reconciled { buildId: '${row.id}', instanceId: '${row.workflow_instance_id}', reason: '${reason}' }`
        );
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(
        `(error) workflow_reconciliation_error { buildId: '${row.id}', message: '${(error as Error).message.replace(/'/g, "")}' }`
      );
    }
  }
  return summary;
}
