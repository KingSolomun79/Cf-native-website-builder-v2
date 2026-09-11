// The ONE LLM provider abstraction for V2 (operator GO 2026-09-11: Z.AI
// CODING PLAN UNIFICATION).
//
// Every V2 language-model operation — Design Blueprint, Website Builder,
// Visual QA, Site Repair, schema/structural correction — routes through this
// module and nowhere else. No provider fallback, no alternate provider, no
// per-stage provider stacks. Stage code supplies model, messages, output
// mode and token ceiling; this module owns base URL, authentication,
// transport (streaming or synchronous), usage, finish reason, request id,
// bounded transport retries and diagnostics.
//
// Endpoint: the Z.AI GLM Coding Plan OpenAI-compatible endpoint
// (https://api.z.ai/api/coding/paas/v4) — NEVER the general/balance API
// (/api/paas/v4). The base URL stays configurable so a Morabeza-owned proxy
// can transparently front the same Coding Plan semantics later.
//
// Reasoning (GO §14): the GLM models are reasoning models. Reasoning output
// (delta.reasoning_content / message.reasoning_content, or the chat
// template's think block) NEVER enters generated artifacts — only final
// content is returned. `thinking: { type: "disabled" }` is sent on every
// call (live production evidence, issue #30: reasoning draws from the same
// token budget and returns empty content at small caps).
//
// Transport (GO §13): streaming (OpenAI-compatible SSE) is preferred for
// large completions; synchronous for small ones. Both modes are transport
// choices INSIDE this provider — never a provider switch. Streaming
// accumulates content, requires a valid terminal completion ([DONE] with a
// finish reason), rejects partial output, and classifies finish_reason
// "length" as OUTPUT_EXHAUSTED (never retried, never budget-raised).
// Network/provider faults retry under the bounded policy (3 attempts,
// exponential backoff, 4xx-class deterministic request defects fail fast).

import type { Env } from "../env.d";

export const ZAI_CODING_PLAN_DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

/** Canonical stage models (GO §4) — resolved from explicit vars when set. */
export function resolveCodingModel(env: Env): string {
  return env.ZAI_CODING_MODEL || "glm-5.3";
}

export function resolveCodingMultimodalModel(env: Env): string {
  return env.ZAI_MULTIMODAL_MODEL || "glm-5.3-flash";
}

function baseUrlOf(env: Env): string {
  return (env.ZAI_CODING_BASE_URL || env.ZHIPU_API_URL || ZAI_CODING_PLAN_DEFAULT_BASE_URL).replace(/\/$/, "");
}

function apiKeyOf(env: Env): string | undefined {
  // Canonical secret is ZAI_CODING_API_KEY; ZHIPU_API_KEY is accepted as the
  // configured Coding Plan credential on environments that predate the
  // rename (the sandbox). Production sets ZAI_CODING_API_KEY explicitly.
  return env.ZAI_CODING_API_KEY || env.ZHIPU_API_KEY;
}

export type ZaiCodingPlanContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ZaiCodingPlanMessage {
  role: "system" | "user" | "assistant";
  content: string | ZaiCodingPlanContentPart[];
}

export interface ZaiCodingPlanOptions {
  model: string;
  messages: ZaiCodingPlanMessage[];
  /** Hard output ceiling (max_tokens). */
  maxTokens: number;
  /** §13: streaming is a transport choice inside the Coding Plan. */
  stream: boolean;
  /** json_object response mode for structured stages that predate native
   *  schema support on this endpoint. */
  jsonMode?: boolean;
  /** Native response_format json_schema when the caller supplies one. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  /** Stable per-call label for logs/metrics — never prompt content. */
  label: string;
  /** Unit-test seam replacing fetch. */
  fetchImpl?: typeof fetch;
}

export interface ZaiCodingPlanUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ZaiCodingPlanResult {
  content: string;
  provider: "zai-coding-plan";
  /** The requested (routed) model. */
  model: string;
  /** The provider's echoed model when the response carries one. */
  providerModel: string | null;
  finishReason: string | null;
  usage: ZaiCodingPlanUsage | null;
  /** x-request-id (or cf-ray) response header when present — canary evidence. */
  requestId: string | null;
  durationMs: number;
  contentChars: number;
}

/** Normalized single-attempt diagnostic — never contains prompt content. */
export interface ZaiCodingPlanAttempt {
  attempt: number;
  kind: "network" | "aborted" | "http_status" | "malformed_response" | "stream_truncated";
  durationMs: number;
  httpStatus?: number;
  /** head of an error message — never includes secrets */
  snippet?: string;
}

const MAX_TRANSPORT_ATTEMPTS = 3;

/** OUTPUT_EXHAUSTED: the provider hit the output ceiling (finish_reason
 *  "length", or the completion-token ceiling reached). Fail closed — never
 *  parsed as a stage result, never retried, never budget-raised here. */
export class ZaiCodingPlanOutputExhaustedError extends Error {
  constructor(
    readonly label: string,
    readonly maxTokens: number,
    readonly finishReason: string | null,
    readonly usage: ZaiCodingPlanUsage | null,
    readonly contentChars: number,
    readonly durationMs: number
  ) {
    super(
      `zai coding plan output exhausted (${label}): finish_reason=${finishReason ?? "n/a"} ` +
        `completion_tokens=${usage?.completion_tokens ?? "n/a"}/${maxTokens} ` +
        `contentChars=${contentChars} durationMs=${durationMs}`
    );
    this.name = "ZaiCodingPlanOutputExhaustedError";
  }
}

/** Bounded transport retries spent on genuine provider faults. Transient-class
 *  under the existing policy — the engine may retry the stage; the transport
 *  never widens its own budget. */
export class ZaiCodingPlanTransportError extends Error {
  constructor(
    readonly label: string,
    readonly attempts: ZaiCodingPlanAttempt[]
  ) {
    super(
      `zai coding plan transport exhausted after ${attempts.length} attempt(s) (${label}): ${attempts
        .map((a) => `${a.kind}${a.httpStatus ? `/${a.httpStatus}` : ""} (${Math.round(a.durationMs / 1000)}s${a.snippet ? `: ${a.snippet.slice(0, 120)}` : ""})`)
        .join("; ")}`
    );
    this.name = "ZaiCodingPlanTransportError";
  }
}

function maxDurationMs(env: Env): number {
  return Number(env.SIMPLE_STREAM_MAX_DURATION_MS ?? 600_000);
}

interface ProviderPayload {
  content: string;
  providerModel: string | null;
  finishReason: string | null;
  usage: ZaiCodingPlanUsage | null;
}

function extractErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    // fall through to raw text
  }
  return raw.replace(/\s+/g, " ").slice(0, 300);
}

function requestBodyOf(env: Env, options: ZaiCodingPlanOptions, stream: boolean): Record<string, unknown> {
  return {
    model: options.model,
    messages: options.messages,
    stream,
    max_tokens: options.maxTokens,
    temperature: options.temperature ?? 0.7,
    // GLM reasoning control (live production evidence, issue #30): reasoning
    // draws from the same output budget; disabled for direct structured
    // source output.
    thinking: { type: "disabled" },
    ...(options.jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { name: options.jsonSchema.name, schema: options.jsonSchema.schema } } }
      : options.jsonMode
        ? { response_format: { type: "json_object" } }
        : {}),
  };
}

async function parseSseStream(
  body: ReadableStream<Uint8Array>,
  label: string
): Promise<ProviderPayload> {
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let providerModel: string | null = null;
  let finishReason: string | null = null;
  let usage: ZaiCodingPlanUsage | null = null;
  let sawTerminal = false;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") {
        sawTerminal = true;
        continue;
      }
      let chunk: {
        model?: unknown;
        choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }>;
        usage?: unknown;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (typeof chunk.model === "string") providerModel = chunk.model;
      // §14: delta.reasoning_content is deliberately IGNORED — reasoning
      // never enters the accumulated artifact content.
      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === "string") content += delta.content;
      const reason = chunk.choices?.[0]?.finish_reason;
      if (typeof reason === "string" && reason.length > 0) finishReason = reason;
      if (chunk.usage && typeof chunk.usage === "object") usage = chunk.usage as ZaiCodingPlanUsage;
    }
  }
  // A valid terminal completion is REQUIRED: a stream that ends without
  // [DONE] or a finish reason is partial output and is never returned.
  if (!sawTerminal && finishReason === null) {
    throw new Error(`stream_truncated: SSE stream ended without [DONE] or finish_reason (${label})`);
  }
  return { content, providerModel, finishReason, usage };
}

async function runAttempt(
  env: Env,
  options: ZaiCodingPlanOptions,
  attemptStartedAt: number
): Promise<{ kind: "ok"; result: ZaiCodingPlanResult } | { kind: ZaiCodingPlanAttempt["kind"]; httpStatus?: number; snippet?: string; durationMs: number }> {
  const cap = maxDurationMs(env);
  const controller = new AbortController();
  const capTimer = setTimeout(() => controller.abort(), cap);
  const key = apiKeyOf(env);
  if (!key && !options.fetchImpl) {
    return { kind: "network", durationMs: 0, snippet: "no Coding Plan API key configured (ZAI_CODING_API_KEY)" };
  }
  try {
    const url = `${baseUrlOf(env)}/chat/completions`;
    const doFetch = options.fetchImpl ?? fetch;
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key ?? ""}`,
      },
      body: JSON.stringify(requestBodyOf(env, options, options.stream)),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const kind = response.status >= 500 || response.status === 524 ? "http_status" : "http_status";
      return { kind, httpStatus: response.status, durationMs: Date.now() - attemptStartedAt, snippet: extractErrorMessage(errorText) };
    }
    let payload: ProviderPayload;
    if (options.stream && response.body) {
      payload = await parseSseStream(response.body, options.label);
    } else {
      const raw = (await response.json()) as {
        model?: unknown;
        choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }>;
        usage?: unknown;
      };
      // §14: message.reasoning_content is deliberately ignored.
      const content = typeof raw.choices?.[0]?.message?.content === "string" ? (raw.choices[0].message.content as string) : "";
      payload = {
        content,
        providerModel: typeof raw.model === "string" ? raw.model : null,
        finishReason: typeof raw.choices?.[0]?.finish_reason === "string" ? (raw.choices[0].finish_reason as string) : null,
        usage: raw.usage && typeof raw.usage === "object" ? (raw.usage as ZaiCodingPlanUsage) : null,
      };
    }
    const durationMs = Date.now() - attemptStartedAt;
    if (payload.content.length === 0) {
      return { kind: "malformed_response", durationMs, snippet: "empty content in provider response" };
    }
    // Exhaustion classification: the provider's finish reason when given,
    // else the token ceiling as the equivalent signal.
    const exhausted =
      payload.finishReason === "length" ||
      (payload.usage?.completion_tokens !== undefined && payload.usage.completion_tokens >= options.maxTokens);
    if (exhausted) {
      throw new ZaiCodingPlanOutputExhaustedError(
        options.label,
        options.maxTokens,
        payload.finishReason,
        payload.usage,
        payload.content.length,
        durationMs
      );
    }
    const requestId = typeof response.headers === "object" && response.headers.get ? response.headers.get("x-request-id") ?? response.headers.get("cf-ray") : null;
    return {
      kind: "ok",
      result: {
        content: payload.content,
        provider: "zai-coding-plan",
        model: options.model,
        providerModel: payload.providerModel,
        finishReason: payload.finishReason,
        usage: payload.usage,
        requestId,
        durationMs,
        contentChars: payload.content.length,
      },
    };
  } catch (error) {
    if (error instanceof ZaiCodingPlanOutputExhaustedError) throw error;
    const durationMs = Date.now() - attemptStartedAt;
    const message = (error as Error).message ?? "";
    if ((error as Error).name === "AbortError" || message.includes("aborted")) {
      return { kind: "aborted", durationMs, snippet: `call aborted at cap ${cap}ms` };
    }
    if (message.startsWith("stream_truncated")) {
      return { kind: "stream_truncated", durationMs, snippet: message.slice(0, 300) };
    }
    return { kind: "network", durationMs, snippet: message.slice(0, 300) };
  } finally {
    clearTimeout(capTimer);
  }
}

/** ONE Coding Plan completion with bounded transport retries (GO §5/§13).
 *  Resolves only with the COMPLETE final content; throws
 *  ZaiCodingPlanOutputExhaustedError on output exhaustion (never retried)
 *  and ZaiCodingPlanTransportError after the bounded transport attempts. */
export async function generateZaiCodingPlan(
  env: Env,
  options: ZaiCodingPlanOptions
): Promise<ZaiCodingPlanResult> {
  const attempts: ZaiCodingPlanAttempt[] = [];
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const outcome = await runAttempt(env, options, startedAt);
    if (outcome.kind === "ok") {
      console.info(
        `zai_coding_plan_ok { label: '${options.label}', stream: ${options.stream}, durationMs: ${outcome.result.durationMs}, finishReason: ${outcome.result.finishReason ?? "n/a"}, outputTokens: ${outcome.result.usage?.completion_tokens ?? "n/a"}, contentChars: ${outcome.result.contentChars} }`
      );
      return outcome.result;
    }
    attempts.push({ attempt, kind: outcome.kind, httpStatus: outcome.httpStatus, durationMs: outcome.durationMs, snippet: outcome.snippet });
    // Non-retryable request defect (auth/shape/model): fail fast.
    if (outcome.kind === "http_status" && outcome.httpStatus !== undefined && outcome.httpStatus < 500) {
      break;
    }
    if (attempt < MAX_TRANSPORT_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new ZaiCodingPlanTransportError(options.label, attempts);
}

/** GET /models through the Coding Plan endpoint (GO §8). Returns the model
 *  ids when the endpoint lists them; throws ZaiCodingPlanTransportError when
 *  it does not (the supported-equivalent probe is then direct model calls). */
export async function listZaiCodingPlanModels(env: Env, fetchImpl?: typeof fetch): Promise<{ listed: boolean; models: string[]; raw: string | null }> {
  const key = apiKeyOf(env);
  const controller = new AbortController();
  const capTimer = setTimeout(() => controller.abort(), 30_000);
  try {
    const doFetch = fetchImpl ?? fetch;
    const response = await doFetch(`${baseUrlOf(env)}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key ?? ""}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { listed: false, models: [], raw: text.slice(0, 400) };
    try {
      const parsed = JSON.parse(text) as { data?: Array<{ id?: unknown }> };
      const models = (parsed.data ?? []).map((entry) => (typeof entry.id === "string" ? entry.id : "")).filter((id) => id.length > 0);
      return { listed: models.length > 0, models, raw: null };
    } catch {
      return { listed: false, models: [], raw: text.slice(0, 400) };
    }
  } catch (error) {
    return { listed: false, models: [], raw: (error as Error).message.slice(0, 200) };
  } finally {
    clearTimeout(capTimer);
  }
}
