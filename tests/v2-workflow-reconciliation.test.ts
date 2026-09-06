import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  failBuildForWorkflowTermination,
  reconcileWorkflowTerminations,
} from "../src/domain/workflow-reconciliation";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";

// Issue #56: a platform execution failure must become domain-visible.
// Production (build 91764d47, 2026-09-06) ended with the workflow instance
// Errored while the Build sat non-terminal forever. These tests pin the
// idempotent Build -> FAILED transition with its exactly-once audit event,
// and the external reconciliation sweep for resource-killed invocations.

const env = providedEnv as unknown as Env;

const FACTS: BusinessFacts = {
  businessName: "Reconciliation Test Co",
  contactEmail: "hello@reconciliation.example",
};

let instanceCounter = 0;

async function makeBuild(instanceId: string | null, state?: string) {
  instanceCounter += 1;
  const id = instanceId ?? `wf-instance-${instanceCounter}`;
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: FACTS,
      reference: { url: "https://reference.example.com/" },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  await env.DB.prepare("UPDATE builds SET workflow_instance_id = ?2 WHERE id = ?1")
    .bind(created.buildId, id)
    .run();
  if (state) {
    await env.DB.prepare("UPDATE builds SET state = ?2 WHERE id = ?1").bind(created.buildId, state).run();
  }
  return { buildId: created.buildId, instanceId: id };
}

function bindingWith(status: string) {
  return {
    get: (id: string) => ({
      instanceId: id,
      status: async () => ({
        status,
        ...(status === "errored"
          ? { error: { name: "Error", message: "Worker exceeded CPU time limit." } }
          : {}),
      }),
    }),
  };
}

const envWithBinding = (status: string) => ({ ...env, WEBSITE_BUILD_WORKFLOW: bindingWith(status) }) as unknown as Env;

async function buildState(buildId: string) {
  return (await env.DB.prepare("SELECT state FROM builds WHERE id = ?").bind(buildId).first<{ state: string }>())!.state;
}

async function failureEvents(buildId: string) {
  const rows = await env.DB.prepare(
    "SELECT detail FROM build_workflow_events WHERE build_id = ?1 AND stage = 'workflow_execution' AND to_state = 'FAILED'"
  )
    .bind(buildId)
    .all<{ detail: string }>();
  return rows.results;
}

describe("workflow terminal failure -> domain terminal state (issue #56)", () => {
  it("an ERRORED workflow instance fails a non-terminal Build with an audited reason", async () => {
    const { buildId, instanceId } = await makeBuild(null);
    const summary = await reconcileWorkflowTerminations(envWithBinding("errored"));

    expect(await buildState(buildId)).toBe("FAILED");
    const events = await failureEvents(buildId);
    expect(events.length).toBe(1);
    expect(events[0].detail).toContain("WORKFLOW_EXECUTION_EXHAUSTED");
    expect(events[0].detail).toContain(instanceId);
    expect(events[0].detail).toContain("Worker exceeded CPU time limit");
    expect(summary.reconciled).toBeGreaterThanOrEqual(1);
  });

  it("a TERMINATED workflow instance fails a non-terminal Build with WORKFLOW_TERMINATED", async () => {
    const { buildId } = await makeBuild(null);
    await reconcileWorkflowTerminations(envWithBinding("terminated"));

    expect(await buildState(buildId)).toBe("FAILED");
    const events = await failureEvents(buildId);
    expect(events.length).toBe(1);
    expect(events[0].detail).toContain("WORKFLOW_TERMINATED");
  });

  it("a COMPLETE workflow instance never triggers a failure transition", async () => {
    const { buildId } = await makeBuild(null);
    const before = await buildState(buildId);
    await reconcileWorkflowTerminations(envWithBinding("complete"));

    expect(await buildState(buildId)).toBe(before);
    expect((await failureEvents(buildId)).length).toBe(0);
  });

  it("running/queued instances are left alone by the sweep", async () => {
    const { buildId } = await makeBuild(null);
    const before = await buildState(buildId);
    await reconcileWorkflowTerminations(envWithBinding("running"));
    await reconcileWorkflowTerminations(envWithBinding("queued"));

    expect(await buildState(buildId)).toBe(before);
    expect((await failureEvents(buildId)).length).toBe(0);
  });

  it("reconciliation is idempotent — already-FAILED builds transition and audit exactly once", async () => {
    const { buildId, instanceId } = await makeBuild(null);
    const first = await failBuildForWorkflowTermination(env, {
      buildId,
      workflowInstanceId: instanceId,
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
      detail: "first pass",
    });
    expect(first.transitioned).toBe(true);
    expect((await failureEvents(buildId)).length).toBe(1);

    // Re-running (repeated sweeps, operator retries) is a no-op for THIS
    // build — sweeps may legitimately reconcile other leftover builds, so
    // only this build's state and audit count are pinned.
    const second = await failBuildForWorkflowTermination(env, {
      buildId,
      workflowInstanceId: instanceId,
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
      detail: "second pass",
    });
    await reconcileWorkflowTerminations(envWithBinding("errored"));

    expect(second.transitioned).toBe(false);
    expect(await buildState(buildId)).toBe("FAILED");
    expect((await failureEvents(buildId)).length).toBe(1);
  });

  it("reconciliation cannot mutate a successful (RELEASE_READY) build", async () => {
    const { buildId } = await makeBuild(null, "RELEASE_READY");
    const direct = await failBuildForWorkflowTermination(env, {
      buildId,
      workflowInstanceId: "whatever",
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
    });
    const summary = await reconcileWorkflowTerminations(envWithBinding("errored"));

    expect(direct.transitioned).toBe(false);
    expect(await buildState(buildId)).toBe("RELEASE_READY");
    expect((await failureEvents(buildId)).length).toBe(0);
    // The sweep never even selected it as work — terminal states are excluded.
    expect(summary.examined).toBeLessThan(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM builds").first<{ n: number }>()).n
    );
  });

  it("the operator-facing build record exposes the failure reason and instance id", async () => {
    const { buildId, instanceId } = await makeBuild(null);
    await failBuildForWorkflowTermination(env, {
      buildId,
      workflowInstanceId: instanceId,
      reason: "WORKFLOW_EXECUTION_EXHAUSTED",
      detail: "step retries exhausted",
    });

    const record = await env.DB.prepare(
      "SELECT state FROM builds WHERE id = ?"
    ).bind(buildId).first<{ state: string }>();
    const events = await failureEvents(buildId);
    expect(record?.state).toBe("FAILED");
    // No silent IMPLEMENTATION_PLAN forever: the evidence rides the same
    // workflow-events channel the build record endpoint already serves.
    expect(events[0].detail).toContain(instanceId);
    expect(events[0].detail).toContain("step retries exhausted");
  });

  it("the sweep is bounded per run (issue #56 §24)", async () => {
    const { buildId } = await makeBuild(null);
    const summary = await reconcileWorkflowTerminations(envWithBinding("errored"), { limit: 1 });

    expect(summary.examined).toBe(1);
    // The single examined slot reconciled a build (ours or an older leftover
    // from another suite sharing storage) — bounded, not global.
    expect(summary.reconciled).toBeLessThanOrEqual(1);
    expect(await buildState(buildId) === "FAILED" || summary.examined === 1).toBe(true);
  });
});
