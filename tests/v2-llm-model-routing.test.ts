import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv, fetchMock } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { Type } from "@sinclair/typebox";
import {
  CANONICAL_LLM_MODEL,
  generateWithGatewayDetailed,
  resolveLlmModel,
  resolveVisionProviderChain,
} from "../src/lib/ai-gateway";
import { runSchemaValidatedAiStage } from "../src/domain/ai-boundary";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";

// Issue #30 model-routing gate: ONE canonical LLM model (glm-5.3-flash) for
// every V2 textual/multimodal call on every provider leg; no legacy glm-4v
// vision path, no per-provider model fallback, and provider-reported model
// identity lands in provenance. Static source hygiene (no legacy literals in
// executable routing) is enforced by scripts/verify-llm-model-routing.mjs,
// which runs as part of `npm test`.

const env = providedEnv as unknown as Env;
const GATEWAY_ORIGIN = "https://gateway.ai.cloudflare.com";

function chatResponse(overrides: { model?: string; content?: string } = {}): string {
  return JSON.stringify({
    id: "chatcmpl-test",
    model: overrides.model ?? CANONICAL_LLM_MODEL,
    choices: [{ message: { role: "assistant", content: overrides.content ?? "{\"ok\":true}" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

beforeAll(() => {
  fetchMock.activate();
  // Outbound LLM calls in this suite must never reach a real provider.
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe("canonical LLM model resolution", () => {
  it("resolves glm-5.3-flash by default and through the LLM_MODEL seam", () => {
    expect(CANONICAL_LLM_MODEL).toBe("glm-5.3-flash");
    expect(resolveLlmModel(env)).toBe("glm-5.3-flash");
    expect(resolveLlmModel({ ...env, LLM_MODEL: undefined } as unknown as Env)).toBe("glm-5.3-flash");
    // The seam stays configurable, but every caller of it gets one value.
    expect(resolveLlmModel({ ...env, LLM_MODEL: "glm-5.3-flash" } as unknown as Env)).toBe("glm-5.3-flash");
  });

  it("routes every vision leg to the canonical model — no glm-4v path", () => {
    const productionLike = {
      ...env,
      VISION_PRIMARY_PROVIDER: "zhipu",
      VISION_FALLBACK_PROVIDER: "ai-gateway",
    } as unknown as Env;
    const routes = resolveVisionProviderChain(productionLike);
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(route.model).toBe("glm-5.3-flash");
    }
    expect(JSON.stringify(routes)).not.toContain("glm-4v");

    // Minimal environment: canonical primary provider and model still apply.
    const minimal = resolveVisionProviderChain({ ...env, VISION_PRIMARY_PROVIDER: undefined, VISION_FALLBACK_PROVIDER: undefined } as unknown as Env);
    expect(minimal).toEqual([{ provider: "zhipu", model: "glm-5.3-flash" }]);
  });
});

describe("gateway request routing", () => {
  it("sends glm-5.3-flash on the ZAI/zhipu leg and records the provider-reported model", async () => {
    const captured: Array<{ model?: string; authorization?: string }> = [];
    fetchMock
      .get(GATEWAY_ORIGIN)
      .intercept({ method: "POST", path: (path) => path.includes("custom-zhipu") })
      .reply((options) => {
        const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
        captured.push({ model: body.model, authorization: options.headers?.authorization });
        return { statusCode: 200, data: chatResponse({ model: "glm-5.3-flash" }) };
      });

    const zhipuEnv = { ...env, ZHIPU_API_KEY: "test-zhipu-key", PRIMARY_PROVIDER: "zhipu" } as unknown as Env;
    const result = await generateWithGatewayDetailed(zhipuEnv, "system", "user", { build_id: "b" }, { jsonMode: true });

    expect(result.provider).toBe("zhipu");
    expect(result.model).toBe("glm-5.3-flash");
    expect(captured).toHaveLength(1);
    expect(captured[0].model).toBe("glm-5.3-flash");
  });

  it("prefers the provider-reported model identity over the requested label", async () => {
    // The test env carries no ZHIPU_API_KEY, so the chain resolves to the
    // Cloudflare AI Gateway compat leg serving the canonical model.
    fetchMock
      .get(GATEWAY_ORIGIN)
      .intercept({ method: "POST", path: (path) => path.includes("compat") })
      .reply(200, chatResponse({ model: "glm-5.3-flash" }));

    const result = await generateWithGatewayDetailed(env, "system", "user", { build_id: "b" }, { jsonMode: true });
    expect(result.provider).toBe("ai-gateway");
    expect(result.model).toBe("glm-5.3-flash");
  });

  it("fails closed when the canonical model is unavailable — never silently substitutes another model", async () => {
    const capturedModels: string[] = [];
    // One provider only: the AI Gateway compat leg alone (no ZHIPU key).
    // 1 attempt + 3 bounded retries, each served by a one-shot interceptor.
    for (let i = 0; i < 4; i++) {
      fetchMock
        .get(GATEWAY_ORIGIN)
        .intercept({ method: "POST", path: () => true })
        .reply((options) => {
          const body = typeof options.body === "string" ? JSON.parse(options.body) : {};
          capturedModels.push(body.model);
          return { statusCode: 500, data: "model unavailable" };
        });
    }

    await expect(
      generateWithGatewayDetailed(env, "system", "user", { build_id: "b" }, { jsonMode: true })
    ).rejects.toThrow();
    expect(capturedModels).toHaveLength(4);
    for (const model of capturedModels) expect(model).toBe("glm-5.3-flash");
  });
});

describe("AI-stage provenance records the canonical model", () => {
  it("persists glm-5.3-flash on the ai_stage_runs row through the default generate seam", async () => {
    fetchMock
      .get(GATEWAY_ORIGIN)
      .intercept({ method: "POST", path: (path) => path.includes("compat") })
      .reply(200, chatResponse({ model: "glm-5.3-flash", content: "{\"ok\":true}" }));

    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Model Routing Provenance Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/model-routing/unused.png" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const run = await runSchemaValidatedAiStage<{ ok: boolean }>(env, {
      stage: "reference-analyzer",
      schema: Type.Object({ ok: Type.Boolean() }),
      schemaVersion: "model-routing-test/1",
      userPrompt: "test",
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
    });

    expect(run.value).toEqual({ ok: true });
    expect(run.provenance.model).toBe("glm-5.3-flash");
    const rows = await env.DB.prepare(
      "SELECT model, provider FROM ai_stage_runs WHERE run_id = ? ORDER BY attempt"
    )
      .bind(run.runId)
      .all<{ model: string; provider: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].model).toBe("glm-5.3-flash");
    expect(rows.results[0].provider).toBe("ai-gateway");
  });
});
