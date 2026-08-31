// Real D1 + R2 persistence tests for the reference screenshot state machine.
// Runs under @cloudflare/vitest-pool-workers; the DB and SITE_BUCKET bindings
// are provided by wrangler.test.jsonc and backed by local miniflare D1/R2.
// Migrations must be applied to the local test D1 before running
// (npm run db:migrate:test applies ./migrations to the test database).

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { persistFormScreenshot, promoteStagedScreenshot, getAcceptedScreenshot, ReferenceScreenshotImmutableError } from "../src/lib/reference-persist";
import { putObject, referenceUploadStagingKey, getObject, referenceScreenshotKey } from "../src/lib/assets";
import { computeChecksum, checksumShort } from "../src/lib/reference-input";
import { buildPng } from "./helpers/png";
import { generateId } from "../src/lib/crypto";
import type { Env } from "../src/env.d";

// `providedEnv` is the worker bindings object (DB, SITE_BUCKET) from the
// @cloudflare/vitest-pool-workers runtime, typed via the project's Env.
function getEnv(): Env {
  return providedEnv as unknown as Env;
}

function envWithFailingR2Put(): Env {
  const failing: R2Bucket = {
    async put() { throw new Error("R2 put failed (simulated)"); },
    async get() { return null; },
    async delete() {},
  } as unknown as R2Bucket;
  return { ...getEnv(), SITE_BUCKET: failing } as Env;
}

function envWithFailingD1Insert(): Env {
  const realEnv = getEnv();
  const failingDb = {
    prepare: (sql: string) => {
      const real = realEnv.DB.prepare(sql);
      if (sql.toLowerCase().includes("insert into reference_assets")) {
        return { ...real, async run() { throw new Error("D1 insert failed (simulated)"); } } as D1PreparedStatement;
      }
      return real;
    },
  } as unknown as D1Database;
  return { ...realEnv, DB: failingDb } as Env;
}

describe("reference screenshot persistence (real D1 + R2)", () => {
  const baseParams = () => ({
    jobId: `job-${generateId()}`,
    clientSlug: `client-${generateId().slice(0, 8)}`,
    source: "manual_form",
  });

  function pngFile(data: ArrayBuffer, name = "home.png"): File {
    return new File([data], name, { type: "image/png" });
  }

  it("persists a valid screenshot and records lineage", async () => {
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });
    const persisted = await persistFormScreenshot(env, {
      ...params,
      file: pngFile(png),
    });

    expect(persisted.r2Key).toContain(`/reference/homepage-screenshot/${params.jobId}/`);
    expect(persisted.metadata.width).toBe(1440);

    const accepted = await getAcceptedScreenshot(env.DB, params.jobId, 1);
    expect(accepted).not.toBeNull();
    expect(accepted!.r2_key).toBe(persisted.r2Key);
    expect(accepted!.checksum).toBe(persisted.checksum);

    const r2Object = await getObject(env, persisted.r2Key);
    expect(r2Object).not.toBeNull();
  });

  it("is idempotent: an identical retry returns the existing accepted record", async () => {
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });

    const first = await persistFormScreenshot(env, { ...params, file: pngFile(png) });
    const second = await persistFormScreenshot(env, { ...params, file: pngFile(png) });

    expect(second.r2Key).toBe(first.r2Key);
    expect(second.id).toBe(first.id);
    expect(second.checksum).toBe(first.checksum);

    const all = await env.DB.prepare("SELECT COUNT(*) as c FROM reference_assets WHERE job_id = ?")
      .bind(params.jobId).first<{ c: number }>();
    expect(all!.c).toBe(1);
  });

  it("rejects a retry with different bytes (immutable, REFERENCE_SCREENSHOT_IMMUTABLE)", async () => {
    const env = getEnv();
    const params = baseParams();
    const original = buildPng({ width: 1440, height: 2500 });
    const different = buildPng({ width: 1600, height: 3000 });

    await persistFormScreenshot(env, { ...params, file: pngFile(original) });

    await expect(
      persistFormScreenshot(env, { ...params, file: pngFile(different) })
    ).rejects.toBeInstanceOf(ReferenceScreenshotImmutableError);
  });

  it("R2 failure before D1 leaves no accepted record and staging remains recoverable", async () => {
    const failingEnv = envWithFailingR2Put();
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });
    const stagingKey = referenceUploadStagingKey("upload-r2-fail");
    await putObject(env, stagingKey, png, { httpMetadata: { contentType: "image/png" } });

    await expect(
      promoteStagedScreenshot(failingEnv, { ...params, uploadId: "upload-r2-fail", source: "webhook_upload" })
    ).rejects.toThrow();

    const accepted = await getAcceptedScreenshot(env.DB, params.jobId, 1);
    expect(accepted).toBeNull();

    const stagingStillThere = await getObject(env, stagingKey);
    expect(stagingStillThere).not.toBeNull();
  });

  it("D1 failure after R2 leaves the R2 object written and staging intact (retry-safe)", async () => {
    const failingEnv = envWithFailingD1Insert();
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });
    const stagingKey = referenceUploadStagingKey("upload-d1-fail");
    await putObject(env, stagingKey, png, { httpMetadata: { contentType: "image/png" } });

    await expect(
      promoteStagedScreenshot(failingEnv, { ...params, uploadId: "upload-d1-fail", source: "webhook_upload" })
    ).rejects.toThrow();

    const stagingStillThere = await getObject(env, stagingKey);
    expect(stagingStillThere).not.toBeNull();
    const checksum = await computeChecksum(png);
    const finalKey = referenceScreenshotKey(params.clientSlug, 1, params.jobId, checksumShort(checksum));
    expect(await getObject(env, finalKey)).not.toBeNull();
  });

  it("promotes from staging and cleans up staging only after R2 + D1 acceptance", async () => {
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });
    const stagingKey = referenceUploadStagingKey("upload-ok");
    await putObject(env, stagingKey, png, { httpMetadata: { contentType: "image/png" } });

    const persisted = await promoteStagedScreenshot(env, {
      ...params,
      uploadId: "upload-ok",
      source: "webhook_upload",
    });

    expect(persisted.r2Key).not.toBe(stagingKey);
    const stagingGone = await getObject(env, stagingKey);
    expect(stagingGone).toBeNull();
    const finalPresent = await getObject(env, persisted.r2Key);
    expect(finalPresent).not.toBeNull();
  });

  it("rejects a corrupt/truncated PNG during promotion", async () => {
    const env = getEnv();
    const params = baseParams();
    const truncated = buildPng({ width: 1440, height: 2500, omitIend: true });
    const stagingKey = referenceUploadStagingKey("upload-corrupt");
    await putObject(env, stagingKey, truncated, { httpMetadata: { contentType: "image/png" } });

    await expect(
      promoteStagedScreenshot(env, { ...params, uploadId: "upload-corrupt", source: "webhook_upload" })
    ).rejects.toThrow();
  });

  it("uniqueness is per (job_id, site_version, kind): same bytes for a different job are accepted", async () => {
    const env = getEnv();
    const png = buildPng({ width: 1440, height: 2500 });
    const paramsA = baseParams();
    const paramsB = baseParams();

    const a = await persistFormScreenshot(env, { ...paramsA, file: pngFile(png) });
    const b = await persistFormScreenshot(env, { ...paramsB, file: pngFile(png) });

    expect(a.checksum).toBe(b.checksum);
    expect(a.r2Key).not.toBe(b.r2Key);
    expect(a.id).not.toBe(b.id);
  });

  it("allows immutable evidence for a later site version of the same job", async () => {
    const env = getEnv();
    const params = baseParams();
    const first = await persistFormScreenshot(env, {
      ...params,
      siteVersion: 1,
      file: pngFile(buildPng({ width: 1440, height: 2500 })),
    });
    const second = await persistFormScreenshot(env, {
      ...params,
      siteVersion: 2,
      file: pngFile(buildPng({ width: 1600, height: 3000 })),
    });

    expect(first.id).not.toBe(second.id);
    expect(first.r2Key).toContain("/versions/v1/");
    expect(second.r2Key).toContain("/versions/v2/");
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM reference_assets WHERE job_id = ?")
      .bind(params.jobId).first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it("resolves concurrent identical attempts to one accepted record", async () => {
    const env = getEnv();
    const params = baseParams();
    const png = buildPng({ width: 1440, height: 2500 });

    const [first, second] = await Promise.all([
      persistFormScreenshot(env, { ...params, file: pngFile(png) }),
      persistFormScreenshot(env, { ...params, file: pngFile(png) }),
    ]);

    expect(first.id).toBe(second.id);
    expect(first.r2Key).toBe(second.r2Key);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM reference_assets WHERE job_id = ?")
      .bind(params.jobId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("accepts one concurrent attempt and rejects different competing bytes", async () => {
    const env = getEnv();
    const params = baseParams();
    const results = await Promise.allSettled([
      persistFormScreenshot(env, { ...params, file: pngFile(buildPng({ width: 1440, height: 2500 })) }),
      persistFormScreenshot(env, { ...params, file: pngFile(buildPng({ width: 1600, height: 3000 })) }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ReferenceScreenshotImmutableError);
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM reference_assets WHERE job_id = ?")
      .bind(params.jobId).first<{ count: number }>();
    expect(count?.count).toBe(1);
  });
});
