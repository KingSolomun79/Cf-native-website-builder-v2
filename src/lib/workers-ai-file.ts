// Non-streaming RAW single-file completion on the Workers AI binding
// (operator GO 2026-09-11: WEBSITE BUILDER V7 — FILE-SIZED REALIZATION CALLS).
//
// ONE small Builder-specific transport: Workers AI · routed model (the
// Website Builder stage runs @cf/zai-org/glm-5.3) · stream=false · NO
// response_format. Each call realizes exactly ONE source file as plain model
// output — never code inside JSON strings, never a structured envelope. The
// prior single/dual-call structured envelopes are retired: four output
// envelopes across two models proved the failure mode is emitting ~50-100K
// chars of genuine multi-file source in ONE structured completion; the fix is
// output GRANULARITY, not another framing iteration.
//
// Transport only — never a second AI framework:
//  - ONE attempt's result is either a complete provider payload or a thrown
//    error; nothing partial escapes;
//  - output exhaustion (finish_reason=length or the completion-token ceiling
//    reached) is classified OUTPUT_EXHAUSTED and is NEVER retried — a retry
//    is a deterministic repeat, not a recovery;
//  - only genuine transport/provider faults (network, abort, 5xx) retry under
//    the existing bounded policy (3 attempts, exponential backoff, 4xx-class
//    deterministic request defects fail fast).

import type { Env } from "../env.d";

// Stage routing (operator GO 2026-09-10, BUILDER MODEL ROUTING; reaffirmed by
// the file-realization GO §4): the Website Builder runs on Z.ai's full GLM-5.3
// agentic coding model — an intentional stage-specific policy, NOT a
// fallback, substitution, or retry routing. If the full model errors, the
// stage fails under the bounded runtime semantics.
export const WORKERS_AI_GLM_5_3 = "@cf/zai-org/glm-5.3";

export interface WorkersAiFileOptions {
  /** The exact routed model — every caller states it explicitly (stage
   *  routing policy; never substituted or fallen back). */
  model: string;
  system: string;
  user: string;
  /** Hard output ceiling sent as max_completion_tokens. */
  maxCompletionTokens: number;
  /** Stable per-call label for logs/metrics. */
  label: string;
  /** Unit-test seam replacing env.AI.run. */
  run?: (model: string, body: Record<string, unknown>) => Promise<unknown>;
}

export interface WorkersAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface WorkersAiFileResult {
  content: string;
  provider: "workers-ai";
  /** The requested (routed) model. */
  model: string;
  /** The provider's echoed model, when the response carries one (GLM-5.3
   *  OpenAI-style responses do) — canary evidence against substitution. */
  providerModel: string | null;
  /** Provider finish reason when reported (e.g. "stop"); null when absent. */
  finishReason: string | null;
  usage: WorkersAiUsage | null;
  durationMs: number;
  contentChars: number;
}

/** Normalized single-attempt diagnostic — never contains prompt content. */
export interface WorkersAiFileAttempt {
  attempt: number;
  kind: "network" | "aborted" | "http_status" | "malformed_response";
  durationMs: number;
  httpStatus?: number;
  /** head of an error message — never includes secrets */
  snippet?: string;
}

const MAX_TRANSPORT_ATTEMPTS = 3;

/** OUTPUT_EXHAUSTED: the provider hit the output ceiling. Fail closed —
 *  never parsed as a stage result, never retried, never budget-raised here. */
export class WorkersAiFileOutputExhaustedError extends Error {
  constructor(
    readonly label: string,
    readonly maxCompletionTokens: number,
    readonly finishReason: string | null,
    readonly usage: WorkersAiUsage | null,
    readonly contentChars: number,
    readonly durationMs: number
  ) {
    super(
      `workers_ai raw file output exhausted (${label}): finish_reason=${finishReason ?? "n/a"} ` +
        `completion_tokens=${usage?.completion_tokens ?? "n/a"}/${maxCompletionTokens} ` +
        `contentChars=${contentChars} durationMs=${durationMs}`
    );
    this.name = "WorkersAiFileOutputExhaustedError";
  }
}

/** Bounded transport retries spent on genuine provider faults. Transient-class
 *  under the existing policy — the engine may retry the stage, the transport
 *  never widens its own budget. */
export class WorkersAiFileTransportError extends Error {
  constructor(
    readonly label: string,
    readonly attempts: WorkersAiFileAttempt[]
  ) {
    super(
      `workers_ai raw file transport exhausted after ${attempts.length} attempt(s) (${label}): ${attempts
        .map((a) => `${a.kind}${a.httpStatus ? `/${a.httpStatus}` : ""} (${Math.round(a.durationMs / 1000)}s${a.snippet ? `: ${a.snippet.slice(0, 120)}` : ""})`)
        .join("; ")}`
    );
    this.name = "WorkersAiFileTransportError";
  }
}

function maxDurationMs(env: Env): number {
  return Number(env.SIMPLE_STREAM_MAX_DURATION_MS ?? 600_000);
}

interface NormalizedResponse {
  content: string;
  finishReason: string | null;
  usage: WorkersAiUsage | null;
  providerModel: string | null;
}

function normalizeResponse(raw: unknown): NormalizedResponse {
  const r = raw as {
    response?: unknown;
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
    finish_reason?: unknown;
    usage?: unknown;
  };
  let content = "";
  if (typeof r.response === "string") content = r.response;
  else if (typeof r.choices?.[0]?.message?.content === "string") content = r.choices[0].message.content as string;
  const finishReason =
    typeof r.finish_reason === "string"
      ? r.finish_reason
      : typeof r.choices?.[0]?.finish_reason === "string"
        ? (r.choices[0].finish_reason as string)
        : null;
  const usage =
    r.usage && typeof r.usage === "object" ? (r.usage as WorkersAiUsage) : null;
  const providerModel = typeof r.model === "string" ? r.model : null;
  return { content, finishReason, usage, providerModel };
}

async function runFileAttempt(
  env: Env,
  options: WorkersAiFileOptions,
  attemptStartedAt: number
): Promise<{ kind: "ok"; result: WorkersAiFileResult } | { kind: WorkersAiFileAttempt["kind"]; httpStatus?: number; snippet?: string; durationMs: number }> {
  const cap = maxDurationMs(env);
  const controller = new AbortController();
  const capTimer = setTimeout(() => controller.abort(), cap);
  if (!env.AI && !options.run) {
    return { kind: "network", durationMs: 0, snippet: "env.AI binding not present" };
  }
  try {
    const run = options.run ?? ((model, body) => env.AI!.run(model, body as never));
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
      // Raw single-file mode: the payload is plain source, streaming is off.
      stream: false,
      // max_completion_tokens is the supported bound; max_tokens is
      // deprecated and is NOT sent.
      max_completion_tokens: options.maxCompletionTokens,
      // enable_thinking defaults TRUE on this model (schema-verified) and
      // reasoning consumes the same output budget — always disabled.
      chat_template_kwargs: { enable_thinking: false },
      // Deliberately NO response_format: the GO retires structured output for
      // generated source files. The payload is the file itself.
    };
    const raw = await run(options.model, body);
    const durationMs = Date.now() - attemptStartedAt;
    const { content, finishReason, usage, providerModel } = normalizeResponse(raw);
    if (content.length === 0) {
      return { kind: "malformed_response", durationMs, snippet: "empty content in non-streaming response" };
    }
    // Exhaustion classification: the provider's finish reason when given,
    // else the completion-token ceiling as the equivalent signal.
    const exhausted =
      finishReason === "length" ||
      (usage?.completion_tokens !== undefined && usage.completion_tokens >= options.maxCompletionTokens);
    if (exhausted) {
      throw new WorkersAiFileOutputExhaustedError(
        options.label,
        options.maxCompletionTokens,
        finishReason,
        usage,
        content.length,
        durationMs
      );
    }
    return {
      kind: "ok",
      result: {
        content,
        provider: "workers-ai",
        model: options.model,
        providerModel,
        finishReason,
        usage,
        durationMs,
        contentChars: content.length,
      },
    };
  } catch (error) {
    if (error instanceof WorkersAiFileOutputExhaustedError) throw error;
    const durationMs = Date.now() - attemptStartedAt;
    const name = (error as Error).name;
    const message = (error as Error).message ?? "";
    if (name === "AbortError" || message.includes("aborted")) {
      return { kind: "aborted", durationMs, snippet: `non-streaming call aborted at cap ${cap}ms` };
    }
    // A binding-side request defect (bad request shape, unsupported param) is
    // deterministic — classify as 4xx so the dispatcher fails fast.
    if (/unsupported|not supported/i.test(message)) {
      return { kind: "http_status", httpStatus: 400, durationMs, snippet: message.slice(0, 300) };
    }
    return { kind: "network", durationMs, snippet: message.slice(0, 300) };
  } finally {
    clearTimeout(capTimer);
  }
}

/** ONE non-streaming RAW single-file completion with bounded transport
 *  retries. Resolves only with the COMPLETE provider payload; throws
 *  WorkersAiFileOutputExhaustedError on output exhaustion (never retried) and
 *  WorkersAiFileTransportError after the bounded transport attempts. */
export async function generateWorkersAiFile(
  env: Env,
  options: WorkersAiFileOptions
): Promise<WorkersAiFileResult> {
  const attempts: WorkersAiFileAttempt[] = [];
  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    // WorkersAiFileOutputExhaustedError is thrown by the attempt and
    // propagates deliberately: exhaustion is a classification, not a retry
    // candidate.
    const outcome = await runFileAttempt(env, options, startedAt);
    if (outcome.kind === "ok") {
      console.info(
        `workers_ai_file_ok { label: '${options.label}', durationMs: ${outcome.result.durationMs}, finishReason: ${outcome.result.finishReason ?? "n/a"}, outputTokens: ${outcome.result.usage?.completion_tokens ?? "n/a"}, contentChars: ${outcome.result.contentChars} }`
      );
      return outcome.result;
    }
    attempts.push({ attempt, kind: outcome.kind, httpStatus: outcome.httpStatus, durationMs: outcome.durationMs, snippet: outcome.snippet });
    // Non-retryable request defect (auth/model/bad request shape): fail fast.
    if (outcome.kind === "http_status" && outcome.httpStatus !== undefined && outcome.httpStatus < 500) {
      break;
    }
    if (attempt < MAX_TRANSPORT_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new WorkersAiFileTransportError(options.label, attempts);
}
