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
import { generateZaiCodingPlan, resolveCodingModel, resolveCodingMultimodalModel, type ZaiCodingPlanContentPart } from "../lib/zai-coding-plan";

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
  options?: { maxTokens?: number; jsonSchema?: SimpleVisionJsonSchema; temperature?: number }
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
      // Structured stages may pin sampling below the provider default (0.7);
      // the strict no-additional-properties blueprint schema needs it.
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      stream: true,
      ...(options?.jsonSchema ? { jsonSchema: options.jsonSchema } : { jsonMode: true }),
      label: `${meta.stage}#${attempt}`,
    });
    return { content: result.content, provider: result.provider, model: result.model, finishReason: result.finishReason, reasoningControl: "thinking.type=disabled" };
  };
}

// SIMPLE text-only generate seam (operator GO 2026-11-09): the design
// AUTHORITY stages that carry no images run on the coding model (glm-5.3,
// ZAI_CODING_MODEL) instead of the multimodal flash tier. First applied to the
// ORIGINAL_DESIGN Design Blueprint — its input is text-only (Business Facts +
// Creative Direction) and live evidence (2026-11-02..06, three consecutive
// builds) showed the flash tier producing schema-invalid first attempts on
// exactly this stage. Same Coding Plan provider, same transport rules.
export function createSimpleTextGenerate(
  env: Env,
  meta: SimpleVisionMeta,
  options?: { maxTokens?: number; temperature?: number }
): RawAiGenerate {
  const model = resolveCodingModel(env);
  return async (systemPrompt, userPrompt, attempt) => {
    const result = await generateZaiCodingPlan(env, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: options?.maxTokens ?? 16_384,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      stream: true,
      jsonMode: true,
      label: `${meta.stage}#${attempt}`,
    });
    return { content: result.content, provider: result.provider, model: result.model, finishReason: result.finishReason, reasoningControl: "thinking.type=disabled" };
  };
}
