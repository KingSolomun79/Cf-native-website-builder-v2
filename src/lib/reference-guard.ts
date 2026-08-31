import type { Env } from "../env.d";
import { getReferenceAsset } from "./db";

export type ReferenceGuardCode =
  | "MISSING_REFERENCE_URL"
  | "MISSING_REFERENCE_SCREENSHOT"
  | "REFERENCE_SCREENSHOT_NOT_PERSISTED"
  | "REFERENCE_SCREENSHOT_LINEAGE_MISMATCH";

export class ReferenceGuardError extends Error {
  constructor(readonly code: ReferenceGuardCode, message: string) {
    super(message);
    this.name = "ReferenceGuardError";
  }
}

export async function assertPersistedReferences(
  env: Env,
  params: {
    jobId: string;
    siteVersion: number;
    referenceSiteUrl: string | null;
    referenceScreenshotR2Key: string | null;
  }
): Promise<void> {
  if (!params.referenceSiteUrl) {
    throw new ReferenceGuardError("MISSING_REFERENCE_URL", "Reference site URL is required before generation can start.");
  }
  if (!params.referenceScreenshotR2Key) {
    throw new ReferenceGuardError("MISSING_REFERENCE_SCREENSHOT", "Reference homepage screenshot is required before generation can start.");
  }

  const accepted = await getReferenceAsset(env.DB, params.jobId, params.siteVersion, "homepage_screenshot");
  if (!accepted) {
    throw new ReferenceGuardError("REFERENCE_SCREENSHOT_NOT_PERSISTED", "No accepted reference screenshot lineage row exists for this job.");
  }
  if (accepted.r2_key !== params.referenceScreenshotR2Key) {
    throw new ReferenceGuardError(
      "REFERENCE_SCREENSHOT_LINEAGE_MISMATCH",
      `Intake screenshot key ${params.referenceScreenshotR2Key} does not match accepted lineage key ${accepted.r2_key}.`
    );
  }
  if (!(await env.SITE_BUCKET.head(accepted.r2_key))) {
    throw new ReferenceGuardError(
      "REFERENCE_SCREENSHOT_NOT_PERSISTED",
      `Reference screenshot object was not found in R2 at ${accepted.r2_key}.`
    );
  }
}
