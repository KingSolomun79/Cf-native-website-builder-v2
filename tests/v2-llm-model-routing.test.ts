import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { Type } from "@sinclair/typebox";
import {
  generateZaiCodingPlan,
  resolveCodingModel,
  resolveCodingMultimodalModel,
  ZaiCodingPlanOutputExhaustedError,
} from "../src/lib/zai-coding-plan";
import { runSchemaValidatedAiStage } from "../src/domain/ai-boundary";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";

// LLM model-routing gate, post-retirement edition (post-rollout hardening
// 2026-09-12): the Z.AI Coding Plan is the ONE LLM provider. The legacy
// multi-provider gateway/streaming seams were removed, so routing now means:
// canonical stage models resolve from the canonical vars, every request goes
// to the Coding Plan endpoint with the canonical credential, and the
// AI-boundary provenance persists that identity. Static source hygiene (no
// retired provider seam may even exist) is enforced by
// scripts/verify-llm-model-routing.mjs + scripts/verify-resource-isolation.mjs,
// which run as part of `npm test`.

const env = providedEnv as unknown as Env;

interface CapturedRequest {
  url: string;
  model?: string;
  authorization?: string;
  thinking?: unknown;
  maxTokens?: number;
}

/** Coding Plan transport stub: records the request, returns one fixed completion. */
function codingPlanFetch(overrides: { model?: string; content?: string; finishReason?: string } = {}) {
  const captured: CapturedRequest[] = [];
  const fetchImpl = (async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    captured.push({
      url: String(url),
      model: body.model,
      authorization: init?.headers?.Authorization,
      thinking: body.thinking,
      maxTokens: body.max_tokens,
    });
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        model: overrides.model ?? body.model,
        choices: [
          {
            message: { role: "assistant", content: overrides.content ?? '{"ok":true}' },
            finish_reason: overrides.finishReason ?? "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  return { captured, fetchImpl };
}

describe("canonical Coding Plan model resolution", () => {
  it("resolves glm-5.3 / glm-5.3-flash by default and through the canonical vars", () => {
    expect(resolveCodingModel(env)).toBe("glm-5.3");
    expect(resolveCodingModel({ ...env, ZAI_CODING_MODEL: undefined } as unknown as Env)).toBe("glm-5.3");
    expect(resolveCodingMultimodalModel(env)).toBe("glm-5.3-flash");
    expect(
      resolveCodingMultimodalModel({ ...env, ZAI_MULTIMODAL_MODEL: undefined } as unknown as Env)
    ).toBe("glm-5.3-flash");
    // The vars are the ONLY model seam — there is no alternate provider that
    // could carry a different model.
    expect(resolveCodingModel({ ...env, ZAI_CODING_MODEL: "glm-5.3" } as unknown as Env)).toBe("glm-5.3");
  });
});

describe("Coding Plan credential routing", () => {
  it("sends the routed model to the Coding Plan endpoint with GLM reasoning disabled", async () => {
    const { captured, fetchImpl } = codingPlanFetch();
    const result = await generateZaiCodingPlan(env, {
      model: resolveCodingModel(env),
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      maxTokens: 256,
      stream: false,
      jsonMode: true,
      label: "routing-test",
      fetchImpl,
    });

    expect(result.provider).toBe("zai-coding-plan");
    expect(result.model).toBe("glm-5.3");
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
    expect(captured[0].model).toBe("glm-5.3");
    expect(captured[0].thinking).toEqual({ type: "disabled" });
    expect(captured[0].maxTokens).toBe(256);
    expect(captured[0].authorization).toMatch(/^Bearer /);
  });

  it("prefers the canonical ZAI_CODING_API_KEY credential over the legacy ZHIPU_API_KEY name", async () => {
    const { captured, fetchImpl } = codingPlanFetch();
    const bothKeysEnv = {
      ...env,
      ZAI_CODING_API_KEY: "canonical-coding-plan-key",
      ZHIPU_API_KEY: "legacy-zhipu-name",
    } as unknown as Env;

    await generateZaiCodingPlan(bothKeysEnv, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 16,
      stream: false,
      label: "credential-preference-test",
      fetchImpl,
    });

    expect(captured).toHaveLength(1);
    // The canonical secret wins — asserted by NAME shape, never by printing
    // any real credential (these are fixture values).
    expect(captured[0].authorization).toBe("Bearer canonical-coding-plan-key");
  });

  it("still serves the sandbox reality: the legacy ZHIPU_API_KEY name alone is accepted", async () => {
    const { captured, fetchImpl } = codingPlanFetch();
    const legacyOnlyEnv = {
      ...env,
      ZAI_CODING_API_KEY: undefined,
      ZHIPU_API_KEY: "legacy-zhipu-name",
    } as unknown as Env;

    const result = await generateZaiCodingPlan(legacyOnlyEnv, {
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 16,
      stream: false,
      label: "legacy-credential-test",
      fetchImpl,
    });

    expect(result.provider).toBe("zai-coding-plan");
    expect(captured).toHaveLength(1);
    expect(captured[0].authorization).toBe("Bearer legacy-zhipu-name");
  });

  it("classifies output exhaustion as OUTPUT_EXHAUSTED — never retried, never substituted", async () => {
    const { captured, fetchImpl } = codingPlanFetch({ finishReason: "length", content: "partial" });
    await expect(
      generateZaiCodingPlan(env, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 8,
        stream: false,
        label: "exhaustion-test",
        fetchImpl,
      })
    ).rejects.toBeInstanceOf(ZaiCodingPlanOutputExhaustedError);
    expect(captured).toHaveLength(1);
  });
});

describe("AI-stage provenance records the routed Coding Plan identity", () => {
  it("persists the stage seam's provider and model on the ai_stage_runs row", async () => {
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Model Routing Provenance Business", contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: "references/model-routing/unused.png" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const run = await runSchemaValidatedAiStage<{ ok: boolean }>(env, {
      stage: "simple-design-blueprint",
      schema: Type.Object({ ok: Type.Boolean() }),
      schemaVersion: "model-routing-test/1",
      userPrompt: "test",
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      generate: async () => ({
        content: '{"ok":true}',
        provider: "zai-coding-plan",
        model: resolveCodingModel(env),
        tokenUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    });

    expect(run.value).toEqual({ ok: true });
    expect(run.provenance.model).toBe("glm-5.3");
    const rows = await env.DB.prepare(
      "SELECT model, provider FROM ai_stage_runs WHERE run_id = ? ORDER BY attempt"
    )
      .bind(run.runId)
      .all<{ model: string; provider: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].model).toBe("glm-5.3");
    expect(rows.results[0].provider).toBe("zai-coding-plan");
  });
});
