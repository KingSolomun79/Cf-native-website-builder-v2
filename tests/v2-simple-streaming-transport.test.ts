// Streaming transport boundary unit tests (experiment transport iteration,
// operator brief sections 7-11). Pure SSE assembly + fallback-eligibility
// classification — no network in these tests.

import { describe, expect, it } from "vitest";
import {
  createStreamAssembler,
  pushSseLine,
  splitSseLines,
  StreamingTransportExhaustedError,
} from "../src/lib/ai-streaming";

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
