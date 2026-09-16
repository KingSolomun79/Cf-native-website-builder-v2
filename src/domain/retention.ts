// V2 Deployment and artifact retention lifecycle (issue #16, PRD section 22).
//
// Disposal rules (deterministic, idempotent, protection-first):
//   - Preview Deployments of FAILED Builds, and Preview Deployments
//     superseded by a newer Build Version's Preview, are disposable: the
//     Worker is deleted and the deployment row marked 'deleted'.
//   - The CURRENT Published Version and the retained (in-window) Rollback
//     Version are protected from cleanup unconditionally.
//   - An approved Build Version with no successful publication yet keeps an
//     open publication right: its candidate stays inspectable and its
//     artifacts stay publishable until a publication actually succeeds.
//   - Older published deployments become removable once they no longer hold
//     the rollback role AND the retention window has expired.
//   - Disposable R2 artifacts (source/assets/evidence/qa/ai payloads) of
//     dead versions are pruned, while compact Build Records — outcome, QA
//     scores/gates, root causes, image cost ledger and prompt/model/schema
//     provenance — live in D1 and survive artifact removal.
//   - Benchmark evidence uses a longer retention policy (PRD 22.3) and is
//     exempt from routine evidence/AI/QA pruning; the retention duration for
//     it is an explicit operator decision, not invented here.
//
// Every destructive delete re-reads canonical protection state immediately
// before deleting (publication/rollback may have moved since the sweep
// started; current publication safety wins over cleanup efficiency), and a
// transport failure on one item is recorded and retried by a later sweep
// without touching any publication or Build lifecycle state.

import type { Env } from "../env.d";
import { nowIso } from "../lib/crypto";
import { deleteObject, objectExists } from "../lib/assets";
import { rollbackWindowDays } from "./publication";

export interface RetentionDeleter {
  (workerName: string): Promise<void>;
}

export interface CleanupFailure {
  workerName: string;
  error: string;
}

export interface CleanupReport {
  deletedWorkers: string[];
  markedSuperseded: string[];
  protectedWorkers: string[];
  prunedArtifactKeys: string[];
  /** Items whose cleanup failed operationally; left intact for a later sweep. */
  failedWorkers: CleanupFailure[];
}

// Bounded per-run sweep limits: the cron path processes at most this many
// destructive operations per invocation and resumes on the next trigger.
export const SWEEP_MAX_DELETIONS = 25;
export const SWEEP_MAX_VERSION_PRUNES = 10;
// Candidate rows examined per sweep (>= deletions so skips don't starve work).
const SWEEP_CANDIDATE_LIMIT = 200;

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

// Only rows that could ever be disposable, oldest first. Active published
// rows and rollback-role rows are never selected: they hold protected roles
// by definition until a canonical state flip supersedes them.
async function loadDisposableCandidates(env: Env, limit: number): Promise<DeploymentRow[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM build_deployments
     WHERE status != 'deleted'
       AND (role = 'preview' OR (role = 'published' AND status = 'superseded'))
     ORDER BY updated_at, id
     LIMIT ?`
  )
    .bind(limit)
    .all<DeploymentRow>();
  return rows.results ?? [];
}

// Fresh canonical protection state for ONE version, read at deletion time —
// not the sweep-start snapshot. Protects against publication/rollback landing
// between candidate selection and the destructive call.
async function isVersionProtectedNow(env: Env, buildVersionId: string, now: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM site_published_state
         WHERE current_build_version_id = ?
            OR (rollback_build_version_id = ? AND rollback_expires_at IS NOT NULL AND rollback_expires_at >= ?)
       ) AS protected_state,
       (SELECT COUNT(*) FROM build_approvals a
         WHERE a.build_version_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM publications p
              WHERE p.build_version_id = a.build_version_id AND p.status = 'published'
           )
       ) AS open_publication_right`
  )
    .bind(buildVersionId, buildVersionId, now, buildVersionId)
    .first<{ protected_state: number; open_publication_right: number }>();
  return (row?.protected_state ?? 0) > 0 || (row?.open_publication_right ?? 0) > 0;
}

// Versions whose Approval has never been followed by a successful
// publication: the exact-version publication right is still open, so the
// candidate (preview + artifacts) must remain inspectable/publishable.
async function openPublicationRightVersionIds(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    `SELECT a.build_version_id AS id FROM build_approvals a
     WHERE NOT EXISTS (
       SELECT 1 FROM publications p
        WHERE p.build_version_id = a.build_version_id AND p.status = 'published'
     )`
  ).all<{ id: string }>();
  return new Set((rows.results ?? []).map((row) => row.id));
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
  /** Destructive deletions allowed in this run; the rest resume next sweep. */
  maxDeletions?: number;
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
      await deleteWorker(env, workerName);
    });

  const report: CleanupReport = {
    deletedWorkers: [],
    markedSuperseded: [],
    protectedWorkers: [],
    prunedArtifactKeys: [],
    failedWorkers: [],
  };

  const maxDeletions = options.maxDeletions ?? Number.POSITIVE_INFINITY;
  const candidateLimit =
    Number.isFinite(maxDeletions) ? Math.min(SWEEP_CANDIDATE_LIMIT, maxDeletions * 4 + 8) : SWEEP_CANDIDATE_LIMIT;
  const deployments = await loadDisposableCandidates(env, candidateLimit);
  const scope = options.buildIds ? new Set(options.buildIds) : null;
  const states = await loadPublishedStates(env);
  const buildStates = await buildStateMap(env);
  const versionNumbers = await versionNumberMap(env);
  const latestPreview = await latestVersionWithPreviewPerBuild(env);

  // Protected version ids at sweep start (fast path): every Site's current
  // Published Version, its in-window Rollback Version, and every approved
  // version whose publication right is still open. The per-item re-read
  // below remains the authoritative gate before each destructive delete.
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
  for (const versionId of await openPublicationRightVersionIds(env)) {
    protectedVersionIds.add(versionId);
  }

  let deletions = 0;
  for (const deployment of deployments) {
    if (deletions >= maxDeletions) break; // resumable: next sweep continues oldest-first
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

    // Destructive gate: re-read canonical protection state NOW. If the
    // version gained a protected role since the sweep started (publication,
    // rollback, or a fresh Approval with an open publication right), current
    // publication safety wins and the deletion is skipped.
    try {
      if (await isVersionProtectedNow(env, deployment.build_version_id, now)) {
        report.protectedWorkers.push(deployment.worker_name);
        continue;
      }
      await deleter(deployment.worker_name);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/'/g, "").slice(0, 300);
      // Only the exact provider "already absent" signal counts as satisfied —
      // never a mere substring, so a transport error mentioning "404" cannot
      // orphan a still-serving Worker behind a 'deleted' row.
      const alreadyAbsent = message.includes("Worker deletion failed: 404");
      if (!alreadyAbsent) {
        // Operational failure: record it, leave the row intact for a later
        // sweep, and never touch any publication or Build lifecycle state.
        report.failedWorkers.push({ workerName: deployment.worker_name, error: message });
        console.error(`(error) retention_cleanup_failed { worker: '${deployment.worker_name}', message: '${message}' }`);
        continue;
      }
      // "Already absent" (404): cleanup is idempotently satisfied; fall
      // through to the bookkeeping so the row converges to 'deleted'.
    }
    await env.DB.prepare("UPDATE build_deployments SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(now, deployment.id)
      .run();
    report.deletedWorkers.push(deployment.worker_name);
    deletions += 1;
  }

  return report;
}

// ── Artifact pruning with compact Build Record survival ────────────────────

/** Per-run bulky benchmark evidence retention (FDR 130.B, operator decision
 *  2026-09-16): run-specific evidence/AI/QA payloads stay protected for this
 *  long, then become cleanup-eligible under the normal rules. Frozen
 *  benchmark DEFINITION inputs live under `benchmarks/` — never under a Build
 *  Version — so they are structurally outside every cleanup path. */
export const BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS = 180;

export interface PruneOptions {
  benchmarkSiteIds?: string[];
  /** Object deletor seam (tests inject an in-memory recorder). */
  deleteObject?: (key: string) => Promise<void>;
  /** Reference clock for retention-class expiry (defaults to now). */
  now?: Date;
}

export interface DisposableArtifactIndex {
  artifactKeys: string[];
  benchmarkProtectedKeys: string[];
}

// True when the benchmark run for this Build started at least
// BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS ago (FDR 130.B). Builds with no
// recorded benchmark run are never treated as expired.
async function benchmarkRunEvidenceExpired(env: Env, buildId: string, now: Date): Promise<boolean> {
  const run = await env.DB.prepare("SELECT started_at FROM benchmark_runs WHERE build_id = ? ORDER BY started_at DESC LIMIT 1")
    .bind(buildId)
    .first<{ started_at: string }>();
  if (!run?.started_at) return false;
  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return false;
  const ageDays = (now.getTime() - startedMs) / (24 * 60 * 60_000);
  return ageDays >= BENCHMARK_RUN_EVIDENCE_RETENTION_DAYS;
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
    // Benchmark evidence/AI/QA payloads follow the 180-day per-run evidence
    // class (FDR 130.B): protected while the run is young, cleanup-eligible
    // after expiry. A build with no recorded benchmark run keeps the
    // conservative protection (protects more, deletes less).
    const benchmarkProtected = keys.filter(
      (key) => key.includes("/evidence") || key.includes("/ai/") || key.includes("/qa")
    );
    const expired = await benchmarkRunEvidenceExpired(env, input.buildId, options.now ?? new Date());
    if (expired) {
      return { artifactKeys: keys, benchmarkProtectedKeys: [] };
    }
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

// ── Bounded artifact-prune sweep (cron path) ────────────────────────────────

export interface PruneSweepOptions {
  now?: Date;
  /** Build Versions pruned per run; the rest resume on the next sweep. */
  maxVersions?: number;
  /** Object deletor seam (tests inject an in-memory recorder). */
  deleteObject?: (key: string) => Promise<void>;
  /** Overrides the canonical benchmark_runs-derived site list when given. */
  benchmarkSiteIds?: string[];
  /** Restrict processing to these Builds; protection stays global. */
  buildIds?: string[];
}

export interface PruneSweepReport {
  prunedVersions: string[];
  prunedArtifactKeys: string[];
  benchmarkProtectedKeys: string[];
  protectedVersions: string[];
  failedVersions: CleanupFailure[];
}

// Benchmark-linked Sites, derived canonically from the immutable
// benchmark_runs trail — benchmark diagnosis keeps evidence/AI/QA payloads on
// the longer retention policy (PRD 22.3).
export async function benchmarkSiteIdsFromRuns(env: Env): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT g.site_id AS site_id
     FROM benchmark_runs br
     JOIN site_generations g ON g.id = br.site_generation_id`
  ).all<{ site_id: string }>();
  return (rows.results ?? []).map((row) => row.site_id);
}

// Versions whose bulky artifacts MAY be disposable: terminal FAILED Builds,
// or versions whose newer sibling owns the active preview candidate role.
// Protection roles are re-checked per version before any deletion.
async function loadPruneCandidates(env: Env, limit: number, scope: Set<string> | null): Promise<Array<{ buildVersionId: string; buildId: string; siteGenerationId: string }>> {
  const scopeFilter = scope ? ` AND b.id IN (${[...scope].map(() => "?").join(",")})` : "";
  const rows = await env.DB.prepare(
    `SELECT bv.id AS buildVersionId, bv.build_id AS buildId, b.site_generation_id AS siteGenerationId
     FROM build_versions bv
     JOIN builds b ON b.id = bv.build_id
     WHERE (
         b.state = 'FAILED'
         OR (
           EXISTS (
             SELECT 1 FROM build_versions newer
              WHERE newer.build_id = bv.build_id AND newer.version_number > bv.version_number
           )
           AND EXISTS (
             SELECT 1 FROM build_deployments d
              JOIN build_versions owner ON owner.id = d.build_version_id
              WHERE d.build_id = bv.build_id AND d.role = 'preview' AND d.status = 'active'
                AND owner.version_number > bv.version_number
           )
         )
       )${scopeFilter}
     ORDER BY bv.created_at, bv.id
     LIMIT ?`
  )
    .bind(...(scope ? [...scope] : []), limit)
    .all<{ buildVersionId: string; buildId: string; siteGenerationId: string }>();
  return rows.results ?? [];
}

// Fresh per-version eligibility at deletion time: the version must still hold
// no protected role (current published / in-window rollback / open
// publication right) and still be disposable (terminal FAILED Build, or a
// newer sibling still owning the active preview role).
async function isVersionPruneEligibleNow(
  env: Env,
  input: { buildVersionId: string; buildId: string },
  now: string
): Promise<boolean> {
  if (await isVersionProtectedNow(env, input.buildVersionId, now)) return false;
  const state = await env.DB.prepare("SELECT state FROM builds WHERE id = ?")
    .bind(input.buildId)
    .first<{ state: string }>();
  if (!state) return false;
  if (state.state === "FAILED") return true;
  const newerOwnsPreview = await env.DB.prepare(
    `SELECT 1 FROM build_deployments d
     JOIN build_versions bv ON bv.id = d.build_version_id
     JOIN build_versions me ON me.id = ?
     WHERE d.build_id = ? AND d.role = 'preview' AND d.status = 'active'
       AND bv.version_number > me.version_number
     LIMIT 1`
  )
    .bind(input.buildVersionId, input.buildId)
    .first();
  return newerOwnsPreview !== null;
}

export async function pruneDisposableBuildArtifacts(
  env: Env,
  options: PruneSweepOptions = {}
): Promise<PruneSweepReport> {
  const now = (options.now ?? new Date()).toISOString();
  const report: PruneSweepReport = {
    prunedVersions: [],
    prunedArtifactKeys: [],
    benchmarkProtectedKeys: [],
    protectedVersions: [],
    failedVersions: [],
  };

  const maxVersions = options.maxVersions ?? Number.POSITIVE_INFINITY;
  const candidateLimit =
    Number.isFinite(maxVersions) ? Math.min(SWEEP_CANDIDATE_LIMIT, maxVersions * 4 + 8) : SWEEP_CANDIDATE_LIMIT;
  const scope = options.buildIds ? new Set(options.buildIds) : null;
  const candidates = await loadPruneCandidates(env, candidateLimit, scope);
  if (candidates.length === 0) return report;

  const benchmarkSiteIds = options.benchmarkSiteIds ?? (await benchmarkSiteIdsFromRuns(env));
  const benchmark = new Set(benchmarkSiteIds);

  for (const candidate of candidates) {
    try {
      if (!(await isVersionPruneEligibleNow(env, candidate, now))) {
        report.protectedVersions.push(candidate.buildVersionId);
        continue;
      }
      const index = await indexDisposableArtifacts(
        env,
        candidate,
        { benchmarkSiteIds: [...benchmark] }
      );
      // D1 artifact-index rows are permanent by design, so a version pruned
      // by an earlier sweep still lists its keys. Destructive work is counted
      // by keys that STILL EXIST in R2: already-pruned versions cost the run
      // nothing and the sweep converges without extra state.
      const existingKeys: string[] = [];
      for (const key of index.artifactKeys) {
        if (await objectExists(env, key)) existingKeys.push(key);
      }
      if (existingKeys.length === 0) continue; // nothing left to delete
      if (report.prunedVersions.length >= maxVersions) break; // resumable: next sweep continues oldest-first
      const remove = options.deleteObject ?? ((key: string) => deleteObject(env, key));
      for (const key of existingKeys) {
        await remove(key);
      }
      report.prunedVersions.push(candidate.buildVersionId);
      report.prunedArtifactKeys.push(...existingKeys);
      report.benchmarkProtectedKeys.push(...index.benchmarkProtectedKeys);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(/'/g, "").slice(0, 300);
      report.failedVersions.push({ workerName: candidate.buildVersionId, error: message });
      console.error(`(error) retention_prune_failed { build_version: '${candidate.buildVersionId}', message: '${message}' }`);
    }
  }

  return report;
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
