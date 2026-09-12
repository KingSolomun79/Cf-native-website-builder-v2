// The ONE Coding Plan provider (operator GO 2026-09-11: ZAI CODING PLAN
// UNIFICATION §5/§13/§14), proven at the transport seam:
//
//   §1-§4   request shape: Coding Plan endpoint path, Bearer credential
//           (ZAI_CODING_API_KEY — the ONE secret name on every environment),
//           thinking disabled, model + max_tokens; base URL configurable
//   §5-§7   synchronous mode: content/model-echo/finish/usage/request-id
//           extraction; reasoning_content NEVER enters content
//   §8-§11  streaming mode: accumulation, reasoning_content ignored, valid
//           terminal required, partial output rejected, length rejected
//   §12-§14 bounded transport policy: genuine faults retry, deterministic
//           4xx fail fast, empty content never a result, exhaustion never
//           retried
//   §15     GET /models listing

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.d";
import {
  generateZaiCodingPlan,
  listZaiCodingPlanModels,
  resolveCodingModel,
  resolveCodingMultimodalModel,
  ZaiCodingPlanOutputExhaustedError,
  ZaiCodingPlanTransportError,
} from "../src/lib/zai-coding-plan";

const ENV = { ZAI_CODING_API_KEY: "cp-key", ZAI_CODING_BASE_URL: "https://api.z.ai/api/coding/paas/v4" } as Env;

function sseResponse(chunks: string[], headers?: Record<string, string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: headers ?? { "content-type": "text/event-stream" } });
}

function jsonBodyResponse(payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: headers ?? { "content-type": "application/json" } });
}

// ── §1-§4: request shape ─────────────────────────────────────────────────────

describe("Coding Plan request shape (GO §1/§5)", () => {
  it("§1 posts to the Coding Plan chat/completions path with the Bearer credential, thinking disabled, and the routed model", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 1234,
      stream: false,
      label: "shape-probe",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init as RequestInit });
        return jsonBodyResponse({ model: "glm-5.3", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { completion_tokens: 1 } });
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.z.ai/api/coding/paas/v4/chat/completions");
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer cp-key");
    const body = JSON.parse(seen[0].init.body as string) as { model: string; stream: boolean; max_tokens: number; thinking: { type: string } };
    expect(body.model).toBe("glm-5.3");
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(1234);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("§1b temperature defaults to 0.7 and an explicit override rides the request body", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const stub = (init: RequestInit) => {
      seen.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return jsonBodyResponse({ model: "glm-5.3", choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { completion_tokens: 1 } });
    };
    await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 64,
      stream: false,
      label: "temp-default",
      fetchImpl: async (_url, init) => stub(init as RequestInit),
    });
    await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 64,
      temperature: 0.3,
      stream: false,
      label: "temp-override",
      fetchImpl: async (_url, init) => stub(init as RequestInit),
    });
    expect(seen[0].temperature).toBe(0.7);
    expect(seen[1].temperature).toBe(0.3);
  });

  it("§2 the credential rides ZAI_CODING_API_KEY only; the base URL is configurable for a future proxy", async () => {
    const seen: string[] = [];
    await generateZaiCodingPlan({ ZAI_CODING_API_KEY: "canonical-key", ZAI_CODING_BASE_URL: "https://proxy.morabeza.example/coding" } as Env, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 64,
      stream: false,
      label: "canonical-credential-probe",
      fetchImpl: async (url, init) => {
        seen.push(String(url));
        expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe("Bearer canonical-key");
        return jsonBodyResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
      },
    });
    expect(seen[0]).toBe("https://proxy.morabeza.example/coding/chat/completions");
  });

  it("§2b fails closed with no credential: transport error before any network call, no alias and no fallback", async () => {
    // No fetchImpl: this exercises the PRODUCTION guard (a missing key fails
    // closed before fetch is ever reached). The bounded retry schedule runs
    // its full 3 attempts (~3s), all classified as the missing-credential
    // network fault — never an outbound call, never an alias lookup.
    await expect(
      generateZaiCodingPlan({} as Env, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 16,
        stream: false,
        label: "fail-closed-probe",
      })
    ).rejects.toThrow(/no Coding Plan API key configured \(ZAI_CODING_API_KEY\)/);
  });

  it("§3 stage models resolve from the canonical vars with the GO defaults", () => {
    expect(resolveCodingModel({} as Env)).toBe("glm-5.3");
    expect(resolveCodingModel({ ZAI_CODING_MODEL: "glm-5.3" } as Env)).toBe("glm-5.3");
    expect(resolveCodingMultimodalModel({} as Env)).toBe("glm-5.3-flash");
    expect(resolveCodingMultimodalModel({ ZAI_MULTIMODAL_MODEL: "glm-5.3v" } as Env)).toBe("glm-5.3v");
  });

  it("§4 a missing credential is a deterministic configuration error, not a retry loop", async () => {
    let thrown: unknown;
    try {
      await generateZaiCodingPlan({} as Env, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 64,
        stream: false,
        label: "no-key-probe",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanTransportError);
  });
});

// ── §5-§7: synchronous mode ──────────────────────────────────────────────────

describe("synchronous Coding Plan mode", () => {
  it("§5 extracts content, model echo, finish reason, usage and the request id", async () => {
    const result = await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 100,
      stream: false,
      label: "sync-probe",
      fetchImpl: async () =>
        jsonBodyResponse(
          { model: "glm-5.3", choices: [{ message: { content: "body { margin: 0 }", reasoning_content: "chain of thought" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
          { "x-request-id": "req-123" }
        ),
    });
    expect(result.content).toBe("body { margin: 0 }");
    expect(result.provider).toBe("zai-coding-plan");
    expect(result.providerModel).toBe("glm-5.3");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(result.requestId).toBe("req-123");
  });

  it("§6 reasoning_content NEVER enters the content (GO §14)", async () => {
    const result = await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 100,
      stream: false,
      label: "reasoning-probe",
      fetchImpl: async () =>
        jsonBodyResponse({ choices: [{ message: { content: "the answer", reasoning_content: "long reasoning prose </think>" }, finish_reason: "stop" }] }),
    });
    expect(result.content).toBe("the answer");
    expect(result.content).not.toContain("reasoning");
  });

  it("§7 empty content with a 200 is a malformed response, never a result", async () => {
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 100,
        stream: false,
        label: "empty-probe",
        fetchImpl: async () => jsonBodyResponse({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanTransportError);
  });
});

// ── §8-§11: streaming mode (GO §13/§14) ──────────────────────────────────────

describe("streaming Coding Plan mode", () => {
  it("§8 accumulates delta.content, ignores delta.reasoning_content, and requires a valid terminal", async () => {
    const result = await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 100,
      stream: true,
      label: "stream-probe",
      fetchImpl: async () =>
        sseResponse([
          'data: {"model":"glm-5.3","choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"html {"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"}"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
          "data: [DONE]\n\n",
        ]),
    });
    expect(result.content).toBe("html {}");
    expect(result.content).not.toContain("thinking");
    expect(result.finishReason).toBe("stop");
    expect(result.providerModel).toBe("glm-5.3");
    expect(result.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3 });
  });

  it("§9 a stream that ends without [DONE] or a finish reason is PARTIAL output and is rejected", async () => {
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 100,
        stream: true,
        label: "truncated-probe",
        fetchImpl: async () => sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanTransportError);
    expect((thrown as Error).message).toContain("stream_truncated");
  });

  it("§10 finish_reason=length in a stream classifies OUTPUT_EXHAUSTED and is never retried", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 50,
        stream: true,
        label: "stream-length-probe",
        fetchImpl: async () => {
          calls += 1;
          return sseResponse([
            'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
            "data: [DONE]\n\n",
          ]);
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanOutputExhaustedError);
    expect(calls).toBe(1);
  });

  it("§11 the completion-token ceiling is the equivalent exhaustion signal in sync mode", async () => {
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 40,
        stream: false,
        label: "sync-ceiling-probe",
        fetchImpl: async () => jsonBodyResponse({ choices: [{ message: { content: "x".repeat(90) } }], usage: { completion_tokens: 40 } }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanOutputExhaustedError);
  });
});

// ── §12-§14: bounded transport policy ────────────────────────────────────────

describe("bounded transport policy", () => {
  it("§12 retries a genuine network fault and succeeds within the bound", async () => {
    let calls = 0;
    const result = await generateZaiCodingPlan(ENV, {
      model: "glm-5.3",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 64,
      stream: false,
      label: "retry-probe",
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        return jsonBodyResponse({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] });
      },
    });
    expect(result.content).toBe("ok");
    expect(calls).toBe(2);
  });

  it("§13 a deterministic 4xx fails fast — ONE attempt", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 64,
        stream: false,
        label: "auth-probe",
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 });
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanTransportError);
    expect(calls).toBe(1);
  });

  it("§14 a 5xx upstream error retries within the bound", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateZaiCodingPlan(ENV, {
        model: "glm-5.3",
        messages: [{ role: "user", content: "u" }],
        maxTokens: 64,
        stream: false,
        label: "5xx-probe",
        fetchImpl: async () => {
          calls += 1;
          return new Response("boom", { status: 502 });
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZaiCodingPlanTransportError);
    expect(calls).toBe(3);
  });
});

// ── §15: GET /models ─────────────────────────────────────────────────────────

describe("listZaiCodingPlanModels (GO §8)", () => {
  it("§15 lists OpenAI-style model ids through the Coding Plan endpoint", async () => {
    const seen: string[] = [];
    const result = await listZaiCodingPlanModels({ ZAI_CODING_API_KEY: "cp-key" } as Env, (async (url: unknown) => {
      seen.push(String(url));
      return jsonBodyResponse({ data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }, { id: "glm-4.7" }] });
    }) as unknown as typeof fetch);
    expect(seen[0]).toBe("https://api.z.ai/api/coding/paas/v4/models");
    expect(result.listed).toBe(true);
    expect(result.models).toEqual(["glm-5.3", "glm-5.3-flash", "glm-4.7"]);
  });
});
