import { describe, expect, it } from "vitest";
import type { Env } from "../src/env.d";
import { prepareVisionInput, VisionInputPreparationError } from "../src/lib/vision-input";
import { buildPng } from "./helpers/png";

function makeEnv(overrides: Partial<Env> = {}) {
  const objects = new Map<string, { data: ArrayBuffer; contentType?: string }>();
  let imageCalls = 0;
  const bucket = {
    async get(key: string) {
      const object = objects.get(key);
      return object ? { body: new Response(object.data).body!, httpMetadata: { contentType: object.contentType } } : null;
    },
    async put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: R2PutOptions) {
      const data = value instanceof ArrayBuffer ? value : typeof value === "string" ? new TextEncoder().encode(value).buffer : ArrayBuffer.isView(value) ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : await new Response(value).arrayBuffer();
      if (options?.onlyIf && objects.has(key)) return null;
      objects.set(key, { data, contentType: options?.httpMetadata?.contentType });
      return { key } as R2Object;
    },
    async head(key: string) {
      return objects.has(key) ? { key } as R2Object : null;
    },
  } as unknown as R2Bucket;
  const images = {
    input() {
      imageCalls++;
      return {
        transform() { return this; },
        async output() { return { response: () => new Response(buildPng({ width: 1000, height: 2000 })) }; },
      };
    },
  } as unknown as ImagesBinding;
  const env = { SITE_BUCKET: bucket, IMAGES: images, ...overrides } as Env;
  return { env, objects, imageCalls: () => imageCalls };
}

describe("vision input preparation", () => {
  it("uses a normal canonical screenshot without creating a derivative", async () => {
    const { env, objects, imageCalls } = makeEnv();
    const key = "client/versions/v1/reference/homepage-screenshot/job/source.png";
    const source = buildPng({ width: 1440, height: 2500 });
    objects.set(key, { data: source, contentType: "image/png" });

    const result = await prepareVisionInput(env, { clientSlug: "client", siteVersion: 1, jobId: "job", screenshotR2Key: key });

    expect(result.artifact).toMatchObject({ r2Key: key, sourceR2Key: key, derived: false, width: 1440, height: 2500 });
    expect(result.data).toEqual(source);
    expect(imageCalls()).toBe(0);
  });

  it("creates an immutable webp derivative for an over-budget screenshot and retains original provenance", async () => {
    const { env, objects, imageCalls } = makeEnv({ VISION_INPUT_MAX_WIDTH: "1200" });
    const key = "client/versions/v1/reference/homepage-screenshot/job/source.png";
    const source = buildPng({ width: 1440, height: 2500 });
    objects.set(key, { data: source, contentType: "image/png" });

    const result = await prepareVisionInput(env, { clientSlug: "client", siteVersion: 1, jobId: "job", screenshotR2Key: key });

    expect(result.artifact).toMatchObject({ sourceR2Key: key, mimeType: "image/webp", derived: true });
    expect(result.artifact.r2Key).toContain("/reference/vision-inputs/job/");
    expect(result.artifact.r2Key).not.toBe(key);
    expect(result.artifact.transform?.width).toBe(1200);
    expect(objects.has(key)).toBe(true);
    expect(objects.has(result.artifact.r2Key)).toBe(true);
    expect(imageCalls()).toBe(1);
  });

  it("fails closed for corrupt canonical screenshot evidence", async () => {
    const { env, objects, imageCalls } = makeEnv();
    const key = "client/versions/v1/reference/homepage-screenshot/job/source.png";
    objects.set(key, { data: buildPng({ width: 1440, height: 2500, corruptIhdrCrc: true }), contentType: "image/png" });

    await expect(prepareVisionInput(env, { clientSlug: "client", siteVersion: 1, jobId: "job", screenshotR2Key: key }))
      .rejects.toMatchObject<VisionInputPreparationError>({ code: "VISION_INPUT_CORRUPT" });
    expect(imageCalls()).toBe(0);
  });

  it("fails closed for an unsupported screenshot MIME", async () => {
    const { env, objects, imageCalls } = makeEnv();
    const key = "client/versions/v1/reference/homepage-screenshot/job/source.png";
    objects.set(key, { data: buildPng({ width: 1440, height: 2500 }), contentType: "image/jpeg" });

    await expect(prepareVisionInput(env, { clientSlug: "client", siteVersion: 1, jobId: "job", screenshotR2Key: key }))
      .rejects.toMatchObject<VisionInputPreparationError>({ code: "VISION_INPUT_UNSUPPORTED" });
    expect(imageCalls()).toBe(0);
  });
});
