// Phase 16.R3: shared evidence-attempt coordinator.
//
// One evidenceAttemptId per capture+interaction run. Coordinates the lifecycle:
//   1. startEvidenceAttempt  (append-only row, status in_progress)
//   2. capture responsive evidence
//   3. exercise interactions
//   4. persist both manifests under the attempt prefix
//   5. promoteEvidenceAttempt — single tx: mark complete + flip current pointer
//   6. blueprint generation resolves the current pointer
//
// Incomplete or persistence-failed attempts remain auditable (rows + R2 retained)
// but NEVER become the current usable attempt — they never replace accepted
// evidence. Reuse of #17's immutable attempt convention.

import type { Env } from "../env.d";
import {
  failEvidenceAttempt,
  promoteEvidenceAttempt,
  startEvidenceAttempt,
} from "./db";
import { generateId, nowIso } from "./crypto";
import {
  captureInteractionEvidence,
} from "./interaction-capture-v2";
import {
  captureResponsiveEvidence,
} from "./reference-capture-v2";
import { playwrightAdapter } from "./browser-adapter";
import type { BrowserAdapter } from "./browser-adapter";
import type { InteractionFallbackContext } from "./interaction-capture-v2";

export interface RunEvidenceParams {
  jobId: string;
  clientSlug: string;
  siteVersion: number;
  referenceUrl: string;
  adapter?: BrowserAdapter;
  fallbackContext?: InteractionFallbackContext;
}

export interface RunEvidenceResult {
  attemptId: string;
  promoted: boolean;
  captureManifestR2Key: string;
  interactionManifestR2Key: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface CapturedEvidenceAttempt {
  attemptId: string;
  captureManifestR2Key: string;
  captureUsable: boolean;
  failureCode: string | null;
  failureMessage: string | null;
}

// Run a full capture + interaction evidence attempt and, only on full success,
// promote it to current. Best-effort: a failure returns a failed attempt id but
// never throws out of the workflow step (the caller decides whether to continue).
export async function captureEvidenceAttempt(env: Env, params: RunEvidenceParams): Promise<CapturedEvidenceAttempt> {
  const attemptId = generateId();
  const adapter = params.adapter ?? playwrightAdapter;

  await startEvidenceAttempt(env.DB, {
    id: attemptId,
    job_id: params.jobId,
    client_slug: params.clientSlug,
    site_version: params.siteVersion,
    started_at: nowIso(),
  });

  try {
    const capture = await captureResponsiveEvidence(env, {
      jobId: params.jobId,
      clientSlug: params.clientSlug,
      siteVersion: params.siteVersion,
      attemptId,
      referenceUrl: params.referenceUrl,
      adapter,
    });
    return {
      attemptId,
      captureManifestR2Key: capture.manifestR2Key,
      captureUsable: capture.manifest.overallStatus !== "failed",
      failureCode: null,
      failureMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      attemptId,
      captureManifestR2Key: "",
      captureUsable: false,
      failureCode: classifyCoordinatorFailure(err),
      failureMessage: message,
    };
  }
}

export async function completeEvidenceAttempt(
  env: Env,
  params: RunEvidenceParams,
  captureAttempt: CapturedEvidenceAttempt
): Promise<RunEvidenceResult> {
  const adapter = params.adapter ?? playwrightAdapter;
  let interactionManifestR2Key = "";
  if (!captureAttempt.captureManifestR2Key) {
    const failure = {
      code: captureAttempt.failureCode ?? "EVIDENCE_ATTEMPT_FAILED",
      message: captureAttempt.failureMessage ?? "Reference capture could not be persisted.",
    };
    await failEvidenceAttempt(env.DB, captureAttempt.attemptId, failure, nowIso()).catch(() => {});
    return {
      attemptId: captureAttempt.attemptId,
      promoted: false,
      captureManifestR2Key: "",
      interactionManifestR2Key,
      failureCode: failure.code,
      failureMessage: failure.message,
    };
  }
  try {
    const interaction = await captureInteractionEvidence(env, {
      jobId: params.jobId,
      clientSlug: params.clientSlug,
      siteVersion: params.siteVersion,
      attemptId: captureAttempt.attemptId,
      referenceUrl: params.referenceUrl,
      adapter,
      fallbackContext: params.fallbackContext,
    });
    interactionManifestR2Key = interaction.manifestR2Key;

    const interactionUsable = interaction.manifest.overallStatus !== "failed";
    if (!captureAttempt.captureUsable && !interactionUsable) {
      const failure = { code: "EVIDENCE_ALL_FAILED", message: `All capture + interaction evidence failed for ${params.referenceUrl}.` };
      await failEvidenceAttempt(env.DB, captureAttempt.attemptId, failure, nowIso()).catch(() => {});
      return {
        attemptId: captureAttempt.attemptId,
        promoted: false,
        captureManifestR2Key: captureAttempt.captureManifestR2Key,
        interactionManifestR2Key,
        failureCode: failure.code,
        failureMessage: failure.message,
      };
    }

    await promoteEvidenceAttempt(env.DB, captureAttempt.attemptId, nowIso());

    return {
      attemptId: captureAttempt.attemptId,
      promoted: true,
      captureManifestR2Key: captureAttempt.captureManifestR2Key,
      interactionManifestR2Key,
      failureCode: null,
      failureMessage: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = classifyCoordinatorFailure(err);
    await failEvidenceAttempt(env.DB, captureAttempt.attemptId, { code, message }, nowIso()).catch(() => {});
    return {
      attemptId: captureAttempt.attemptId,
      promoted: false,
      captureManifestR2Key: captureAttempt.captureManifestR2Key,
      interactionManifestR2Key,
      failureCode: code,
      failureMessage: message,
    };
  }
}

export async function runEvidenceAttempt(env: Env, params: RunEvidenceParams): Promise<RunEvidenceResult> {
  const captureAttempt = await captureEvidenceAttempt(env, params);
  return completeEvidenceAttempt(env, params, captureAttempt);
}

function classifyCoordinatorFailure(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/dns|enotfound|getaddrinfo/i.test(msg)) return "DNS_FAILURE";
  if (/timeout|timed out/i.test(msg)) return "NAVIGATION_TIMEOUT";
  if (/browser|launch|unavailable/i.test(msg)) return "BROWSER_UNAVAILABLE";
  if (/network|econnrefused|econnreset/i.test(msg)) return "NETWORK_ERROR";
  return "EVIDENCE_ATTEMPT_FAILED";
}
