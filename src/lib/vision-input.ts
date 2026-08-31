import type { Env } from "../env.d";
import { getObjectWithMetadata, putImmutableObject, visionInputDerivativeKey } from "./assets";
import { computeChecksum, validateScreenshot } from "./reference-input";

export interface VisionInputArtifact {
  r2Key: string;
  sourceR2Key: string;
  sourceChecksum: string;
  checksum: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  derived: boolean;
  transform: { format: "image/webp"; width: number; height: number; quality: number } | null;
}

export interface PreparedVisionInput {
  artifact: VisionInputArtifact;
  data: ArrayBuffer;
}

export type VisionInputFailureCode =
  | "VISION_INPUT_UNAVAILABLE"
  | "VISION_INPUT_UNSUPPORTED"
  | "VISION_INPUT_CORRUPT"
  | "VISION_INPUT_DERIVATIVE_FAILED";

export class VisionInputPreparationError extends Error {
  constructor(readonly code: VisionInputFailureCode, message: string) {
    super(message);
    this.name = "VisionInputPreparationError";
  }
}

function configuredInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function streamFrom(data: ArrayBuffer): ReadableStream<Uint8Array> {
  const stream = new Response(data).body;
  if (!stream) throw new Error("Unable to create image input stream");
  return stream;
}

function scaledDimensions(width: number, height: number, maxWidth: number, maxHeight: number, multiplier = 1): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height) * multiplier;
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function classifyInvalidScreenshot(code: string): VisionInputFailureCode {
  return code === "SCREENSHOT_WRONG_MIME" || code === "SCREENSHOT_NOT_PNG"
    ? "VISION_INPUT_UNSUPPORTED"
    : "VISION_INPUT_CORRUPT";
}

export async function prepareVisionInput(
  env: Env,
  params: { clientSlug: string; siteVersion: number; jobId: string; screenshotR2Key: string }
): Promise<PreparedVisionInput> {
  const source = await getObjectWithMetadata(env, params.screenshotR2Key);
  if (!source) {
    throw new VisionInputPreparationError("VISION_INPUT_UNAVAILABLE", `Screenshot not found at ${params.screenshotR2Key}`);
  }

  const data = await new Response(source.body).arrayBuffer();
  const validation = validateScreenshot({
    data,
    byteSize: data.byteLength,
    mimeType: source.httpMetadata?.contentType ?? "image/png",
  });
  if (!validation.ok) {
    throw new VisionInputPreparationError(classifyInvalidScreenshot(validation.code), validation.error);
  }

  const { width, height } = validation.metadata;
  const maxBytes = configuredInteger(env.VISION_INPUT_MAX_BYTES, 4 * 1024 * 1024, 64 * 1024, 10 * 1024 * 1024);
  const maxWidth = configuredInteger(env.VISION_INPUT_MAX_WIDTH, 1920, 256, 8192);
  const maxHeight = configuredInteger(env.VISION_INPUT_MAX_HEIGHT, 12000, 768, 40000);
  const sourceChecksum = await computeChecksum(data);
  const needsDerivative = data.byteLength > maxBytes || width > maxWidth || height > maxHeight;

  if (!needsDerivative) {
    return {
      data,
      artifact: {
        r2Key: params.screenshotR2Key,
        sourceR2Key: params.screenshotR2Key,
        sourceChecksum,
        checksum: sourceChecksum,
        mimeType: "image/png",
        byteSize: data.byteLength,
        width,
        height,
        derived: false,
        transform: null,
      },
    };
  }

  let target = scaledDimensions(width, height, maxWidth, maxHeight);
  for (const quality of [80, 65, 50]) {
    try {
      const output = await env.IMAGES.input(streamFrom(data))
        .transform({ width: target.width, height: target.height, fit: "scale-down" })
        .output({ format: "image/webp", quality });
      const derivative = await output.response().arrayBuffer();
      if (derivative.byteLength > maxBytes) {
        target = scaledDimensions(target.width, target.height, target.width, target.height, 0.72);
        continue;
      }
      const checksum = await computeChecksum(derivative);
      const r2Key = visionInputDerivativeKey(params.clientSlug, params.siteVersion, params.jobId, checksum);
      const existing = await env.SITE_BUCKET.head(r2Key);
      if (!existing) {
        try {
          await putImmutableObject(env, r2Key, derivative, {
            httpMetadata: { contentType: "image/webp" },
            customMetadata: {
              sourceR2Key: params.screenshotR2Key,
              sourceChecksum,
              width: String(target.width),
              height: String(target.height),
              quality: String(quality),
            },
          });
        } catch (error) {
          if (!await env.SITE_BUCKET.head(r2Key)) throw error;
        }
      }
      return {
        data: derivative,
        artifact: {
          r2Key,
          sourceR2Key: params.screenshotR2Key,
          sourceChecksum,
          checksum,
          mimeType: "image/webp",
          byteSize: derivative.byteLength,
          width: target.width,
          height: target.height,
          derived: true,
          transform: { format: "image/webp", width: target.width, height: target.height, quality },
        },
      };
    } catch (error) {
      if (error instanceof VisionInputPreparationError) throw error;
      if (quality === 50) {
        throw new VisionInputPreparationError("VISION_INPUT_DERIVATIVE_FAILED", `Unable to prepare bounded vision input: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  throw new VisionInputPreparationError("VISION_INPUT_DERIVATIVE_FAILED", `Derived vision input exceeded the ${maxBytes} byte budget.`);
}
