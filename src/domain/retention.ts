// V2 Deployment and artifact retention lifecycle (issue #16, PRD section 22).
//
// Disposal rules (deterministic, idempotent, protection-first):
//   - Preview Deployments of FAILED Builds, and Preview Deployments
//     superseded by a newer Build Version's Preview, are disposable: the
//     Worker is deleted and the deployment row marked 'deleted'.
//   - The CURRENT Published Version and the retained (in-window) Rollback
//     Version are protected from cleanup unconditionally.
//   - Older published deployments become removable once they no longer hold
//     the rollback role AND the retention window has expired.
//   - Disposable R2 artifacts (source/assets/evidence/qa/ai payloads) of
//     dead versions are pruned, while compact Build Records — outcome, QA
//     scores/gates, root causes, image cost ledger and prompt/model/schema
//     provenance — live in D1 and survive artifact removal.
//   - Benchmark evidence uses a longer retention policy and is skipped.

import type { Env } from "../env.d";
import { nowIso } from "../lib/crypto";
import { deleteObject } from "../lib/assets";
import { rollbackWindowDays } from "./publication";

export const BENCHMARK_EVIDENCE_RETENTION_DAYS = 365;

export interface RetentionDeleter {
  (workerName: string): Promise<void>;
}

export interface CleanupReport {
  deletedWorkers: string[];
  markedSuperseded: string[];
  protectedWorkers: string[];
  prunedArtifactKeys: string[];
}

interface DeploymentRow {
  id: string;
  build_id: string;
  build_version_id: string;
  role: "preview" | "published" | "rollback";
  worker_name: string;
  preview_url: string;
  status: "active" | "superseded" | "deleted";
  updated_at: string;
}

interface PublishedStateRow {
  site_id: string;
  current_build_version_id: string;
  rollback_build_version_id: string | null;
  rollback_expires_at: string | null;
}

async function loadDeployments(env: Env): Promise<DeploymentRow[]> {
  const rows = await env.DB.prepare("SELECT * FROM build_deployments ORDER BY created_at").all<DeploymentRow>();
  return rows.results ?? [];
}

async function loadPublishedStates(env: Env): Promise<Map<string, PublishedStateRow>> {
  const rows = await env.DB.prepare("SELECT * FROM site_published_state").all<PublishedStateRow>();
  return new Map((rows.results ?? []).map((row) => [row.site_id, row]));
}

async function buildStateMap(env: Env): Promise<Map<string, string>> {
  const rows = await env.DB.prepare("SELECT id, state FROM builds").all<{ id: string; state: string }>();
  return new Map((rows.results ?? []).map((row) => [row.id, row.state]));
}

// Latest version per build (a Preview for a non-latest version whose newer
// sibling also has a Preview is superseded).
async function latestVersionWithPreviewPerBuild(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT d.build_id, MAX(bv.version_number) AS max_version
     FROM build_deployments d
     JOIN build_versions bv ON bv.id = d.build_version_id
     WHERE d.role = 'preview' AND d.status != 'deleted'
     GROUP BY d.build_id`
  ).all<{ build_id: string; max_version: number }>();
  return new Map((rows.results ?? []).map((row) => [row.build_id, row.max_version]));
}

async function versionNumberMap(env: Env): Promise<Map<string, number>> {
  const rows = await env.DB.prepare("SELECT id, version_number FROM build_versions").all<{ id: string; version_number: number }>();
  return new Map((rows.results ?? []).map((row) => [row.id, row.version_number]));
}

// Marks still-active Preview Deployments of older Build Versions as
// superseded once a newer version of the same Build has its own Preview.
// Called by the preview deploy path when a newer candidate lands.
export async function markSupersededPreviews(
  env: Env,
  input: { buildId: string; activeBuildVersionId: string }
): Promise<number> {
  const info = await env.DB.prepare(
    "SELECT version_number FROM build_versions WHERE id = ?"
  )
    .bind(input.activeBuildVersionId)
    .first<{ version_number: number }>();
  if (!info) return 0;
  const result = await env.DB.prepare(
    `UPDATE build_deployments SET status = 'superseded', updated_at = ?
     WHERE role = 'preview' AND status = 'active' AND build_id = ?
       AND build_version_id IN (
         SELECT id FROM build_versions WHERE build_id = ? AND version_number < ?
       )`
  )
    .bind(nowIso(), input.buildId, input.buildId, info.version_number)
    .run();
  return result.meta.changes ?? 0;
}

export interface CleanupOptions {
  now?: Date;
  deleter?: RetentionDeleter;
  /** Sites whose evidence uses the longer benchmark retention policy. */
  benchmarkSiteIds?: string[];
  /** Restrict processing to these Builds (e.g. one Site's retry sweep); protection stays global. */
  buildIds?: string[];
}

export async function cleanupDisposableDeployments(
  env: Env,
  options: CleanupOptions = {}
): Promise<CleanupReport> {
  const now = (options.now ?? new Date()).toISOString();
  const deleter: RetentionDeleter =
    options.deleter ??
    (async (workerName) => {
      const { deleteWorker } = await import("../lib/publish");
      try {
        await deleteWorker(env, workerName);
      } catch (error) {
        // A Worker that already vanished externally must not block the
        // idempotent bookkeeping (row -> 'deleted').
        if (!(error instanceof Error && error.message.includes("404"))) throw error;
      }
    });

  const report: CleanupReport = {
    deletedWorkers: [],
    markedSuperseded: [],
    protectedWorkers: [],
    prunedArtifactKeys: [],
  };

  const deployments = await loadDeployments(env);
  const states = await loadPublishedStates(env);
  const buildStates = await buildStateMap(env);
  const versionNumbers = await versionNumberMap(env);
  const latestPreview = await latestVersionWithPreviewPerBuild(env);

  // Protected version ids: every Site's current Published Version and its
  // in-window Rollback Version. Cleanup can never touch these.
  const protectedVersionIds = new Set<string>();
  for (const state of states.values()) {
    protectedVersionIds.add(state.current_build_version_id);
    if (
      state.rollback_build_version_id &&
      state.rollback_expires_at &&
      state.rollback_expires_at >= now
    ) {
      protectedVersionIds.add(state.rollback_build_version_id);
    }
  }

  const scope = options.buildIds ? new Set(options.buildIds) : null;
  for (const deployment of deployments) {
    if (deployment.status === "deleted") continue; // idempotent
    if (scope && !scope.has(deployment.build_id)) continue;

    if (protectedVersionIds.has(deployment.build_version_id)) {
      report.protectedWorkers.push(deployment.worker_name);
      continue;
    }

    let disposable = false;
    if (deployment.role === "preview") {
      if (buildStates.get(deployment.build_id) === "FAILED") {
        disposable = true;
      } else if (deployment.status === "superseded") {
        disposable = true;
      } else if (
        deployment.status === "active" &&
        versionNumbers.get(deployment.build_version_id)! < (latestPreview.get(deployment.build_id) ?? 0)
      ) {
        // Superseded by a newer Preview of the same Build.
        await env.DB.prepare("UPDATE build_deployments SET status = 'superseded', updated_at = ? WHERE id = ?")
          .bind(now, deployment.id)
          .run();
        report.markedSuperseded.push(deployment.worker_name);
        disposable = true;
      }
    } else if (deployment.role === "published" && deployment.status === "superseded") {
      // Older published deployment: removable once it no longer holds the
      // rollback role and the retention window has lapsed since supersession.
      const windowMs = rollbackWindowDays(env) * 24 * 60 * 60_000;
      const supersededAt = new Date(deployment.updated_at).getTime();
      disposable = Number.isFinite(supersededAt) && Date.parse(now) - supersededAt >= windowMs;
    }

    if (!disposable) continue;

    await deleter(deployment.worker_name);
    await env.DB.prepare("UPDATE build_deployments SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(now, deployment.id)
      .run();
    report.deletedWorkers.push(deployment.worker_name);
  }

  return report;
}

// ── Artifact pruning with compact Build Record survival ────────────────────

export interface PruneOptions {
  benchmarkSiteIds?: string[];
  /** Object deletor seam (tests inject an in-memory recorder). */
  deleteObject?: (key: string) => Promise<void>;
}

export interface DisposableArtifactIndex {
  artifactKeys: string[];
  benchmarkProtectedKeys: string[];
}

// Collects the disposable R2 keys for one Build Version: stage artifacts,
// assembled source/assets, QA evidence, AI payloads and the frozen reference
// evidence package. Benchmark sites keep evidence on the longer policy.
export async function indexDisposableArtifacts(
  env: Env,
  input: { buildId: string; buildVersionId: string; siteGenerationId: string },
  options: PruneOptions = {}
): Promise<DisposableArtifactIndex> {
  const benchmark = new Set(options.benchmarkSiteIds ?? []);
  let siteId: string | null = null;
  if (benchmark.size > 0) {
    const generation = await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
      .bind(input.siteGenerationId)
      .first<{ site_id: string }>();
    siteId = generation?.site_id ?? null;
  }
  const isBenchmark = siteId !== null && benchmark.has(siteId);

  const keys: string[] = [];
  const stageArtifacts = await env.DB.prepare(
    "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .all<{ artifact_r2_key: string }>();
  for (const row of stageArtifacts.results ?? []) keys.push(row.artifact_r2_key);

  const evidence = await env.DB.prepare(
    "SELECT evidence_r2_key, canonical_screenshot_r2_key FROM reference_evidence_packages WHERE build_version_id = ?"
  )
    .bind(input.buildVersionId)
    .all<{ evidence_r2_key: string; canonical_screenshot_r2_key: string }>();
  for (const row of evidence.results ?? []) {
    keys.push(row.evidence_r2_key, row.canonical_screenshot_r2_key);
  }

  const images = await env.DB.prepare(
    "SELECT r2_key FROM image_attempts WHERE build_version_id = ? AND r2_key IS NOT NULL"
  )
    .bind(input.buildVersionId)
    .all<{ r2_key: string }>();
  for (const row of images.results ?? []) keys.push(row.r2_key);

  if (isBenchmark) {
    // Benchmark diagnosis keeps evidence and AI/QA payloads on the longer
    // retention policy; only generated source/manifests are disposable.
    const benchmarkProtected = keys.filter(
      (key) => key.includes("/evidence") || key.includes("/ai/") || key.includes("/qa")
    );
    return {
      artifactKeys: keys.filter((key) => !benchmarkProtected.includes(key)),
      benchmarkProtectedKeys: benchmarkProtected,
    };
  }

  return { artifactKeys: keys, benchmarkProtectedKeys: [] };
}

export async function pruneDisposableVersionArtifacts(
  env: Env,
  input: { buildId: string; buildVersionId: string; siteGenerationId: string },
  options: PruneOptions = {}
): Promise<string[]> {
  const remove = options.deleteObject ?? ((key: string) => deleteObject(env, key));
  const index = await indexDisposableArtifacts(env, input, options);
  for (const key of index.artifactKeys) {
    await remove(key);
  }
  return index.artifactKeys;
}

// ── Compact Build Record (survives artifact cleanup) ────────────────────────

export interface CompactBuildRecord {
  buildId: string;
  siteGenerationId: string;
  kind: string;
  outcome: string;
  versions: Array<{
    versionNumber: number;
    releaseReady: boolean;
    qa: { visual: number; content: number; technical: number } | null;
    approvals: number;
    publications: number;
  }>;
  rootCauses: Array<{ batch: string; rootCause: string }>;
  imageSpendUsd: number;
  provenance: Array<{ stage: string; promptId: string; promptVersion: string; model: string; schemaVersion: string; attempt: number; outcome: string }>;
}

// Assembled purely from compact D1 rows — outcome/state, per-version QA
// scores, repair root causes, the image cost ledger and prompt/model/schema
// provenance — so it remains fully available after disposable artifacts are
// pruned (PRD section 22.1).
export async function getCompactBuildRecord(env: Env, buildId: string): Promise<CompactBuildRecord | null> {
  const build = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
    .bind(buildId)
    .first<{ id: string; site_generation_id: string; kind: string; state: string }>();
  if (!build) return null;

  const versions = await env.DB.prepare(
    "SELECT id, version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
  )
    .bind(buildId)
    .all<{ id: string; version_number: number }>();

  const versionSummaries: CompactBuildRecord["versions"] = [];
  for (const version of versions.results ?? []) {
    const release = await env.DB.prepare(
      "SELECT qa_a_visual_score, qa_a_content_score, qa_b_technical_score FROM build_release_records WHERE build_version_id = ?"
    )
      .bind(version.id)
      .first<{ qa_a_visual_score: number; qa_a_content_score: number; qa_b_technical_score: number }>();
    const approvals = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_version_id = ?")
      .bind(version.id)
      .first<{ n: number }>();
    const publications = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE build_version_id = ?")
      .bind(version.id)
      .first<{ n: number }>();
    versionSummaries.push({
      versionNumber: version.version_number,
      releaseReady: release !== null,
      qa: release
        ? { visual: release.qa_a_visual_score, content: release.qa_a_content_score, technical: release.qa_b_technical_score }
        : null,
      approvals: approvals?.n ?? 0,
      publications: publications?.n ?? 0,
    });
  }

  const batches = await env.DB.prepare("SELECT * FROM repair_batches WHERE build_id = ? ORDER BY created_at")
    .bind(buildId)
    .all<{ id: string; kind: string; plan_json: string }>();
  const rootCauses: CompactBuildRecord["rootCauses"] = [];
  for (const batch of batches.results ?? []) {
    const plan = JSON.parse(batch.plan_json) as { rootCauses?: Array<{ rootCause: string }> };
    for (const cause of plan.rootCauses ?? []) {
      rootCauses.push({ batch: batch.kind, rootCause: cause.rootCause });
    }
  }

  const spend = await env.DB.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM image_attempts WHERE build_id = ?")
    .bind(buildId)
    .first<{ total: number }>();

  const provenanceRows = await env.DB.prepare(
    "SELECT stage, prompt_id, prompt_version, model, schema_version, attempt, outcome FROM ai_stage_runs WHERE build_id = ? ORDER BY created_at, attempt"
  )
    .bind(buildId)
    .all<CompactBuildRecord["provenance"][number]>();

  return {
    buildId: build.id,
    siteGenerationId: build.site_generation_id,
    kind: build.kind,
    outcome: build.state,
    versions: versionSummaries,
    rootCauses,
    imageSpendUsd: Number((spend?.total ?? 0).toFixed(4)),
    provenance: provenanceRows.results ?? [],
  };
}
