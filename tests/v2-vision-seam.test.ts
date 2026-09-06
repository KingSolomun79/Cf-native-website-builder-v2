// Vision-seam reliability (production retest 2026-09-05): the analyzer's
// multimodal call must be bounded end-to-end (headers AND body), must keep
// its request under the encoded byte budget, and must fail closed loudly.
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { generateVisionWithGateway, VisionGatewayError } from "../src/lib/ai-gateway";
import { fitVisionInputToBudget, createProductionVisionGenerate, ReferenceAnalysisError } from "../src/domain/reference-analysis";
import { buildPng } from "./helpers/png";

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

// Issue #55: the vision-input preparation (R2 read + PNG decode/downscale/
// re-encode + multi-MB base64) measured ~0.5s CPU per provider call on the
// oversized production reference screenshot, and one generation-step
// invocation serves ~13 byte-identical calls. The prepared wire payload is
// memoized per seam instance so the expensive path runs once.
describe("vision input preparation memoization (issue #55)", () => {
  it("prepares the visual input once per seam instance and reuses it for every provider call", async () => {
    const pngBytes = new Uint8Array(buildPng({ width: 64, height: 48 }));
    let r2Reads = 0;
    const seamEnv = {
      ...env,
      SITE_BUCKET: {
        get: async () => {
          r2Reads += 1;
          return { body: new Response(pngBytes).body };
        },
      },
    } as unknown as Env;
    let gatewayCalls = 0;
    const seam = createProductionVisionGenerate(
      seamEnv,
      [{ kind: "full-page", artifact: "test/reference.png", sha256: "abc123", width: 64, height: 48 }],
      { buildId: "test-build", buildVersionNumber: 1 },
      {
        gateway: (async () => {
          gatewayCalls += 1;
          return { content: "ok", provider: "test", model: "test-model" };
        }) as never,
      }
    );

    const first = await seam("system", "user-1");
    const second = await seam("system", "user-2");

    expect(gatewayCalls).toBe(2);
    expect(r2Reads).toBe(1);
    expect(first.content).toBe("ok");
    expect(second.content).toBe("ok");
  });

  it("a fresh seam instance (new pipeline-step invocation) prepares its own input", async () => {
    const pngBytes = new Uint8Array(buildPng({ width: 64, height: 48 }));
    let r2Reads = 0;
    const seamEnv = {
      ...env,
      SITE_BUCKET: {
        get: async () => {
          r2Reads += 1;
          return { body: new Response(pngBytes).body };
        },
      },
    } as unknown as Env;

    const makeSeam = () =>
      createProductionVisionGenerate(
        seamEnv,
        [{ kind: "full-page", artifact: "test/reference.png", sha256: "abc123", width: 64, height: 48 }],
        { buildId: "test-build", buildVersionNumber: 1 },
        { gateway: (async () => ({ content: "ok", provider: "test", model: "test-model" })) as never }
      );

    await makeSeam()("system", "user");
    await makeSeam()("system", "user");
    expect(r2Reads).toBe(2);
  });
});

describe("resource observability logging (issue #55 §17)", () => {
  it("emits the vision_input_prep timing line once per preparation — no payloads, only sizes", async () => {
    const pngBytes = new Uint8Array(buildPng({ width: 64, height: 48 }));
    const seamEnv = {
      ...env,
      SITE_BUCKET: {
        get: async () => ({ body: new Response(pngBytes).body }),
      },
    } as unknown as Env;
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    try {
      const seam = createProductionVisionGenerate(
        seamEnv,
        [{ kind: "full-page", artifact: "test/reference.png", sha256: "abc123", width: 64, height: 48 }],
        { buildId: "test-build", buildVersionNumber: 1 },
        { gateway: (async () => ({ content: "ok", provider: "test", model: "test-model" })) as never }
      );
      await seam("system", "user-1");
      await seam("system", "user-2");
    } finally {
      console.log = originalLog;
    }
    const prepLines = logs.filter((line) => line.includes("vision_input_prep"));
    expect(prepLines.length).toBe(1);
    expect(prepLines[0]).toContain("prepMs:");
    expect(prepLines[0]).toContain("inputBytes:");
    // No prompt/response payload material in the timing line.
    expect(prepLines[0]).not.toContain("user-1");
  });
});
