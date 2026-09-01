// V2 Approval, Publication and Rollback (issue #15, PRD sections 32-33).
//
//   Release Ready (exact Build Version)
//     -> Approval: explicit human acceptance of THAT version, pinned to its
//        artifact manifest hash. Approval never makes the Site live and
//        never carries to another version.
//     -> Publication: separate operational act deploying the exact approved
//        version without regeneration. Operational failure may be retried
//        under the same Approval while the version (manifest hash) is
//        unchanged.
//     -> Published Version: at most one current per Site. Publishing a newer
//        version retains the immediately previous Published Version as
//        Rollback Version for the configured window.
//     -> Rollback: restores that exact prior version with no new Build, no
//        new Build Version, no new Approval, no regeneration; publication
//        history is preserved and mutable Site Configuration is untouched.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { getObject } from "../lib/assets";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getBuildStageArtifact } from "./stage-artifacts";
import { buildVersionSourceKey } from "./artifact-keys";

export type PublicationErrorCode =
  | "BUILD_NOT_FOUND"
  | "NOT_RELEASE_READY"
  | "NOT_APPROVED"
  | "ALREADY_APPROVED"
  | "APPROVAL_HASH_MISMATCH"
  | "PUBLISH_FAILED"
  | "NO_ROLLBACK_VERSION"
  | "ROLLBACK_WINDOW_EXPIRED";

export class PublicationError extends Error {
  readonly code: PublicationErrorCode;

  constructor(code: PublicationErrorCode, message: string) {
    super(message);
    this.name = "PublicationError";
    this.code = code;
  }
}

export function rollbackWindowDays(env: Env): number {
  const raw = Number(env.ROLLBACK_WINDOW_DAYS ?? "7");
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

// ── Approval ────────────────────────────────────────────────────────────────

export interface BuildApprovalResult {
  approvalId: string;
  buildVersionId: string;
  artifactManifestHash: string;
  approvedAt: string;
}

interface AssembledManifestValue {
  artifactManifestHash: string;
  files?: Array<{ path: string }>;
}

async function loadAssembledManifest(
  env: Env,
  buildId: string,
  buildVersionId: string
): Promise<AssembledManifestValue> {
  const artifact = await getBuildStageArtifact<AssembledManifestValue>(env, buildVersionId, "assembled_manifest");
  if (!artifact) {
    throw new PublicationError(
      "NOT_RELEASE_READY",
      `Build Version ${buildVersionId} has no assembled artifact manifest`
    );
  }
  return artifact.value;
}

export async function approveBuildVersion(
  env: Env,
  input: { buildId: string; buildVersionId: string; approvedBy?: string; approvalNote?: string }
): Promise<BuildApprovalResult> {
  // Approval is granted only to one exact Release Ready Build Version.
  const release = await env.DB.prepare(
    "SELECT build_version_id FROM build_release_records WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .first<{ build_version_id: string }>();
  if (!release) {
    throw new PublicationError(
      "NOT_RELEASE_READY",
      `Build Version ${input.buildVersionId} is not Release Ready; Approval requires every mandatory gate to have passed for this exact version`
    );
  }

  const manifest = await loadAssembledManifest(env, input.buildId, input.buildVersionId);
  const approvalId = generateId();
  const approvedAt = nowIso();

  try {
    await env.DB.prepare(
      `INSERT INTO build_approvals (id, build_id, build_version_id, artifact_manifest_hash, approved_by, approval_note, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(approvalId, input.buildId, input.buildVersionId, manifest.artifactManifestHash, input.approvedBy ?? null, input.approvalNote ?? null, approvedAt)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: build_approvals")) {
      throw new PublicationError("ALREADY_APPROVED", `Build Version ${input.buildVersionId} is already approved`);
    }
    throw error;
  }

  // Approval authorizes publication; it does NOT itself make the Site live.
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "RELEASE_READY",
    toState: "APPROVED",
    stage: "approval",
    detail: `Human Approval recorded for exact Build Version (manifest ${manifest.artifactManifestHash.slice(0, 12)}); publication remains a separate act`,
  });

  return { approvalId, buildVersionId: input.buildVersionId, artifactManifestHash: manifest.artifactManifestHash, approvedAt };
}

// ── Publication ─────────────────────────────────────────────────────────────

export interface PublicationDeployer {
  (input: { workerName: string; files: Map<string, Uint8Array> }): Promise<{ publishedUrl: string }>;
}

export interface PublishInput {
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  deployer?: PublicationDeployer;
}

export interface PublicationResult {
  publicationId: string;
  attempt: number;
  publishedUrl: string;
  workerName: string;
  artifactManifestHash: string;
  alreadyPublished: boolean;
}

async function loadExactCandidateFiles(
  env: Env,
  buildId: string,
  buildVersionNumber: number,
  manifest: AssembledManifestValue
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.files ?? []) {
    const body = await getObject(env, buildVersionSourceKey(buildId, buildVersionNumber, entry.path));
    if (!body) {
      throw new PublicationError(
        "PUBLISH_FAILED",
        `Assembled candidate file '${entry.path}' is missing from immutable storage; refusing to publish anything else`
      );
    }
    files.set(entry.path, new Uint8Array(await new Response(body).arrayBuffer()));
  }
  return files;
}

export async function publishApprovedBuildVersion(
  env: Env,
  input: PublishInput
): Promise<PublicationResult> {
  // Publication requires an Approval bound to THIS exact version.
  const approval = await env.DB.prepare("SELECT * FROM build_approvals WHERE build_version_id = ?")
    .bind(input.buildVersionId)
    .first<{ id: string; artifact_manifest_hash: string }>();
  if (!approval) {
    throw new PublicationError(
      "NOT_APPROVED",
      `Build Version ${input.buildVersionId} has no Approval; a different version's Approval never carries over`
    );
  }

  // Approval drift guard: the version's current manifest must still hash to
  // what was approved.
  const manifest = await loadAssembledManifest(env, input.buildId, input.buildVersionId);
  if (manifest.artifactManifestHash !== approval.artifact_manifest_hash) {
    throw new PublicationError(
      "APPROVAL_HASH_MISMATCH",
      "The Build Version's artifact manifest no longer matches the approved manifest hash; fresh Release Ready + Approval are required"
    );
  }

  // Idempotent success: the exact approved version is already the CURRENT
  // Published Version. A historical 'published' row alone (e.g. the version
  // was rolled back) does not short-circuit — re-publishing it is a new
  // attempt that makes it current again.
  const existing = await env.DB.prepare(
    "SELECT * FROM publications WHERE build_version_id = ? AND status = 'published' ORDER BY attempt DESC LIMIT 1"
  )
    .bind(input.buildVersionId)
    .first<{ id: string; worker_name: string; published_url: string; artifact_manifest_hash: string; attempt: number }>();
  if (existing) {
    const currentState = await env.DB.prepare(
      "SELECT current_build_version_id FROM site_published_state WHERE site_id = ?"
    )
      .bind(input.siteId)
      .first<{ current_build_version_id: string }>();
    if (currentState?.current_build_version_id === input.buildVersionId) {
      return {
        publicationId: existing.id,
        attempt: existing.attempt,
        publishedUrl: existing.published_url,
        workerName: existing.worker_name,
        artifactManifestHash: existing.artifact_manifest_hash,
        alreadyPublished: true,
      };
    }
  }

  const priorAttempts = await env.DB.prepare(
    "SELECT COALESCE(MAX(attempt), 0) AS n FROM publications WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .first<{ n: number }>();
  const attempt = (priorAttempts?.n ?? 0) + 1;
  const publicationId = generateId();
  const workerName = `pub-${input.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v${input.buildVersionNumber}`;
  const createdAt = nowIso();

  const deployer: PublicationDeployer =
    input.deployer ??
    (async ({ workerName: name, files }) => {
      // Production default: the assets-only deploy path — the exact approved
      // candidate bytes, no regeneration, no scripts, no secret bindings.
      const { uploadAssets, createStaticAssetsWorker, getWorkerPreviewUrl } = await import("../lib/publish");
      const upload = new Map<string, string | ArrayBuffer>();
      for (const [path, bytes] of files) upload.set(path, bytes.slice().buffer);
      const uploadJwt = await uploadAssets(env, name, upload);
      await createStaticAssetsWorker(env, name, uploadJwt);
      return { publishedUrl: await getWorkerPreviewUrl(env, name) };
    });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "APPROVED",
    toState: "PUBLISHING",
    stage: "publishing",
    detail: `Publication attempt ${attempt} for the exact approved Build Version (manifest ${manifest.artifactManifestHash.slice(0, 12)}), no regeneration`,
  });

  // Operational failure is retriable under the SAME approval: record the
  // failed attempt, do not touch site state.
  const files = await loadExactCandidateFiles(env, input.buildId, input.buildVersionNumber, manifest);
  let deployed: { publishedUrl: string };
  try {
    deployed = await deployer({ workerName, files });
  } catch (error) {
    await env.DB.prepare(
      `INSERT INTO publications (id, site_id, build_id, build_version_id, artifact_manifest_hash, worker_name, published_url, status, attempt, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, '', 'failed', ?, ?, ?)`
    )
      .bind(publicationId, input.siteId, input.buildId, input.buildVersionId, manifest.artifactManifestHash, workerName, attempt, (error as Error).message.slice(0, 500), createdAt)
      .run();
    throw new PublicationError("PUBLISH_FAILED", `Publication failed operationally (attempt ${attempt}): ${(error as Error).message}`);
  }

  const completedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO publications (id, site_id, build_id, build_version_id, artifact_manifest_hash, worker_name, published_url, status, attempt, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`
  )
    .bind(publicationId, input.siteId, input.buildId, input.buildVersionId, manifest.artifactManifestHash, workerName, deployed.publishedUrl, attempt, createdAt, completedAt)
    .run();

  // Deployment record for the published role (issue #12 schema).
  await env.DB.prepare(
    `INSERT INTO build_deployments (id, build_id, build_version_id, role, worker_name, preview_url, artifact_manifest_hash, status, created_at, updated_at)
     VALUES (?, ?, ?, 'published', ?, ?, ?, 'active', ?, ?)
     ON CONFLICT (build_version_id, role) DO UPDATE SET
       status = 'active', worker_name = excluded.worker_name,
       preview_url = excluded.preview_url, artifact_manifest_hash = excluded.artifact_manifest_hash,
       updated_at = excluded.updated_at`
  )
    .bind(generateId(), input.buildId, input.buildVersionId, workerName, deployed.publishedUrl, manifest.artifactManifestHash, completedAt, completedAt)
    .run();

  // Retain the immediately previous Published Version as Rollback Version
  // for the configured window; the new version becomes the only current.
  const previous = await env.DB.prepare("SELECT * FROM site_published_state WHERE site_id = ?")
    .bind(input.siteId)
    .first<{ current_publication_id: string; current_build_version_id: string }>();
  const rollbackExpiresAt = new Date(Date.now() + rollbackWindowDays(env) * 24 * 60 * 60_000).toISOString();

  if (previous) {
    // Superseded published deployments no longer hold the active role.
    await env.DB.prepare(
      "UPDATE build_deployments SET status = 'superseded', updated_at = ? WHERE build_version_id = ? AND role = 'published' AND status = 'active'"
    )
      .bind(completedAt, previous.current_build_version_id)
      .run();
    await env.DB.prepare(
      `UPDATE site_published_state SET
         current_publication_id = ?, current_build_version_id = ?,
         rollback_publication_id = ?, rollback_build_version_id = ?, rollback_expires_at = ?,
         updated_at = ?
       WHERE site_id = ?`
    )
      .bind(publicationId, input.buildVersionId, previous.current_publication_id, previous.current_build_version_id, rollbackExpiresAt, completedAt, input.siteId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO site_published_state (site_id, current_publication_id, current_build_version_id, rollback_publication_id, rollback_build_version_id, rollback_expires_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?)`
    )
      .bind(input.siteId, publicationId, input.buildVersionId, completedAt)
      .run();
  }

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "PUBLISHING",
    toState: "PUBLISHED",
    stage: "publication",
    detail: `Published Version live at ${deployed.publishedUrl}${previous ? `; previous Published Version retained as Rollback Version for ${rollbackWindowDays(env)} day(s)` : ""}`,
  });

  return {
    publicationId,
    attempt,
    publishedUrl: deployed.publishedUrl,
    workerName,
    artifactManifestHash: manifest.artifactManifestHash,
    alreadyPublished: false,
  };
}

// ── Rollback ────────────────────────────────────────────────────────────────

export interface RollbackResult {
  restoredBuildVersionId: string;
  restoredPublicationId: string;
  restoredUrl: string;
}

export async function rollbackPublication(
  env: Env,
  input: { siteId: string; now?: Date; expectedCurrentBuildVersionId?: string }
): Promise<RollbackResult> {
  const state = await env.DB.prepare("SELECT * FROM site_published_state WHERE site_id = ?")
    .bind(input.siteId)
    .first<{
      current_publication_id: string;
      current_build_version_id: string;
      rollback_publication_id: string | null;
      rollback_build_version_id: string | null;
      rollback_expires_at: string | null;
    }>();
  if (!state || !state.rollback_publication_id || !state.rollback_build_version_id) {
    throw new PublicationError("NO_ROLLBACK_VERSION", `Site ${input.siteId} has no retained Rollback Version`);
  }
  const now = (input.now ?? new Date()).toISOString();
  if (state.rollback_expires_at && state.rollback_expires_at < now) {
    throw new PublicationError(
      "ROLLBACK_WINDOW_EXPIRED",
      `Rollback window expired at ${state.rollback_expires_at}; a corrected replacement must follow the normal Release Ready -> Approval -> Publication flow`
    );
  }

  const restored = await env.DB.prepare("SELECT * FROM publications WHERE id = ?")
    .bind(state.rollback_publication_id)
    .first<{ id: string; build_id: string; build_version_id: string; published_url: string }>();
  if (!restored) {
    throw new PublicationError("NO_ROLLBACK_VERSION", "Retained Rollback publication record is missing");
  }

  // Restore the exact prior version: no new Build, no new Build Version, no
  // new Approval, no regeneration. Publication history (rows) is preserved;
  // mutable Site Configuration is deliberately untouched.
  //
  // When the caller authorized the rollback against a specific current
  // version (capability-token routes), the state flip is conditional on that
  // version still being current, so a publication that lands between
  // authorization and this write cannot redirect the rollback.
  const updated = await env.DB.prepare(
    `UPDATE site_published_state SET
       current_publication_id = ?, current_build_version_id = ?,
       rollback_publication_id = NULL, rollback_build_version_id = NULL, rollback_expires_at = NULL,
       updated_at = ?
     WHERE site_id = ?${input.expectedCurrentBuildVersionId ? " AND current_build_version_id = ?" : ""}`
  )
    .bind(
      ...(input.expectedCurrentBuildVersionId
        ? [restored.id, restored.build_version_id, now, input.siteId, input.expectedCurrentBuildVersionId]
        : [restored.id, restored.build_version_id, now, input.siteId])
    )
    .run();
  if (input.expectedCurrentBuildVersionId && (updated.meta.changes ?? 0) === 0) {
    throw new PublicationError(
      "NO_ROLLBACK_VERSION",
      "Published state changed after authorization; review current state and use a fresh capability"
    );
  }

  // Deployment roles follow the restored truth.
  await env.DB.prepare(
    "UPDATE build_deployments SET status = 'superseded', updated_at = ? WHERE build_version_id = ? AND role = 'published' AND status = 'active'"
  )
    .bind(now, state.current_build_version_id)
    .run();
  await env.DB.prepare(
    "UPDATE build_deployments SET status = 'active', updated_at = ? WHERE build_version_id = ? AND role = 'published'"
  )
    .bind(now, restored.build_version_id)
    .run();

  await appendBuildWorkflowEvent(env, {
    buildId: restored.build_id,
    buildVersionId: restored.build_version_id,
    fromState: "PUBLISHED",
    toState: "PUBLISHED",
    stage: "rollback",
    detail: `Rollback restored this exact previously published Build Version without a new Build, Build Version, Approval or regeneration; Site Configuration unchanged`,
  });

  return {
    restoredBuildVersionId: restored.build_version_id,
    restoredPublicationId: restored.id,
    restoredUrl: restored.published_url,
  };
}

// ── Reader ──────────────────────────────────────────────────────────────────

export interface PublicationStateView {
  current: { publicationId: string; buildVersionId: string; url: string } | null;
  rollback: { publicationId: string; buildVersionId: string; expiresAt: string | null } | null;
}

export async function getPublicationState(env: Env, siteId: string): Promise<PublicationStateView> {
  const state = await env.DB.prepare("SELECT * FROM site_published_state WHERE site_id = ?")
    .bind(siteId)
    .first<{
      current_publication_id: string;
      current_build_version_id: string;
      rollback_publication_id: string | null;
      rollback_build_version_id: string | null;
      rollback_expires_at: string | null;
    }>();
  if (!state) return { current: null, rollback: null };
  const current = await env.DB.prepare("SELECT published_url FROM publications WHERE id = ?")
    .bind(state.current_publication_id)
    .first<{ published_url: string }>();
  return {
    current: {
      publicationId: state.current_publication_id,
      buildVersionId: state.current_build_version_id,
      url: current?.published_url ?? "",
    },
    rollback: state.rollback_publication_id
      ? {
          publicationId: state.rollback_publication_id,
          buildVersionId: state.rollback_build_version_id!,
          expiresAt: state.rollback_expires_at,
        }
      : null,
  };
}
