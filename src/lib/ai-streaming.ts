// Streaming AI transport boundary (experiment/simplified-design-pipeline,
// transport iteration per the operator brief sections 3-13).
//
// ONE reusable boundary for every SIMPLE stage that needs a long completion.
// It speaks the Z.AI GENERAL API OpenAI-compatible protocol
// (https://api.z.ai/api/paas/v4/chat/completions) with stream:true and
// thinking disabled, consumes the SSE chunks, and resolves with ONE final
// assembled string plus transport metrics. It is TRANSPORT ONLY:
//  - no partial output ever escapes — callers receive either a complete
//    result or a thrown error (partial content is discarded, section 9);
//  - reasoning_content deltas are ignored and never accumulate (section 8);
//  - retry semantics stay bounded and transport-class only (section 11) —
//    a slow stream with flowing bytes is healthy and is never retried;
//  - stream health is "bytes still arriving" (stall timeout), not "whole
//    completion inside 120 seconds" (section 12).
//
// The canonical model policy is preserved: the model is always
// resolveLlmModel(env) — glm-5.3-flash — on provider zhipu/Z.AI. No fallback
// providers here: the broken AI-Gateway leg is deliberately out of this
// experiment's benchmark path (section 18).

import type { Env } from "../env.d";
import { resolveLlmModel } from "./ai-gateway";

export const DEFAULT_GENERAL_API_BASE = "https://api.z.ai/api/paas/v4";
const MAX_TRANSPORT_ATTEMPTS = 3;

export interface StreamingImage {
  base64: string;
  mimeType: string;
}

/** Native structured output request (schema-convergence brief §3): the JSON
 *  Schema travels in the provider's response_format, not in prompt prose.
 *  Workers AI wrapper shape verified via
 *  `wrangler ai models schema @cf/zai-org/glm-5.3-flash`. */
export interface StreamingJsonSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface StreamingCompletionOptions {
  system: string;
  user: string;
  images?: StreamingImage[];
  maxTokens: number;
  jsonMode?: boolean;
  /** Native json_schema structured output; takes precedence over jsonMode.
   *  The prompt should explain design intent — the transport enforces
   *  structure (schema-convergence brief §3). */
  jsonSchema?: StreamingJsonSchema;
  /** Stable per-call label for logs/metrics, e.g. "simple-design-blueprint". */
  label: string;
  /** Override the default General API base (tests / canaries). */
  endpointBase?: string;
  /** General API thinking level. The General API REJECTS "disabled" for
   *  glm-5.3-flash (error 1210: "This model always engages in thinking");
   *  the lowest available level "low" is the default. Section 8's real
   *  requirement is honored structurally: reasoning_content deltas are
   *  never accumulated into the stage result. */
  thinking?: "low" | "high" | "max";
}

export interface StreamingUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface StreamingCompletionResult {
  content: string;
  provider: "zhipu" | "workers-ai";
  model: string;
  requestId: string | null;
  finishReason: string | null;
  usage: StreamingUsage | null;
  /** ms to the first SSE data event. */
  ttfbMs: number;
  /** ms to the last byte of the stream. */
  durationMs: number;
  /** number of SSE data events consumed */
  chunks: number;
  endpoint: string;
}

export type StreamingFailureKind =
  | "http_status"
  | "network"
  | "stall"
  | "max_duration"
  | "malformed_stream";

export interface StreamingAttemptDiagnostic {
  attempt: number;
  kind: StreamingFailureKind;
  httpStatus?: number;
  durationMs: number;
  /** head of an error response / error message — never includes the key */
  snippet?: string;
}

/** Terminal after the bounded transport attempts — recognized by the SIMPLE
 *  builder's explicit TWO-CALL fallback eligibility (section 26). */
export class StreamingTransportExhaustedError extends Error {
  constructor(readonly attempts: StreamingAttemptDiagnostic[]) {
    super(
      `streaming transport exhausted after ${attempts.length} attempt(s): ${attempts
        .map((a) => `${a.kind}${a.httpStatus ? `/${a.httpStatus}` : ""} (${Math.round(a.durationMs / 1000)}s${a.snippet ? `: ${a.snippet.slice(0, 120)}` : ""})`)
        .join("; ")}`
    );
    this.name = "StreamingTransportExhaustedError";
  }
}

function generalApiBase(env: Env): string {
  return (env.ZHIPU_GENERAL_API_URL ?? DEFAULT_GENERAL_API_BASE).replace(/\/$/, "");
}

function stallTimeoutMs(env: Env): number {
  return Number(env.SIMPLE_STREAM_STALL_TIMEOUT_MS ?? 90_000);
}

function maxDurationMs(env: Env): number {
  return Number(env.SIMPLE_STREAM_MAX_DURATION_MS ?? 600_000);
}

// ── Pure SSE assembly (unit-tested) ─────────────────────────────────────────

export interface StreamAssemblerState {
  content: string;
  usage: StreamingUsage | null;
  finishReason: string | null;
  done: boolean;
  chunks: number;
}

export function createStreamAssembler(): StreamAssemblerState {
  return { content: "", usage: null, finishReason: null, done: false, chunks: 0 };
}

/** Consumes ONE complete SSE line (no trailing newline). Returns the updated
 *  state; unknown shapes are ignored defensively. `[DONE]` marks completion;
 *  reasoning_content is never accumulated (section 8). */
export function pushSseLine(state: StreamAssemblerState, line: string): StreamAssemblerState {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return state;
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return payload === "[DONE]" ? { ...state, done: true } : state;
  }
  let parsed: {
    choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>;
    usage?: StreamingUsage;
  };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return state; // keep-alive/comment or foreign frame — ignore
  }
  const next: StreamAssemblerState = { ...state, chunks: state.chunks + 1 };
  const delta = parsed.choices?.[0]?.delta;
  if (typeof delta?.content === "string" && delta.content.length > 0) {
    next.content += delta.content;
  }
  // Workers AI frame shape: `{"response":"..."}` per data event (and legacy
  // `p` prompt-echo frames, which are ignored by the content-type guard).
  const responseField = (parsed as { response?: unknown }).response;
  if (typeof responseField === "string" && responseField.length > 0) {
    next.content += responseField;
  }
  // reasoning_content deliberately NOT accumulated (section 8).
  if (parsed.choices?.[0]?.finish_reason) next.finishReason = parsed.choices[0].finish_reason;
  if (parsed.usage && typeof parsed.usage === "object") next.usage = parsed.usage;
  return next;
}

/** Splits a raw SSE byte-chunk (decoded) into complete lines, returning the
 *  remainder for the next chunk. */
export function splitSseLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const combined = buffer + chunk;
  const parts = combined.split("\n");
  return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] };
}

// ── Single streamed attempt ──────────────────────────────────────────────────

type AttemptOutcome = {
  kind: "ok";
  result: StreamingCompletionResult;
} | {
  kind: StreamingFailureKind;
  httpStatus?: number;
  snippet?: string;
  durationMs: number;
};

// jsonSchema (native structured output) takes precedence over plain
// json_object mode — structure is enforced by the transport, not the prompt.
function responseFormatFor(options: StreamingCompletionOptions): Record<string, unknown> | null {
  if (options.jsonSchema) return { type: "json_schema", json_schema: options.jsonSchema };
  if (options.jsonMode) return { type: "json_object" };
  return null;
}

async function runStreamAttempt(
  env: Env,
  options: StreamingCompletionOptions,
  attemptStartedAt: number
): Promise<AttemptOutcome> {
  const endpoint = `${options.endpointBase ?? generalApiBase(env)}/chat/completions`;
  const controller = new AbortController();
  const stall = stallTimeoutMs(env);
  const cap = maxDurationMs(env);
  let lastActivityAt = Date.now();
  const stalled = () => controller.abort();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(stalled, stall);
  };
  const capTimer = setTimeout(stalled, cap);

  try {
    const messages: unknown[] = [
      { role: "system", content: options.system },
      {
        role: "user",
        content: options.images?.length
          ? [
              ...options.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
              })),
              { type: "text", text: options.user },
            ]
          : options.user,
      },
    ];
    const body: Record<string, unknown> = {
      model: resolveLlmModel(env),
      messages,
      stream: true,
      max_tokens: options.maxTokens,
      // GENERAL API serving shape (live §5 evidence 2026-09-08): "disabled"
      // is rejected with error 1210 — the model always thinks; "low" is the
      // minimum. reasoning_content deltas are ignored by the assembler
      // (section 8) and never reach artifacts.
      thinking: { type: options.thinking ?? "low" },
      stream_options: { include_usage: true },
    };
    const responseFormat = responseFormatFor(options);
    if (responseFormat) body.response_format = responseFormat;

    armStallTimer();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ZHIPU_API_KEY ?? ""}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const snippet = await response.text().catch(() => "");
      clearTimeout(capTimer);
      return {
        kind: "http_status",
        httpStatus: response.status,
        snippet: snippet.replace(/\s+/g, " ").slice(0, 300),
        durationMs: Date.now() - attemptStartedAt,
      };
    }
    if (!response.body) {
      clearTimeout(capTimer);
      return { kind: "malformed_stream", durationMs: Date.now() - attemptStartedAt };
    }

    const requestId = response.headers.get("x-request-id");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assembler = createStreamAssembler();
    let ttfbMs = -1;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastActivityAt = Date.now();
      armStallTimer();
      if (ttfbMs < 0) ttfbMs = Date.now() - attemptStartedAt;
      const decoded = decoder.decode(value, { stream: true });
      const { lines, rest } = splitSseLines(buffer, decoded);
      buffer = rest;
      for (const line of lines) {
        assembler = pushSseLine(assembler, line);
      }
      if (assembler.done) break;
    }
    clearTimeout(stallTimer);
    clearTimeout(capTimer);
    const durationMs = Date.now() - attemptStartedAt;

    // Drain any final buffered line, then validate completeness (section 9:
    // an EMPTY stream is a transport failure; nothing partial escapes).
    // A stream that ended cleanly with non-empty content is transport-complete
    // even when the provider omitted the [DONE] sentinel — Workers AI ends
    // max_tokens-truncated streams with finish_reason "length" and no [DONE];
    // truncation is a SCHEMA concern (section 10) and must not be retried as
    // a transport failure (live evidence: 3×6-minute deterministic re-streams).
    if (buffer.trim().length > 0) assembler = pushSseLine(assembler, buffer);
    const cleanlyEnded = assembler.done || assembler.finishReason !== null;
    if (!cleanlyEnded || assembler.content.length === 0) {
      return {
        kind: "malformed_stream",
        durationMs,
        snippet: `done=${assembler.done} finishReason=${assembler.finishReason} contentChars=${assembler.content.length} chunks=${assembler.chunks}`,
      };
    }
    return {
      kind: "ok",
      result: {
        content: assembler.content,
        provider: "zhipu",
        model: resolveLlmModel(env),
        requestId,
        finishReason: assembler.finishReason,
        usage: assembler.usage,
        ttfbMs,
        durationMs,
        chunks: assembler.chunks,
        endpoint,
      },
    };
  } catch (error) {
    clearTimeout(stallTimer);
    clearTimeout(capTimer);
    const durationMs = Date.now() - attemptStartedAt;
    const name = (error as Error).name;
    const message = (error as Error).message ?? "";
    if (name === "AbortError" || message.includes("aborted")) {
      const idleMs = Date.now() - lastActivityAt;
      // The abort came from the stall timer or the absolute cap timer.
      return {
        kind: idleMs >= stall ? "stall" : "max_duration",
        durationMs,
        snippet: `stream aborted; idleMs≈${idleMs}`,
      };
    }
    return { kind: "network", durationMs, snippet: message.slice(0, 300) };
  }
}

// ── Public boundary ──────────────────────────────────────────────────────────

/** ONE streaming completion with bounded transport retries. Resolves only
 *  with the COMPLETE assembled content (section 9/10); throws
 *  StreamingTransportExhaustedError after the bounded attempts. Never retries
 *  a healthy-but-slow stream (section 11) — only failed/stalled streams. */
export async function generateStreamingCompletion(
  env: Env,
  options: StreamingCompletionOptions
): Promise<StreamingCompletionResult> {
  const attempts: StreamingAttemptDiagnostic[] = [];
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const outcome = await runStreamAttempt(env, options, startedAt);
    if (outcome.kind === "ok") {
      console.info(
        `streaming_completion_ok { label: '${options.label}', ttfbMs: ${outcome.result.ttfbMs}, durationMs: ${outcome.result.durationMs}, chunks: ${outcome.result.chunks}, outputTokens: ${outcome.result.usage?.completion_tokens ?? "n/a"} }`
      );
      return outcome.result;
    }
    attempts.push({
      attempt,
      kind: outcome.kind,
      httpStatus: outcome.httpStatus,
      durationMs: outcome.durationMs,
      snippet: outcome.snippet,
    });
    // Non-retryable request defect (auth/model/shape): fail immediately.
    if (outcome.kind === "http_status" && outcome.httpStatus !== undefined && outcome.httpStatus < 500 && outcome.httpStatus !== 429) {
      break;
    }
    if (attempt < MAX_TRANSPORT_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new StreamingTransportExhaustedError(attempts);
}

// ── §16 alternate transport: Cloudflare Workers AI, same model release ──────

export const WORKERS_AI_GLM_5_3_FLASH = "@cf/zai-org/glm-5.3-flash";

export type StreamingTransport = "zai_general_stream" | "workers_ai_stream";

async function runWorkersAiStreamAttempt(
  env: Env,
  options: StreamingCompletionOptions,
  attemptStartedAt: number
): Promise<AttemptOutcome> {
  if (!env.AI) {
    return { kind: "network", durationMs: 0, snippet: "env.AI binding not present" };
  }
  const controller = new AbortController();
  const stall = stallTimeoutMs(env);
  let lastActivityAt = Date.now();
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const armStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), stall);
  };
  const capTimer = setTimeout(() => controller.abort(), maxDurationMs(env));

  try {
    const messages: unknown[] = [
      { role: "system", content: options.system },
      {
        role: "user",
        content: options.images?.length
          ? [
              ...options.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
              })),
              { type: "text", text: options.user },
            ]
          : options.user,
      },
    ];
    armStallTimer();
    // LIVE EVIDENCE (blueprint attempts, 2026-09-08): reasoning runs BEFORE
    // any visible content and consumes the same max_tokens budget — complex
    // prompts ended as 1,541 reasoning-only frames → [DONE] with zero
    // content, three times, regardless of the z.ai-style `thinking` param
    // (which the Workers AI schema ignores). The model schema's real control
    // is chat_template_kwargs.enable_thinking (default TRUE). Disable it;
    // reasoning deltas are never accumulated either way (section 8).
    const stream = (await env.AI.run(WORKERS_AI_GLM_5_3_FLASH, {
      messages,
      stream: true,
      max_tokens: options.maxTokens,
      chat_template_kwargs: { enable_thinking: false },
      // Schema-convergence brief §3: native structured output when the caller
      // supplies a schema; plain json_object otherwise (without either, the
      // model prepends prose and the JSON parse fails). stream + json_schema
      // coexist in one request.
      ...(responseFormatFor(options) ? { response_format: responseFormatFor(options) } : {}),
    })) as unknown as ReadableStream<Uint8Array>;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assembler = createStreamAssembler();
    let ttfbMs = -1;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastActivityAt = Date.now();
      armStallTimer();
      if (ttfbMs < 0) ttfbMs = Date.now() - attemptStartedAt;
      const decoded = decoder.decode(value, { stream: true });
      const { lines, rest } = splitSseLines(buffer, decoded);
      buffer = rest;
      for (const line of lines) {
        assembler = pushSseLine(assembler, line);
      }
      if (assembler.done) break;
    }
    clearTimeout(stallTimer);
    clearTimeout(capTimer);
    const durationMs = Date.now() - attemptStartedAt;
    if (buffer.trim().length > 0) assembler = pushSseLine(assembler, buffer);
    if (assembler.content.length === 0) {
      return {
        kind: "malformed_stream",
        durationMs,
        snippet: `no content assembled; chunks=${assembler.chunks} done=${assembler.done}`,
      };
    }
    return {
      kind: "ok",
      result: {
        content: assembler.content,
        provider: "workers-ai",
        model: WORKERS_AI_GLM_5_3_FLASH,
        requestId: null,
        finishReason: assembler.finishReason,
        usage: assembler.usage,
        ttfbMs,
        durationMs,
        chunks: assembler.chunks,
        endpoint: `workers-ai:${WORKERS_AI_GLM_5_3_FLASH}`,
      },
    };
  } catch (error) {
    clearTimeout(stallTimer);
    clearTimeout(capTimer);
    const durationMs = Date.now() - attemptStartedAt;
    const name = (error as Error).name;
    const message = (error as Error).message ?? "";
    if (name === "AbortError" || message.includes("aborted")) {
      const idleMs = Date.now() - lastActivityAt;
      return { kind: idleMs >= stall ? "stall" : "max_duration", durationMs, snippet: `stream aborted; idleMs≈${idleMs}` };
    }
    // A binding-side request defect (e.g. an unsupported json_schema dialect
    // feature) is deterministic — retrying it 3× is not a transport retry,
    // it's waste. Classify as a 4xx so the dispatcher fails fast.
    if (/response_format|json_schema|unsupported|not supported/i.test(message)) {
      return { kind: "http_status", httpStatus: 400, durationMs, snippet: message.slice(0, 300) };
    }
    return { kind: "network", durationMs, snippet: message.slice(0, 300) };
  }
}

/** Workers AI variant of the ONE streaming boundary (§16): same assembly,
 *  same bounded retry and stall semantics, different runtime host. */
export async function generateWorkersAiStreaming(
  env: Env,
  options: StreamingCompletionOptions
): Promise<StreamingCompletionResult> {
  const attempts: StreamingAttemptDiagnostic[] = [];
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const outcome = await runWorkersAiStreamAttempt(env, options, startedAt);
    if (outcome.kind === "ok") {
      console.info(
        `workers_ai_streaming_ok { label: '${options.label}', ttfbMs: ${outcome.result.ttfbMs}, durationMs: ${outcome.result.durationMs}, chunks: ${outcome.result.chunks}, outputTokens: ${outcome.result.usage?.completion_tokens ?? "n/a"} }`
      );
      return outcome.result;
    }
    attempts.push({
      attempt,
      kind: outcome.kind,
      httpStatus: outcome.httpStatus,
      durationMs: outcome.durationMs,
      snippet: outcome.snippet,
    });
    // Non-retryable request defect (schema dialect rejection etc.).
    if (outcome.kind === "http_status" && outcome.httpStatus !== undefined && outcome.httpStatus < 500 && outcome.httpStatus !== 429) {
      break;
    }
    if (attempt < MAX_TRANSPORT_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new StreamingTransportExhaustedError(attempts);
}

/** Transport dispatcher for the experiment: picks the configured streaming
 *  transport. "zai_general_stream" requires §5 entitlement (absent — error
 *  1113), so the experiment runtime pins "workers_ai_stream" (§16). */
export async function generateSimpleStreamingCompletion(
  env: Env,
  options: StreamingCompletionOptions
): Promise<StreamingCompletionResult> {
  if (env.SIMPLE_STREAMING_TRANSPORT === "workers_ai_stream") {
    return generateWorkersAiStreaming(env, options);
  }
  return generateStreamingCompletion(env, options);
}

// ── §5 credential check ──────────────────────────────────────────────────────

export interface GeneralApiCanaryResult {
  GENERAL_API_AUTH: "PASS" | "FAIL";
  MODEL_AVAILABLE: "PASS" | "FAIL" | "UNKNOWN";
  httpStatus: number | null;
  servedModel: string | null;
  errorType: string | null;
}

/** Minimal non-streaming call to the General API with the EXISTING worker
 *  credential. Never returns the key; returns only auth/model verdicts. */
export async function generalApiCredentialCanary(
  env: Env,
  thinking?: "low" | "high" | "max"
): Promise<GeneralApiCanaryResult> {
  const endpoint = `${generalApiBase(env)}/chat/completions`;
  try {
    const body: Record<string, unknown> = {
      model: resolveLlmModel(env),
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      max_tokens: 16,
    };
    if (thinking) body.thinking = { type: thinking };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ZHIPU_API_KEY ?? ""}`,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    if (response.ok) {
      let servedModel: string | null = null;
      try {
        servedModel = (JSON.parse(text) as { model?: string }).model ?? null;
      } catch {
        servedModel = null;
      }
      return { GENERAL_API_AUTH: "PASS", MODEL_AVAILABLE: "PASS", httpStatus: response.status, servedModel, errorType: null };
    }
    const authFail = response.status === 401 || response.status === 403;
    return {
      GENERAL_API_AUTH: authFail ? "FAIL" : response.status < 500 ? "PASS" : "FAIL",
      MODEL_AVAILABLE: response.status === 400 || response.status === 404 ? "FAIL" : authFail ? "FAIL" : "UNKNOWN",
      httpStatus: response.status,
      servedModel: null,
      errorType: text.replace(/\s+/g, " ").slice(0, 200),
    };
  } catch (error) {
    return {
      GENERAL_API_AUTH: "FAIL",
      MODEL_AVAILABLE: "UNKNOWN",
      httpStatus: null,
      servedModel: null,
      errorType: (error as Error).message.slice(0, 200),
    };
  }
}
