import type { ChatCompletionRequest, ChatCompletionResponse, GatewayMeta } from "../types";
import type { Env } from "../env.d";
import { putImmutableObject } from "./assets";
import type { VisionInputArtifact } from "./vision-input";

export type LlmProvider = "ai-gateway" | "zhipu" | "openrouter";

type ProviderChain = LlmProvider[];

// One canonical LLM model for every V2 textual/multimodal call (operator
// decision, issue #30): glm-5.3-flash on every provider leg. Provider
// FAILOVER is allowed only while it keeps serving this exact model; a
// fallback to a different model is a routing defect, not resilience.
export const CANONICAL_LLM_MODEL = "glm-5.3-flash";

// The single model configuration seam. Version-controlled default plus the
// optional LLM_MODEL Worker var; no per-stage or per-provider model names.
export function resolveLlmModel(env: Env): string {
  return env.LLM_MODEL || CANONICAL_LLM_MODEL;
}

export function repairTruncatedJson(raw: string): string {
  let s = raw
    .replace(/^```json?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (s.endsWith("}")) return s;

  const lastBrace = Math.max(s.lastIndexOf("{"), s.lastIndexOf("["));
  const lastQuote = s.lastIndexOf('"');

  let cut = s.length;
  if (lastQuote > lastBrace) {
    cut = lastQuote;
  } else if (lastBrace >= 0) {
    cut = lastBrace + 1;
  }
  s = s.substring(0, cut);

  const openBraces = (s.match(/\{/g) || []).length;
  const closeBraces = (s.match(/\}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/\]/g) || []).length;

  if (s.endsWith('"')) {
    s += '"';
  } else if (s.endsWith(':')) {
    s += '""';
  } else if (s.endsWith(',')) {
    s = s.slice(0, -1);
  }

  for (let i = 0; i < openBrackets - closeBrackets; i++) s += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) s += "}";

  return s;
}

function resolveProvider(env: Env): LlmProvider {
  if (env.ZHIPU_API_KEY) return "zhipu";
  return "ai-gateway";
}

function resolveProviderChain(env: Env): ProviderChain {
  const primary = env.PRIMARY_PROVIDER as LlmProvider | undefined;
  const all: ProviderChain = [];
  const available: ProviderChain = [];

  if (env.ZHIPU_API_KEY) available.push("zhipu");
  if (env.OPENROUTER_API_KEY) available.push("openrouter");
  available.push("ai-gateway");

  if (primary && available.includes(primary)) {
    all.push(primary);
    for (const p of available) {
      if (p !== primary) all.push(p);
    }
    return all;
  }

  if (env.ZHIPU_API_KEY && env.OPENROUTER_API_KEY) {
    return ["zhipu", "openrouter", "ai-gateway"];
  }
  if (env.ZHIPU_API_KEY) {
    return ["zhipu", "ai-gateway"];
  }
  return ["ai-gateway"];
}

export async function callGatewayChat(
  env: Env,
  body: ChatCompletionRequest,
  meta: GatewayMeta,
  provider: LlmProvider,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  if (provider === "zhipu") {
    return callZhipu(env, body, meta, signal, extraHeaders);
  }

  if (provider === "openrouter") {
    return callOpenRouterChat(env, body, meta, signal, extraHeaders);
  }

  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/compat/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "cf-aig-metadata": JSON.stringify(meta),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function callZhipu(
  env: Env,
  body: ChatCompletionRequest,
  meta: GatewayMeta,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  // ZAI primary leg calls the provider's OpenAI-compatible endpoint DIRECTLY
  // (issue #30 model correction): the Cloudflare AI Gateway proxy path rejects
  // the canonical model name ("glm-5.3-flash" is not a valid identifier for
  // it — it demands gateway-specific "<provider>/<model>" names, i.e. a
  // different model label per leg, which the one-canonical-model policy
  // forbids). The AI Gateway remains the fallback leg.
  const baseUrl = env.ZHIPU_API_URL || "https://api.z.ai/api/coding/paas/v4";
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.ZHIPU_API_KEY}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
  });
}

async function callOpenRouterChat(
  env: Env,
  body: ChatCompletionRequest,
  meta: GatewayMeta,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const url = `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_ID}/openrouter/v1/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "cf-aig-metadata": JSON.stringify(meta),
      "HTTP-Referer": env.PUBLIC_APP_URL,
      "X-Title": "CF Website Factory",
      "X-Fallback-Provider": meta.client_slug ?? "cf-website-factory",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function generateWithGateway(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  meta: GatewayMeta,
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean; model?: string }
): Promise<ChatCompletionResponse> {
  const result = await generateWithGatewayDetailed(env, systemPrompt, userPrompt, meta, options);
  return result.response;
}

export interface GatewayChatResult {
  response: ChatCompletionResponse;
  provider: LlmProvider;
  model: string;
}

export async function generateWithGatewayDetailed(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  meta: GatewayMeta,
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean; model?: string }
): Promise<GatewayChatResult> {
  const chain = resolveProviderChain(env);
  const maxRetries = 3;
  const baseDelay = 1000;

  const messages: ChatCompletionRequest["messages"] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (const provider of chain) {
    const resolvedModel = options?.model ?? resolveModel(provider, env);

    const body: ChatCompletionRequest = {
      model: resolvedModel,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 4096,
    };

    if (options?.jsonMode && provider !== "zhipu") {
      body.response_format = { type: "json_object" };
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

      try {
        const response = await callGatewayChat(env, body, meta, provider, controller.signal);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();

          if (response.status === 429 || response.status === 420) {
            if (chain.indexOf(provider) < chain.length - 1) {
              console.log(`[${provider}] rate limited (429), falling back to next provider`);
              break;
            }
            if (attempt < maxRetries) {
              const delay = baseDelay * Math.pow(2, attempt);
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
          }

          if (attempt < maxRetries && (response.status >= 500 || response.status === 524)) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          throw new Error(`${provider} error ${response.status}: ${errorText}`);
        }

        const result = (await response.json()) as ChatCompletionResponse;
        const content = result.choices[0]?.message?.content;

        if (!content && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!content) {
          throw new Error("Empty response from model after retries");
        }

        // Prefer the model identity the provider actually reports over the
        // requested one so provenance cannot drift silently.
        const servedModel = typeof result.model === "string" && result.model.length > 0 ? result.model : resolvedModel;
        return { response: result, provider, model: servedModel };
      } catch (err: any) {
        clearTimeout(timeoutId);

        if (err.name === "AbortError" || err.message?.includes("aborted")) {
          console.log(`[${provider}] request timed out after 5 minutes`);
          if (chain.indexOf(provider) < chain.length - 1) {
            console.log(`[${provider}] falling back to next provider due to timeout`);
            break;
          }
          throw new Error(`[${provider}] timed out and no more providers available`);
        }

        if (attempt === maxRetries) {
          if (chain.indexOf(provider) < chain.length - 1) {
            console.log(`[${provider}] exhausted retries, falling back to next provider`);
            break;
          }
          throw err;
        }
        if (err.message?.includes("Empty response") || (err.message?.includes("error") && !err.message?.includes("SPEC_VALIDATION"))) {
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        if (chain.indexOf(provider) < chain.length - 1) {
          console.log(`[${provider}] non-retriable error, falling back to next provider`);
          break;
        }
        throw err;
      }
    }
  }

  throw new Error("generateWithGateway: all providers exhausted");
}

// Every provider leg resolves to the one canonical model (issue #30). A
// provider that cannot serve it fails that leg — the model is never
// substituted per provider.
function resolveModel(_provider: LlmProvider, env: Env): string {
  return resolveLlmModel(env);
}

export function getActiveProvider(env: Env): LlmProvider {
  return resolveProvider(env);
}

export interface VisionGatewayResult {
  content: string;
  provider: LlmProvider;
  model: string;
}

export type VisionChatRequester = (
  env: Env,
  body: ChatCompletionRequest,
  meta: GatewayMeta,
  provider: LlmProvider,
  signal?: AbortSignal,
  extraHeaders?: Record<string, string>
) => Promise<Response>;

export type VisionFailureClassification = "timeout" | "rate_limited" | "upstream_error" | "network_error" | "empty_response" | "configuration_error" | "non_retryable_http";

export interface VisionAttemptDiagnostic {
  provider: LlmProvider;
  model: string;
  attempt: number;
  durationMs: number;
  outcome: "success" | "failure";
  classification?: VisionFailureClassification;
  httpStatus?: number;
  gatewayRequestId?: string;
}

export class VisionGatewayError extends Error {
  constructor(readonly attempts: VisionAttemptDiagnostic[], readonly diagnosticR2Key?: string) {
    super("All configured vision providers failed");
    this.name = "VisionGatewayError";
  }
}

class VisionDiagnosticsPersistenceError extends Error {
  constructor() {
    super("Vision diagnostics could not be persisted");
    this.name = "VisionDiagnosticsPersistenceError";
  }
}

interface VisionRoute {
  provider: LlmProvider;
  model: string;
}

function parseVisionProvider(value: string | undefined): LlmProvider | null {
  return value === "openrouter" || value === "zhipu" || value === "ai-gateway" ? value : null;
}

function defaultVisionModel(_provider: LlmProvider, env: Env): string {
  // No special vision model path (issue #30): the canonical model serves
  // vision/multimodal input through the configured provider when supported.
  return resolveLlmModel(env);
}

function canUseVisionProvider(env: Env, provider: LlmProvider): boolean {
  if (provider === "zhipu") return Boolean(env.ZHIPU_API_KEY);
  if (provider === "openrouter") return Boolean(env.OPENROUTER_API_KEY);
  return Boolean(env.CF_AIG_TOKEN && env.CF_ACCOUNT_ID && env.CF_AI_GATEWAY_ID);
}

export function resolveVisionProviderChain(env: Env): VisionRoute[] {
  const primaryProvider = parseVisionProvider(env.VISION_PRIMARY_PROVIDER) ?? "zhipu";
  const primaryModel = resolveLlmModel(env);
  const routes: VisionRoute[] = [{ provider: primaryProvider, model: primaryModel }];
  const fallbackProvider = parseVisionProvider(env.VISION_FALLBACK_PROVIDER);
  if (!fallbackProvider) return routes;
  const fallbackModel = resolveLlmModel(env);
  if (fallbackProvider !== primaryProvider || fallbackModel !== primaryModel) routes.push({ provider: fallbackProvider, model: fallbackModel });
  return routes;
}

function configuredInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"));
}

function classifyVisionResponse(status: number): VisionFailureClassification {
  if (status === 420 || status === 429) return "rate_limited";
  if (status === 524 || status >= 500) return "upstream_error";
  return "non_retryable_http";
}

function retryableVisionFailure(classification: VisionFailureClassification): boolean {
  return classification === "timeout" || classification === "rate_limited" || classification === "upstream_error" || classification === "network_error";
}

function gatewayRequestId(response: Response): string | undefined {
  return response.headers.get("cf-aig-request-id") ?? response.headers.get("cf-ray") ?? undefined;
}

async function persistVisionDiagnostics(
  env: Env,
  key: string | undefined,
  meta: GatewayMeta,
  stage: string,
  status: "succeeded" | "failed",
  attempts: VisionAttemptDiagnostic[],
  winningRoute?: VisionRoute,
  visionInput?: VisionInputArtifact
): Promise<void> {
  if (!key) return;
  try {
    await putImmutableObject(env, key, JSON.stringify({
      schemaVersion: 1,
      jobId: meta.job_id,
      siteId: meta.site_id,
      clientSlug: meta.client_slug,
      stage,
      createdAt: new Date().toISOString(),
      status,
      ...(winningRoute ? { provider: winningRoute.provider, model: winningRoute.model } : {}),
      ...(visionInput ? { visionInput: { r2Key: visionInput.r2Key, sourceR2Key: visionInput.sourceR2Key, sourceChecksum: visionInput.sourceChecksum, checksum: visionInput.checksum, mimeType: visionInput.mimeType, byteSize: visionInput.byteSize, width: visionInput.width, height: visionInput.height, derived: visionInput.derived, transform: visionInput.transform } } : {}),
      attempts,
    }, null, 2), { httpMetadata: { contentType: "application/json" } });
  } catch {
    throw new VisionDiagnosticsPersistenceError();
  }
  console.info("vision_diagnostics", { jobId: meta.job_id, siteId: meta.site_id, clientSlug: meta.client_slug, stage, status, diagnosticR2Key: key, attempts });
}

export async function generateVisionWithGateway(
  env: Env,
  imageBase64: string,
  imageMimeType: string,
  analysisPrompt: string,
  meta: GatewayMeta,
  options?: { maxTokens?: number; jsonMode?: boolean; diagnosticR2Key?: string; stage?: string; visionInput?: VisionInputArtifact; requester?: VisionChatRequester }
): Promise<VisionGatewayResult> {
  const routes = resolveVisionProviderChain(env);
  const timeoutMs = configuredInteger(env.VISION_REQUEST_TIMEOUT_MS, 45000, 1000, 120000);
  const maxAttempts = configuredInteger(env.VISION_MAX_ATTEMPTS_PER_PROVIDER, 2, 1, 2);
  const retryDelayMs = configuredInteger(env.VISION_RETRY_DELAY_MS, 500, 0, 10000);
  const attempts: VisionAttemptDiagnostic[] = [];
  const stage = options?.stage ?? meta.prompt_type ?? meta.stage ?? "vision";

  for (const route of routes) {
    if (!canUseVisionProvider(env, route.provider)) {
      attempts.push({ provider: route.provider, model: route.model, attempt: 0, durationMs: 0, outcome: "failure", classification: "configuration_error" });
      continue;
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const body: ChatCompletionRequest = {
        model: route.model,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } },
            { type: "text", text: analysisPrompt },
          ],
      }],
        max_tokens: options?.maxTokens ?? 4096,
      };
      if (options?.jsonMode && route.provider !== "zhipu") {
        body.response_format = { type: "json_object" };
      }

      try {
        const response = await (options?.requester ?? callGatewayChat)(env, body, meta, route.provider, controller.signal, {
          "cf-aig-request-timeout": String(timeoutMs),
          "cf-aig-max-attempts": "1",
        });
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startedAt;
        if (!response.ok) {
          const classification = classifyVisionResponse(response.status);
          attempts.push({ provider: route.provider, model: route.model, attempt, durationMs, outcome: "failure", classification, httpStatus: response.status, gatewayRequestId: gatewayRequestId(response) });
          if (retryableVisionFailure(classification) && attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt - 1)));
            continue;
          }
          break;
        }
        const parsed = await response.json() as ChatCompletionResponse;
        const content = parsed.choices[0]?.message?.content;
        if (!content) {
          attempts.push({ provider: route.provider, model: route.model, attempt, durationMs, outcome: "failure", classification: "empty_response", gatewayRequestId: gatewayRequestId(response) });
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt - 1)));
            continue;
          }
          break;
        }
        attempts.push({ provider: route.provider, model: route.model, attempt, durationMs, outcome: "success", gatewayRequestId: gatewayRequestId(response) });
        await persistVisionDiagnostics(env, options?.diagnosticR2Key, meta, stage, "succeeded", attempts, route, options?.visionInput);
        // Prefer the provider-reported model identity for provenance.
        const servedModel = typeof parsed.model === "string" && parsed.model.length > 0 ? parsed.model : route.model;
        return { content, provider: route.provider, model: servedModel };
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof VisionDiagnosticsPersistenceError) throw error;
        const classification: VisionFailureClassification = isAbortError(error) ? "timeout" : "network_error";
        attempts.push({ provider: route.provider, model: route.model, attempt, durationMs: Date.now() - startedAt, outcome: "failure", classification });
        if (retryableVisionFailure(classification) && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs * Math.pow(2, attempt - 1)));
          continue;
        }
        break;
      }
    }
  }
  await persistVisionDiagnostics(env, options?.diagnosticR2Key, meta, stage, "failed", attempts, undefined, options?.visionInput);
  throw new VisionGatewayError(attempts, options?.diagnosticR2Key);
}
