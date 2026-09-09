// Streaming transport boundary unit tests (experiment transport iteration,
// operator brief sections 7-11). Pure SSE assembly + fallback-eligibility
// classification — no network in these tests.

import { describe, expect, it } from "vitest";
import {
  createStreamAssembler,
  generateWorkersAiStreaming,
  pushSseLine,
  splitSseLines,
  StreamingTransportExhaustedError,
} from "../src/lib/ai-streaming";
import type { Env } from "../src/env.d";
import { DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA } from "../src/simple-design/contracts";

describe("streaming SSE assembler (operator brief sections 7-9)", () => {
  it("assembles delta.content in order across chunks", () => {
    let state = createStreamAssembler();
    for (const line of [
      'data: {"choices":[{"delta":{"content":"{\\"a\\":"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"1,\\"b\\":2}"}}]}',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    ]) {
      state = pushSseLine(state, line);
    }
    expect(state.content).toBe('{"a":1,"b":2}');
    expect(state.finishReason).toBe("stop");
    expect(state.done).toBe(false);
    expect(state.chunks).toBe(3);
  });

  it("marks [DONE] and never treats it as content", () => {
    let state = pushSseLine(createStreamAssembler(), "data: [DONE]");
    expect(state.done).toBe(true);
    expect(state.content).toBe("");
    state = pushSseLine(state, "data: [DONE]");
    expect(state.done).toBe(true);
  });

  it("ignores reasoning_content entirely (section 8)", () => {
    let state = createStreamAssembler();
    state = pushSseLine(state, 'data: {"choices":[{"delta":{"reasoning_content":"thinking hard"}}]}');
    state = pushSseLine(state, 'data: {"choices":[{"delta":{"content":"visible"}}]}');
    expect(state.content).toBe("visible");
  });

  it("captures usage when the provider supplies it", () => {
    let state = createStreamAssembler();
    state = pushSseLine(state, 'data: {"choices":[{"delta":{"content":"x"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}');
    expect(state.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("ignores keep-alive frames and malformed JSON without throwing", () => {
    let state = createStreamAssembler();
    state = pushSseLine(state, ": keep-alive");
    state = pushSseLine(state, "data: not-json");
    state = pushSseLine(state, "data: {\"choices\":");
    state = pushSseLine(state, "");
    expect(state.chunks).toBe(0);
    expect(state.content).toBe("");
    state = pushSseLine(state, 'data:{"choices":[{"delta":{"content":"ok"}}]}');
    expect(state.content).toBe("ok");
  });

  it("accepts a length-truncated stream: finish_reason present, no [DONE] sentinel (Workers AI live evidence)", () => {
    let state = createStreamAssembler();
    state = pushSseLine(state, 'data: {"choices":[{"delta":{"content":"{\\"partial\\":"}}]}');
    state = pushSseLine(state, 'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":16384}}');
    // No "data: [DONE]" frame follows a length-terminated stream.
    expect(state.done).toBe(false);
    expect(state.finishReason).toBe("length");
    expect(state.content.length).toBeGreaterThan(0);
    // The boundary's acceptance rule: done || finishReason !== null.
    expect(state.done || state.finishReason !== null).toBe(true);
  });

  it("buffers partial lines across chunks correctly", () => {
    let state = createStreamAssembler();
    let buffer = "";
    for (const chunk of [
      'data: {"choices":[{"delta":{"conte',
      'nt":"hello"}}]}\ndata: {"choices":[{"delta":{"content":" world"',
      '}}]}\n\ndata: [DONE]\n',
    ]) {
      const split = splitSseLines(buffer, chunk);
      buffer = split.rest;
      for (const line of split.lines) state = pushSseLine(state, line);
    }
    // The trailing "[DONE]" line is only complete if a newline followed it.
    const final = splitSseLines(buffer, "");
    for (const line of final.lines) state = pushSseLine(state, line);
    expect(state.content).toBe("hello world");
    expect(state.done).toBe(true);
  });
});

describe("TWO-CALL fallback eligibility (operator brief section 26)", () => {
  it("exposes StreamingTransportExhaustedError as a distinct terminal transport failure", () => {
    const error = new StreamingTransportExhaustedError([
      { attempt: 1, kind: "stall", durationMs: 91_000 },
      { attempt: 2, kind: "http_status", httpStatus: 524, durationMs: 125_000 },
      { attempt: 3, kind: "stall", durationMs: 90_400 },
    ]);
    expect(error).toBeInstanceOf(StreamingTransportExhaustedError);
    expect(error.attempts).toHaveLength(3);
    expect(error.message).toContain("streaming transport exhausted");
  });
});

// ── Native json_schema structured output (schema-convergence brief §3) ──────

interface CapturedWorkersAiRequest {
  stream?: boolean;
  max_tokens?: number;
  response_format?: { type?: string; json_schema?: { name?: string; schema?: Record<string, unknown> } };
  chat_template_kwargs?: { enable_thinking?: boolean };
  messages?: unknown[];
}

function fakeWorkersAiEnv(behavior: (model: string, params: unknown) => ReadableStream<Uint8Array>): { env: Env; calls: CapturedWorkersAiRequest[] } {
  const calls: CapturedWorkersAiRequest[] = [];
  const env = {
    AI: {
      run: async (model: string, params: unknown) => {
        calls.push(params as CapturedWorkersAiRequest);
        return behavior(model, params);
      },
    },
  } as unknown as Env;
  return { env, calls };
}

function sseFrames(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function blueprintStream(): ReadableStream<Uint8Array> {
  return sseFrames([
    `data: {"choices":[{"delta":{"content":${JSON.stringify(JSON.stringify({ version: "1" }))}}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    "data: [DONE]\n\n",
  ]);
}

describe("Workers AI native json_schema payload (schema-convergence brief section 3)", () => {
  it("carries the schema in response_format while stream stays on — json_schema + stream coexist", async () => {
    const { env, calls } = fakeWorkersAiEnv(() => blueprintStream());
    const result = await generateWorkersAiStreaming(env, {
      system: "system prompt",
      user: "produce the blueprint",
      maxTokens: 4096,
      jsonSchema: DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA,
      label: "test-json-schema",
    });
    expect(calls).toHaveLength(1);
    const params = calls[0];
    expect(params.stream).toBe(true);
    expect(params.chat_template_kwargs?.enable_thinking).toBe(false);
    expect(params.response_format?.type).toBe("json_schema");
    expect(params.response_format?.json_schema?.name).toBe("design-blueprint");
    const schema = params.response_format?.json_schema?.schema;
    expect(schema?.type).toBe("object");
    expect((schema?.properties as Record<string, unknown> | undefined)?.businessFactsRef).toBeDefined();
    expect(result.content).toBe('{"version":"1"}');
    expect(result.provider).toBe("workers-ai");
  });

  it("falls back to json_object when no schema is supplied (unchanged legacy mode)", async () => {
    const { env, calls } = fakeWorkersAiEnv(() => blueprintStream());
    await generateWorkersAiStreaming(env, {
      system: "system prompt",
      user: "produce json",
      maxTokens: 4096,
      jsonMode: true,
      label: "test-json-object",
    });
    expect(calls[0].response_format?.type).toBe("json_object");
  });

  it("json_schema takes precedence over jsonMode when both are set", async () => {
    const { env, calls } = fakeWorkersAiEnv(() => blueprintStream());
    await generateWorkersAiStreaming(env, {
      system: "system prompt",
      user: "produce json",
      maxTokens: 4096,
      jsonMode: true,
      jsonSchema: { name: "tiny", schema: { type: "object" } },
      label: "test-precedence",
    });
    expect(calls[0].response_format?.type).toBe("json_schema");
  });

  it("does not retry a deterministic schema-dialect rejection — fails fast after ONE attempt", async () => {
    const env = {
      AI: {
        run: async () => {
          throw new Error("response_format json_schema is not supported by this model");
        },
      },
    } as unknown as Env;
    let caught: unknown = null;
    try {
      await generateWorkersAiStreaming(env, {
        system: "system prompt",
        user: "produce the blueprint",
        maxTokens: 4096,
        jsonSchema: DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA,
        label: "test-dialect-rejection",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StreamingTransportExhaustedError);
    expect((caught as StreamingTransportExhaustedError).attempts).toHaveLength(1);
    expect((caught as StreamingTransportExhaustedError).attempts[0].kind).toBe("http_status");
  });
});
