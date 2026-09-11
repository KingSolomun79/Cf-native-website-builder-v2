// SIMPLE multimodal generate seam: folds the composed stage prompt into ONE
// vision user turn with the given images attached, so runSchemaValidatedAiStage
// can drive multimodal stages unchanged.
//
// PROVIDER (operator GO 2026-09-11, ZAI CODING PLAN UNIFICATION): Blueprint
// and Visual QA run on the ONE Coding Plan provider (src/lib/zai-coding-plan)
// with the multimodal GLM model verified by the live multimodal canary (GO
// §9; default glm-5.3-flash, ZAI_MULTIMODAL_MODEL overrides). Streaming is a
// transport choice inside that provider (GO §13). No Workers AI, no AI
// Gateway, no provider fallback. Injected test seams always win.

import type { Env } from "../env.d";
import type { RawAiGenerate } from "../domain/ai-boundary";
import { generateZaiCodingPlan, resolveCodingMultimodalModel, type ZaiCodingPlanContentPart } from "../lib/zai-coding-plan";

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

export interface SimpleVisionJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export function createSimpleVisionGenerate(
  env: Env,
  images: SimpleVisionImage[],
  meta: SimpleVisionMeta,
  options?: { maxTokens?: number; jsonSchema?: SimpleVisionJsonSchema }
): RawAiGenerate {
  const model = resolveCodingMultimodalModel(env);
  return async (systemPrompt, userPrompt, attempt) => {
    const content: ZaiCodingPlanContentPart[] = [
      ...images.map((image) => ({ type: "image_url" as const, image_url: { url: `data:${image.mimeType};base64,${image.base64}` } })),
      { type: "text", text: `${systemPrompt}\n\n${userPrompt}` },
    ];
    const result = await generateZaiCodingPlan(env, {
      model,
      messages: [{ role: "user", content }],
      // The caller's budget stands (blueprint stage: 12288; visual QA: 4096).
      maxTokens: options?.maxTokens ?? 16_384,
      stream: true,
      ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : { jsonMode: true }),
      label: `${meta.stage}#${attempt}`,
    });
    return { content: result.content, provider: result.provider, model: result.model, finishReason: result.finishReason, reasoningControl: "thinking.type=disabled" };
  };
}
