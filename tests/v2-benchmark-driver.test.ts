// Operator benchmark-driver route (issue #18): capability gating, case
// binding, input validation, the production-engine run seed and the terminal
// record path — proven against real D1/R2 in the Cloudflare Vitest
// environment.
//
// Scope boundary: the pipeline execution itself is the #17 harness primary
// seam tests' subject. Here the run endpoint is proven to seed ONE production
// WebsiteBuildWorkflow instance over the frozen submission (workflow binding
// mocked), and the record endpoint is proven to reconstruct the observed
// terminal outcome and persist it through the UNCHANGED recordBenchmarkRun.
// No endpoint is driven into a real provider call.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import {
  getBenchmarkRun,
  recordBenchmarkRunEndpoint,
  runBenchmarkFreeze,
  runBenchmarkPreflight,
  runBenchmarkStart,
} from "../src/routes/v2.benchmark-driver";
import { signOperatorCapability } from "../src/lib/operator-capability";
import { benchmarkDefinitionHash, freezeBenchmarkCases, getBenchmarkCaseDefinition } from "../src/domain/benchmark/harness";
import { appendBuildWorkflowEvent, createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";

const env = providedEnv as unknown as Env;
const CASE = "bench-01-editorial-asymmetric";
const OTHER_CASE = "bench-02-hospitality-image-heavy";
const UNKNOWN_CASE = "bench-99-not-a-case";
const CODE_REVISION = "a".repeat(40);

interface FakeWorkflowInstance {
  id: string;
  status: () => Promise<{ status: string; output?: Record<string, unknown> }>;
}

function envWithWorkflow(instances: Record<string, FakeWorkflowInstance>, created: string[] = []): Env {
  return {
    ...(env as unknown as Record<string, unknown>),
    WEBSITE_BUILD_WORKFLOW: {
      create: async ({ params }: { params: { siteGenerationId: string } }) => {
        const id = `instance-${created.length + 1}`;
        created.push(id);
        instances[id] = {
          id,
          status: async () => ({ status: "running" }),
        };
        return { id, params };
      },
      get: async (id: string) => instances[id],
    },
  } as unknown as Env;
}

function v2App(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/operator/benchmarks/:caseId/freeze", runBenchmarkFreeze);
  app.post("/api/v2/operator/benchmarks/:caseId/preflight", runBenchmarkPreflight);
  app.post("/api/v2/operator/benchmarks/:caseId/run", runBenchmarkStart);
  app.post("/api/v2/operator/benchmarks/:caseId/record", recordBenchmarkRunEndpoint);
  app.get("/api/v2/operator/benchmarks/runs/:runId", getBenchmarkRun);
  return app;
}

async function benchmarkToken(caseId: string): Promise<string> {
  return signOperatorCapability(env, { action: "benchmark", caseId, exp: Date.now() + 10 * 60_000 });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

beforeAll(async () => {
  await freezeBenchmarkCases(env, [CASE]);
});

describe("benchmark driver route — capability gating", () => {
  it("401s every endpoint without a capability token (fail closed)", async () => {
    const app = v2App();
    const runInit = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codeRevision: CODE_REVISION }) };
    expect((await app.request(`/api/v2/operator/benchmarks/${CASE}/freeze`, { method: "POST" }, env)).status).toBe(401);
    expect((await app.request(`/api/v2/operator/benchmarks/${CASE}/preflight`, { method: "POST" }, env)).status).toBe(401);
    expect((await app.request(`/api/v2/operator/benchmarks/${CASE}/run`, runInit, env)).status).toBe(401);
    expect(
      (
        await app.request(
          `/api/v2/operator/benchmarks/${CASE}/record`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codeRevision: CODE_REVISION, siteGenerationId: "sg", workflowInstanceId: "wf" }) },
          env
        )
      ).status
    ).toBe(401);
    expect((await app.request(`/api/v2/operator/benchmarks/runs/some-run`, {}, env)).status).toBe(401);
  });

  it("403s a validly signed non-benchmark capability", async () => {
    const app = v2App();
    const approveToken = await signOperatorCapability(env, {
      action: "approve",
      buildId: "cap-gate-build-1",
      buildVersionId: "cap-gate-version-1",
      artifactManifestHash: "capgatehash",
      exp: Date.now() + 10 * 60_000,
    });
    const response = await app.request(`/api/v2/operator/benchmarks/${CASE}/freeze`, { method: "POST", headers: auth(approveToken) }, env);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CAPABILITY_INSUFFICIENT");
  });

  it("403s a benchmark capability bound to a different frozen case", async () => {
    const app = v2App();
    await freezeBenchmarkCases(env, [OTHER_CASE]);
    const otherToken = await benchmarkToken(OTHER_CASE);
    for (const path of [
      `/api/v2/operator/benchmarks/${CASE}/freeze`,
      `/api/v2/operator/benchmarks/${CASE}/preflight`,
      `/api/v2/operator/benchmarks/${CASE}/run`,
      `/api/v2/operator/benchmarks/${CASE}/record`,
    ]) {
      const response = await app.request(
        path,
        { method: "POST", headers: auth(otherToken), body: JSON.stringify({ codeRevision: CODE_REVISION, siteGenerationId: "sg-x", workflowInstanceId: "wf-x" }) },
        env
      );
      expect(response.status).toBe(403);
    }
  });
});

describe("benchmark driver route — freeze and preflight", () => {
  it("freeze is idempotent and reports the canonical definition hash", async () => {
    const app = v2App();
    const first = await app.request(`/api/v2/operator/benchmarks/${CASE}/freeze`, { method: "POST", headers: auth(await benchmarkToken(CASE)) }, env);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { caseId: string; status: "frozen" | "verified"; definitionHash: string };
    expect(firstBody.caseId).toBe(CASE);
    expect(["frozen", "verified"]).toContain(firstBody.status);
    expect(firstBody.definitionHash).toMatch(/^[0-9a-f]{64}$/);

    const second = await app.request(`/api/v2/operator/benchmarks/${CASE}/freeze`, { method: "POST", headers: auth(await benchmarkToken(CASE)) }, env);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { status: "verified"; definitionHash: string };
    expect(secondBody.status).toBe("verified");
    expect(secondBody.definitionHash).toBe(firstBody.definitionHash);
    expect(firstBody.definitionHash).toBe(await benchmarkDefinitionHash(getBenchmarkCaseDefinition(CASE)));
  });

  it("preflight verifies the frozen inputs and reports runtime identity without secret values", async () => {
    const app = v2App();
    const response = await app.request(`/api/v2/operator/benchmarks/${CASE}/preflight`, { method: "POST", headers: auth(await benchmarkToken(CASE)) }, env);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      caseId: string;
      definitionHash: string;
      buildMode: string;
      frozenInputsVerified: boolean;
      providers: Record<string, boolean>;
      runtimeIdentity: Record<string, string | null>;
      budget: { imageSpendLimitUsd: number };
      priorRunsForCase: number;
    };
    expect(body.caseId).toBe(CASE);
    expect(body.frozenInputsVerified).toBe(true);
    expect(body.buildMode).toBe("REFERENCE_BOUND");
    expect(body.definitionHash).toBe(await benchmarkDefinitionHash(getBenchmarkCaseDefinition(CASE)));
    expect(Object.values(body.providers).every((v) => typeof v === "boolean")).toBe(true);
    expect(body.budget.imageSpendLimitUsd).toBe(3);
    expect(typeof body.priorRunsForCase).toBe("number");
  });
});

describe("benchmark driver route — run seed", () => {
  it("400s a seed request with invalid inputs", async () => {
    const app = v2App();
    const token = await benchmarkToken(CASE);
    const missing = await app.request(`/api/v2/operator/benchmarks/${CASE}/run`, { method: "POST", headers: auth(token), body: JSON.stringify({}) }, env);
    expect(missing.status).toBe(400);
    const short = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: auth(token), body: JSON.stringify({ codeRevision: "2471d31" }) },
      env
    );
    expect(short.status).toBe(400);
    const malformed = await app.request(`/api/v2/operator/benchmarks/${CASE}/run`, { method: "POST", headers: auth(token), body: "not json" }, env);
    expect(malformed.status).toBe(400);
    const negative = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: auth(token), body: JSON.stringify({ codeRevision: CODE_REVISION, manualSourceEdits: -1 }) },
      env
    );
    expect(negative.status).toBe(400);
  });

  it("404s an unknown benchmark case after authorization passes", async () => {
    const app = v2App();
    const response = await app.request(
      `/api/v2/operator/benchmarks/${UNKNOWN_CASE}/run`,
      { method: "POST", headers: auth(await benchmarkToken(UNKNOWN_CASE)), body: JSON.stringify({ codeRevision: CODE_REVISION }) },
      env
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNKNOWN_CASE");
  });

  it("seeds exactly one production workflow instance over the frozen submission", async () => {
    const instances: Record<string, FakeWorkflowInstance> = {};
    const created: string[] = [];
    const app = v2App();
    const response = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: auth(await benchmarkToken(CASE)), body: JSON.stringify({ codeRevision: CODE_REVISION, manualSourceEdits: 0 }) },
      envWithWorkflow(instances, created)
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      caseId: string;
      definitionHash: string;
      siteGenerationId: string;
      buildMode: string;
      workflowInstanceId: string;
      codeRevision: string;
      manualSourceEdits: number;
    };
    expect(body.caseId).toBe(CASE);
    expect(body.buildMode).toBe("REFERENCE_BOUND");
    expect(body.definitionHash).toBe(await benchmarkDefinitionHash(getBenchmarkCaseDefinition(CASE)));
    expect(body.workflowInstanceId).toBe("instance-1");
    expect(body.codeRevision).toBe(CODE_REVISION);
    expect(body.manualSourceEdits).toBe(0);
    expect(created).toEqual(["instance-1"]);
  });
});

describe("benchmark driver route — record", () => {
  it("409s while the Build is non-terminal and 404s without a Build", async () => {
    const instances: Record<string, FakeWorkflowInstance> = {};
    const app = v2App();
    const seeded = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: auth(await benchmarkToken(CASE)), body: JSON.stringify({ codeRevision: CODE_REVISION }) },
      envWithWorkflow(instances)
    );
    expect(seeded.status).toBe(202);
    const { siteGenerationId } = (await seeded.json()) as { siteGenerationId: string };

    const missing = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/record`,
      { method: "POST", headers: auth(await benchmarkToken(CASE)), body: JSON.stringify({ codeRevision: CODE_REVISION, siteGenerationId: "sg-nonexistent", workflowInstanceId: "instance-1" }) },
      env
    );
    expect(missing.status).toBe(404);

    // The workflow's step 1.0 has not run in this test — create the initial
    // Build directly and leave it non-terminal.
    const created = await createInitialBuild(env, { siteGenerationId });
    const notTerminal = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/record`,
      { method: "POST", headers: auth(await benchmarkToken(CASE)), body: JSON.stringify({ codeRevision: CODE_REVISION, siteGenerationId, workflowInstanceId: "instance-1" }) },
      env
    );
    expect(notTerminal.status).toBe(409);
    expect(created.buildId).toBeTruthy();
  });

  it("records a terminal FAILED outcome through the unchanged recordBenchmarkRun", async () => {
    const app = v2App();
    const definition = getBenchmarkCaseDefinition(CASE);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: definition.facts,
        reference: { screenshotR2Key: definition.reference.screenshotR2Key },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await env.DB.prepare("UPDATE builds SET state = 'FAILED' WHERE id = ?").bind(created.buildId).run();
    await appendBuildWorkflowEvent(env, {
      buildId: created.buildId,
      fromState: "SITE_GENERATION",
      toState: "FAILED",
      stage: "simple_website_build",
      detail: "WEBSITE_BUILDER_GATE: driver record test",
    });

    // The workflow instance is unreachable (preview recycling): the durable
    // Build state is the outcome truth.
    const response = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/record`,
      {
        method: "POST",
        headers: auth(await benchmarkToken(CASE)),
        body: JSON.stringify({ codeRevision: CODE_REVISION, manualSourceEdits: 0, siteGenerationId: started.siteGenerationId, workflowInstanceId: "unreachable-instance" }),
      },
      env
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runId: string; terminal: string; pass: boolean; passReason: string; buildId: string };
    expect(body.terminal).toBe("FAILED");
    expect(body.pass).toBe(false);
    expect(body.buildId).toBe(created.buildId);
    expect(body.passReason).toContain("not RELEASE_READY");

    const read = await app.request(`/api/v2/operator/benchmarks/runs/${body.runId}`, { headers: auth(await benchmarkToken(CASE)) }, env);
    expect(read.status).toBe(200);
    const row = (await read.json()) as { id: string; status: string; root_cause: string | null; code_revision: string };
    expect(row.status).toBe("fail");
    expect(row.code_revision).toBe(CODE_REVISION);
    expect(row.root_cause).toContain("WEBSITE_BUILDER_GATE");
  });
});
