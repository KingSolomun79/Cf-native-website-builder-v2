// SIMPLE multimodal generate seam: folds the composed stage prompt into ONE
// vision user turn with the given images attached (same transport pattern as
// the legacy createProductionVisionGenerate / createProductionQaVisionGenerate,
// so runSchemaValidatedAiStage can drive multimodal stages unchanged).

import type { Env } from "../env.d";
import type { RawAiGenerate } from "../domain/ai-boundary";
import { generateVisionWithGateway } from "../lib/ai-gateway";

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
  options?: { maxTokens?: number }
): RawAiGenerate {
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
