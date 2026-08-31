import type { Env } from "../env.d";
import {
  getReferenceAsset,
  createReferenceAsset,
} from "./db";
import {
  putObject,
  getObjectWithMetadata,
  deleteObject,
  referenceScreenshotKey,
  referenceUploadStagingKey,
} from "./assets";
import {
  validateScreenshot,
  computeChecksum,
  checksumShort,
  type ScreenshotMetadata,
} from "./reference-input";
import { generateId, nowIso } from "./crypto";
import type { ReferenceAssetRow } from "../types";

export const REFERENCE_SCREENSHOT_KIND = "homepage_screenshot";
export const REFERENCE_SCREENSHOT_IMMUTABLE = "REFERENCE_SCREENSHOT_IMMUTABLE";

export class ReferenceScreenshotImmutableError extends Error {
  readonly code = REFERENCE_SCREENSHOT_IMMUTABLE;
  constructor(message = "An accepted reference screenshot already exists and cannot be replaced.") {
    super(message);
    this.name = "ReferenceScreenshotImmutableError";
  }
}

export interface PersistedScreenshot {
  r2Key: string;
  metadata: ScreenshotMetadata;
  checksum: string;
  id: string;
}

export interface PersistParams {
  jobId: string;
  clientSlug: string;
  siteVersion?: number;
  source: string;
  uploadId?: string | null;
}

const DEFAULT_SITE_VERSION = 1;

export async function getAcceptedScreenshot(
  db: D1Database,
  jobId: string,
  siteVersion: number = DEFAULT_SITE_VERSION,
  kind: string = REFERENCE_SCREENSHOT_KIND
): Promise<ReferenceAssetRow | null> {
  return getReferenceAsset(db, jobId, siteVersion, kind);
}

function toPersisted(row: ReferenceAssetRow): PersistedScreenshot {
  return {
    id: row.id,
    r2Key: row.r2_key,
    checksum: row.checksum,
    metadata: {
      width: row.width,
      height: row.height,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
    },
  };
}

interface PersistBytesInput {
  data: ArrayBuffer;
  metadata: ScreenshotMetadata;
  originalFilename: string | null;
}

async function persistAcceptedBytes(
  env: Env,
  params: PersistParams,
  input: PersistBytesInput
): Promise<PersistedScreenshot> {
  const siteVersion = params.siteVersion ?? DEFAULT_SITE_VERSION;
  const checksum = await computeChecksum(input.data);

  const accepted = await getAcceptedScreenshot(env.DB, params.jobId, siteVersion);
  if (accepted) {
    if (accepted.checksum === checksum) {
      return toPersisted(accepted);
    }
    throw new ReferenceScreenshotImmutableError(
      `An accepted reference screenshot already exists for job ${params.jobId} (v${siteVersion}) and cannot be replaced with different content.`
    );
  }

  const immutableKey = referenceScreenshotKey(
    params.clientSlug,
    siteVersion,
    params.jobId,
    checksumShort(checksum)
  );
  await putObject(env, immutableKey, input.data, {
    httpMetadata: { contentType: input.metadata.mimeType },
  });

  const id = generateId();
  try {
    await createReferenceAsset(env.DB, {
      id,
      job_id: params.jobId,
      client_slug: params.clientSlug,
      site_version: siteVersion,
      kind: REFERENCE_SCREENSHOT_KIND,
      r2_key: immutableKey,
      original_filename: input.originalFilename,
      mime_type: input.metadata.mimeType,
      width: input.metadata.width,
      height: input.metadata.height,
      byte_size: input.metadata.byteSize,
      checksum,
      source: params.source,
      upload_id: params.uploadId ?? null,
      capture_timestamp: nowIso(),
      created_at: nowIso(),
    });
  } catch (err) {
    const winner = await getAcceptedScreenshot(env.DB, params.jobId, siteVersion);
    if (winner) {
      if (winner.checksum === checksum) {
        return toPersisted(winner);
      }
      throw new ReferenceScreenshotImmutableError(
        `A concurrent submission accepted a different reference screenshot for job ${params.jobId} (v${siteVersion}).`
      );
    }
    throw err;
  }

  const confirmed = await getAcceptedScreenshot(env.DB, params.jobId, siteVersion);
  if (!confirmed || confirmed.r2_key !== immutableKey) {
    throw new Error(
      `Reference screenshot lineage could not be confirmed for job ${params.jobId} (v${siteVersion}).`
    );
  }

  return toPersisted(confirmed);
}

export async function promoteStagedScreenshot(
  env: Env,
  params: { jobId: string; clientSlug: string; uploadId: string; source: string; siteVersion?: number }
): Promise<PersistedScreenshot> {
  const { jobId, clientSlug, uploadId, source, siteVersion } = params;
  const stagingKey = referenceUploadStagingKey(uploadId);

  const staged = await getObjectWithMetadata(env, stagingKey);
  if (!staged || !staged.body) {
    throw new Error(`Reference screenshot upload '${uploadId}' was not found. It may have expired or already been consumed.`);
  }

  const data = await new Response(staged.body).arrayBuffer();
  const originalFilename = staged.customMetadata?.["original-filename"] ?? null;

  const result = validateScreenshot({
    data,
    byteSize: data.byteLength,
    mimeType: staged.httpMetadata?.contentType ?? "image/png",
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

  const persisted = await persistAcceptedBytes(env, { jobId, clientSlug, siteVersion, source, uploadId }, {
    data,
    metadata: result.metadata,
    originalFilename,
  });

  await deleteObject(env, stagingKey);

  return persisted;
}

export async function persistFormScreenshot(
  env: Env,
  params: { jobId: string; clientSlug: string; file: File; source: string; siteVersion?: number }
): Promise<PersistedScreenshot> {
  const { jobId, clientSlug, file, source, siteVersion } = params;
  const data = await file.arrayBuffer();

  const result = validateScreenshot({
    data,
    byteSize: file.size,
    mimeType: file.type,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }

  return persistAcceptedBytes(env, { jobId, clientSlug, siteVersion, source }, {
    data,
    metadata: result.metadata,
    originalFilename: file.name || null,
  });
}
