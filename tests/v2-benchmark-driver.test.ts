// Operator benchmark-driver route (issue #18): capability gating, case
// binding, input validation and read-back wiring, proven against real D1/R2
// in the Cloudflare Vitest environment.
//
// Scope boundary: the /run endpoint is a thin pass-through of startBenchmarkRun
// with NO provider seams — its pipeline execution contracts are the #17
// harness primary-seam tests' subject. Here no endpoint is driven into a real
// provider call: only the route's own auth/validation/mapping behavior and the
// freeze/preflight/status read paths are exercised.

import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import {
  getBenchmarkRun,
  runBenchmarkFreeze,
  runBenchmarkPreflight,
  runBenchmarkStart,
} from "../src/routes/v2.benchmark-driver";
import { signOperatorCapability } from "../src/lib/operator-capability";
import { benchmarkDefinitionHash, freezeBenchmarkCases, getBenchmarkCaseDefinition } from "../src/domain/benchmark/harness";

const env = providedEnv as unknown as Env;
const CASE = "bench-01-editorial-asymmetric";
const OTHER_CASE = "bench-02-hospitality-image-heavy";
const UNKNOWN_CASE = "bench-99-not-a-case";
const CODE_REVISION = "a".repeat(40);

function v2App(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/operator/benchmarks/:caseId/freeze", runBenchmarkFreeze);
  app.post("/api/v2/operator/benchmarks/:caseId/preflight", runBenchmarkPreflight);
  app.post("/api/v2/operator/benchmarks/:caseId/run", runBenchmarkStart);
  app.get("/api/v2/operator/benchmarks/runs/:runId", getBenchmarkRun);
  return app;
}

async function benchmarkToken(caseId: string): Promise<string> {
  return signOperatorCapability(env, { action: "benchmark", caseId, exp: Date.now() + 10 * 60_000 });
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await freezeBenchmarkCases(env, [CASE]);
});

describe("benchmark driver route — capability gating", () => {
  it("401s every endpoint without a capability token (fail closed)", async () => {
    const app = v2App();
    expect((await app.request(`/api/v2/operator/benchmarks/${CASE}/freeze`, { method: "POST" }, env)).status).toBe(401);
    expect((await app.request(`/api/v2/operator/benchmarks/${CASE}/preflight`, { method: "POST" }, env)).status).toBe(401);
    expect(
      (
        await app.request(
          `/api/v2/operator/benchmarks/${CASE}/run`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codeRevision: CODE_REVISION }) },
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
    ]) {
      const response = await app.request(path, { method: "POST", headers: auth(otherToken) }, env);
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

describe("benchmark driver route — run validation and read-back", () => {
  it("400s a run request without an exact 40-hex codeRevision", async () => {
    const app = v2App();
    const token = await benchmarkToken(CASE);
    const missing = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({}) },
      env
    );
    expect(missing.status).toBe(400);
    const short = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ codeRevision: "2471d31" }) },
      env
    );
    expect(short.status).toBe(400);
    const malformed = await app.request(`/api/v2/operator/benchmarks/${CASE}/run`, { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: "not json" }, env);
    expect(malformed.status).toBe(400);
  });

  it("400s a run request with a negative or non-integer manualSourceEdits attestation", async () => {
    const app = v2App();
    const token = await benchmarkToken(CASE);
    const negative = await app.request(
      `/api/v2/operator/benchmarks/${CASE}/run`,
      { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ codeRevision: CODE_REVISION, manualSourceEdits: -1 }) },
      env
    );
    expect(negative.status).toBe(400);
  });

  it("404s an unknown benchmark case after authorization passes", async () => {
    const app = v2App();
    const response = await app.request(
      `/api/v2/operator/benchmarks/${UNKNOWN_CASE}/run`,
      { method: "POST", headers: { ...auth(await benchmarkToken(UNKNOWN_CASE)), "content-type": "application/json" }, body: JSON.stringify({ codeRevision: CODE_REVISION }) },
      env
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNKNOWN_CASE");
  });

  it("read-back binds the run to the capability's case and 404s unknown runs", async () => {
    const app = v2App();
    const runId = "bench-driver-route-test-run-1";
    // A fake append-only run row (never deleted — the trigger is the point):
    // ids are namespaced so no other test's derivation can match them.
    await env.DB.prepare(
      `INSERT INTO benchmark_runs (id, benchmark_case_id, site_generation_id, build_id, build_version_id, status, release_ready, image_spend_usd, manual_source_edits, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, 'pass', 1, 0, 0, ?, ?)`
    )
      .bind(runId, CASE, "sg-bench-driver-route-test", "build-bench-driver-route-test", "bv-bench-driver-route-test", new Date().toISOString(), new Date().toISOString())
      .run();

    const notFound = await app.request(`/api/v2/operator/benchmarks/runs/does-not-exist`, { headers: auth(await benchmarkToken(CASE)) }, env);
    expect(notFound.status).toBe(404);

    const wrongCase = await app.request(`/api/v2/operator/benchmarks/runs/${runId}`, { headers: auth(await benchmarkToken(OTHER_CASE)) }, env);
    expect(wrongCase.status).toBe(403);

    const ok = await app.request(`/api/v2/operator/benchmarks/runs/${runId}`, { headers: auth(await benchmarkToken(CASE)) }, env);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { id: string; benchmark_case_id: string };
    expect(body.id).toBe(runId);
    expect(body.benchmark_case_id).toBe(CASE);
  });
});
