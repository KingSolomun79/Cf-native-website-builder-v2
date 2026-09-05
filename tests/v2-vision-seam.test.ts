// Vision-seam reliability (production retest 2026-09-05): the analyzer's
// multimodal call must be bounded end-to-end (headers AND body), must keep
// its request under the encoded byte budget, and must fail closed loudly.
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { generateVisionWithGateway, VisionGatewayError } from "../src/lib/ai-gateway";
import { fitVisionInputToBudget, ReferenceAnalysisError } from "../src/domain/reference-analysis";

const env = providedEnv as unknown as Env;

function stalledResponse(): Response {
  return new Response(new ReadableStream({ start() {} }));
}

describe("vision gateway body-read bound", () => {
  it("fails a stalled 200 body as a bounded timeout instead of hanging the stage", async () => {
    const visionEnv = {
      ...env,
      ZHIPU_API_KEY: "test-zhipu-key",
      VISION_PRIMARY_PROVIDER: "zhipu",
      VISION_FALLBACK_PROVIDER: undefined,
      VISION_REQUEST_TIMEOUT_MS: "1000",
      VISION_MAX_ATTEMPTS_PER_PROVIDER: "2",
      VISION_RETRY_DELAY_MS: "0",
    } as unknown as Env;
    let attempts = 0;
    const requester = async () => {
      attempts += 1;
      return stalledResponse();
    };

    await expect(
      generateVisionWithGateway(
        visionEnv,
        [{ base64: "aGk=", mimeType: "image/png" }],
        "analyze",
        { build_id: "b" },
        { requester }
      )
    ).rejects.toBeInstanceOf(VisionGatewayError);
    expect(attempts).toBe(2);
  });
});

describe("vision input encoded-budget fit", () => {
  it("passes inputs through untouched while the base64 encoding fits the budget", async () => {
    const bytes = new Uint8Array(1024);
    await expect(fitVisionInputToBudget(env, bytes)).resolves.toBe(bytes);
  });

  it("fails closed with VISION_INPUT_OVERSIZE when an oversized input cannot be reduced", async () => {
    const oversizedEnv = { ...env, VISION_INPUT_MAX_BYTES: "65536" } as unknown as Env;
    const junk = new Uint8Array(70 * 1024);
    junk[0] = 0x13;
    await expect(fitVisionInputToBudget(oversizedEnv, junk)).rejects.toMatchObject({
      code: "VISION_INPUT_OVERSIZE",
    });
    expect(junk[0]).toBe(0x13);
  });

  it("maps an invalid VISION_INPUT_MAX_BYTES to the safe default budget", async () => {
    const bytes = new Uint8Array(1024);
    const brokenEnv = { ...env, VISION_INPUT_MAX_BYTES: "not-a-number" } as unknown as Env;
    await expect(fitVisionInputToBudget(brokenEnv, bytes)).resolves.toBe(bytes);
  });
});
