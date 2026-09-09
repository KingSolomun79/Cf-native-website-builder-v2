// SIMPLE multimodal generate seam: folds the composed stage prompt into ONE
// vision user turn with the given images attached (same transport pattern as
// the legacy createProductionVisionGenerate / createProductionQaVisionGenerate,
// so runSchemaValidatedAiStage can drive multimodal stages unchanged).
//
// EXPERIMENT TRANSPORT ITERATION: when SIMPLE_STREAMING_TRANSPORT is
// "zai_general_stream", the default seam routes through the ONE shared
// streaming boundary (src/lib/ai-streaming.ts) on the Z.AI GENERAL API —
// transport only; stage semantics, schema validation and artifact rules are
// unchanged (operator brief sections 6-13). Injected test seams always win.

import type { Env } from "../env.d";
import type { RawAiGenerate } from "../domain/ai-boundary";
import { generateVisionWithGateway } from "../lib/ai-gateway";
import { generateSimpleStreamingCompletion, type StreamingJsonSchema } from "../lib/ai-streaming";

export function simpleStreamingTransportEnabled(env: Env): boolean {
  return env.SIMPLE_STREAMING_TRANSPORT === "zai_general_stream" || env.SIMPLE_STREAMING_TRANSPORT === "workers_ai_stream";
}

export interface SimpleVisionImage {
  base64: string;
  mimeType: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function mimeForKey(key: string): string {
  return /\.webp$/i.test(key) ? "image/webp" : "image/png";
}

export interface SimpleVisionMeta {
  buildId: string;
  stage: string;
  buildVersionNumber: number;
}

export function createSimpleVisionGenerate(
  env: Env,
  images: SimpleVisionImage[],
  meta: SimpleVisionMeta,
  options?: { maxTokens?: number; jsonSchema?: StreamingJsonSchema }
): RawAiGenerate {
  if (simpleStreamingTransportEnabled(env)) {
    return async (systemPrompt, userPrompt, attempt) => {
      const result = await generateSimpleStreamingCompletion(env, {
        system: systemPrompt,
        user: userPrompt,
        images,
        // The caller's budget stands (blueprint stage: 16384 = §20's natural
        // 6-12K target plus headroom). Streaming removes the provider edge
        // window, not the stage's own budget discipline; a length-truncated
        // stream is transport-complete and is the schema layer's business.
        maxTokens: options?.maxTokens ?? 16_384,
        // Native json_schema structured output (schema-convergence brief §3)
        // when the caller supplies one; plain json_object otherwise.
        ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
        jsonMode: true,
        label: `${meta.stage}#${attempt}`,
      });
      return { content: result.content, provider: result.provider, model: result.model };
    };
  }
  return async (systemPrompt, userPrompt, attempt) => {
    const result = await generateVisionWithGateway(
      env,
      images,
      `${systemPrompt}\n\n${userPrompt}`,
      {
        job_id: `simple-${meta.stage}-${meta.buildId.slice(0, 12)}`,
        site_id: meta.stage,
        stage: meta.stage,
        attempt,
      },
      { stage: meta.stage, ...(options?.maxTokens ? { maxTokens: options.maxTokens } : {}) }
    );
    return { content: result.content, provider: result.provider, model: result.model };
  };
}
