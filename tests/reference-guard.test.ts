import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { assertPersistedReferences } from "../src/lib/reference-guard";
import { createReferenceAsset } from "../src/lib/db";
import { generateId, nowIso } from "../src/lib/crypto";
import { putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

function env(): Env {
  return providedEnv as unknown as Env;
}

async function insertLineage(jobId: string, r2Key: string): Promise<void> {
  const now = nowIso();
  await createReferenceAsset(env().DB, {
    id: generateId(),
    job_id: jobId,
    client_slug: "guard-client",
    site_version: 1,
    kind: "homepage_screenshot",
    r2_key: r2Key,
    original_filename: "homepage.png",
    mime_type: "image/png",
    width: 1440,
    height: 2500,
    byte_size: 57,
    checksum: generateId().replaceAll("-", ""),
    source: "test",
    upload_id: null,
    capture_timestamp: now,
    created_at: now,
  });
}

describe("Workflow reference guard", () => {
  it("rejects a missing canonical URL with a distinct code", async () => {
    await expect(assertPersistedReferences(env(), {
      jobId: generateId(),
      siteVersion: 1,
      referenceSiteUrl: null,
      referenceScreenshotR2Key: "key",
    })).rejects.toMatchObject({ code: "MISSING_REFERENCE_URL" });
  });

  it("rejects a missing screenshot key with a distinct code", async () => {
    await expect(assertPersistedReferences(env(), {
      jobId: generateId(),
      siteVersion: 1,
      referenceSiteUrl: "https://example.com/",
      referenceScreenshotR2Key: null,
    })).rejects.toMatchObject({ code: "MISSING_REFERENCE_SCREENSHOT" });
  });

  it("rejects a missing D1 lineage row with a distinct code", async () => {
    await expect(assertPersistedReferences(env(), {
      jobId: generateId(),
      siteVersion: 1,
      referenceSiteUrl: "https://example.com/",
      referenceScreenshotR2Key: "missing-key",
    })).rejects.toMatchObject({ code: "REFERENCE_SCREENSHOT_NOT_PERSISTED" });
  });

  it("rejects a missing R2 object with a distinct code", async () => {
    const jobId = generateId();
    const r2Key = `guard/${jobId}.png`;
    await insertLineage(jobId, r2Key);
    await expect(assertPersistedReferences(env(), {
      jobId,
      siteVersion: 1,
      referenceSiteUrl: "https://example.com/",
      referenceScreenshotR2Key: r2Key,
    })).rejects.toMatchObject({ code: "REFERENCE_SCREENSHOT_NOT_PERSISTED" });
  });

  it("rejects a lineage mismatch with a distinct code", async () => {
    const jobId = generateId();
    await insertLineage(jobId, `guard/${jobId}.png`);
    await expect(assertPersistedReferences(env(), {
      jobId,
      siteVersion: 1,
      referenceSiteUrl: "https://example.com/",
      referenceScreenshotR2Key: `guard/${jobId}-other.png`,
    })).rejects.toMatchObject({ code: "REFERENCE_SCREENSHOT_LINEAGE_MISMATCH" });
  });

  it("accepts matching D1 lineage and R2 evidence", async () => {
    const jobId = generateId();
    const r2Key = `guard/${jobId}.png`;
    await insertLineage(jobId, r2Key);
    await putObject(env(), r2Key, buildPng());
    await expect(assertPersistedReferences(env(), {
      jobId,
      siteVersion: 1,
      referenceSiteUrl: "https://example.com/",
      referenceScreenshotR2Key: r2Key,
    })).resolves.toBeUndefined();
  });
});
