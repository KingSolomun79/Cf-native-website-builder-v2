import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { handleCandidateValidation } from "../src/lib/candidate-validation";
import { generateId, signCandidateValidationCapability } from "../src/lib/crypto";

function validationEnv(overrides: Partial<Env> = {}): Env {
  const images = {
    input() {
      return {
        transform() {
          return {
            async output() {
              return { response: () => new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])) };
            },
          };
        },
      };
    },
  } as unknown as ImagesBinding;
  return {
    ...(providedEnv as unknown as Env),
    IMAGES: images,
    CANDIDATE_VALIDATION_ENABLED: "true",
    CANDIDATE_VALIDATION_SECRET: "candidate-validation-test-secret",
    ...overrides,
  };
}

function app(): Hono<{ Bindings: Env }> {
  const server = new Hono<{ Bindings: Env }>();
  server.post("/candidate-validation", handleCandidateValidation);
  return server;
}

async function capability(env: Env, overrides: Partial<{ exp: number; nonce: string }> = {}): Promise<string> {
  return signCandidateValidationCapability(env, {
    action: "candidate-vision-validation",
    exp: overrides.exp ?? Date.now() + 5 * 60 * 1000,
    nonce: overrides.nonce ?? generateId(),
  });
}

describe("candidate validation harness", () => {
  it("is unavailable unless explicitly enabled", async () => {
    const env = validationEnv({ CANDIDATE_VALIDATION_ENABLED: "false" });
    const response = await app().request("https://test.example.com/candidate-validation", { method: "POST" }, env);
    expect(response.status).toBe(404);
  });

  it("rejects expired capability tokens", async () => {
    const env = validationEnv();
    const token = await capability(env, { exp: Date.now() - 1 });
    const response = await app().request("https://test.example.com/candidate-validation", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(response.status).toBe(401);
  });

  it("records all four candidate scenarios in immutable R2 and D1 evidence", async () => {
    const env = validationEnv();
    const token = await capability(env);
    const response = await app().request("https://test.example.com/candidate-validation", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(response.status).toBe(200);
    const body = await response.json<{ runId: string; status: string; reportR2Key: string; scenarios: Array<{ name: string }> }>();
    expect(body.status).toBe("passed");
    expect(body.scenarios.map((scenario) => scenario.name)).toEqual(["normal_screenshot", "oversized_derivative", "corrupt_input", "hung_provider_fallback"]);

    const report = await env.SITE_BUCKET.get(body.reportR2Key);
    expect(report).not.toBeNull();
    const reportBody = await report?.json<{ status: string; scenarios: Array<{ name: string; evidenceR2Keys: string[] }> }>();
    expect(reportBody?.status).toBe("passed");
    expect(reportBody?.scenarios.every((scenario) => scenario.evidenceR2Keys.length > 0)).toBe(true);

    const audit = await env.DB.prepare("SELECT * FROM candidate_validation_runs WHERE id = ?").bind(body.runId).first<{ status: string; report_r2_key: string; completed_at: string }>();
    expect(audit).toMatchObject({ status: "passed", report_r2_key: body.reportR2Key });
    expect(audit?.completed_at).toBeTruthy();

    const replay = await app().request("https://test.example.com/candidate-validation", { method: "POST", headers: { Authorization: `Bearer ${token}` } }, env);
    expect(replay.status).toBe(409);
  });
});
