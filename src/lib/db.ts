import type { CandidateValidationRunRow, ClientRow, JobRow, ReferenceAssetRow, ReferenceCaptureRow, ReferenceInteractionRow, BlueprintRow, SiteRow, EvidenceAttemptSummary, EvidenceReferenceCaptureRow, EvidenceInteractionRow, EvidenceCurrentRow } from "../types";

export async function createCandidateValidationRun(db: D1Database, data: CandidateValidationRunRow): Promise<boolean> {
  const result = await db.prepare(
    `INSERT INTO candidate_validation_runs (
      id, nonce, status, report_r2_key, summary_json, created_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(nonce) DO NOTHING`
  ).bind(data.id, data.nonce, data.status, data.report_r2_key, data.summary_json, data.created_at, data.completed_at).run();
  return result.meta.changes === 1;
}

export async function completeCandidateValidationRun(
  db: D1Database,
  runId: string,
  data: Pick<CandidateValidationRunRow, "status" | "summary_json" | "completed_at">
): Promise<void> {
  await db.prepare(
    "UPDATE candidate_validation_runs SET status = ?, summary_json = ?, completed_at = ? WHERE id = ?"
  ).bind(data.status, data.summary_json, data.completed_at, runId).run();
}

export async function getCandidateValidationRun(db: D1Database, runId: string): Promise<CandidateValidationRunRow | null> {
  return db.prepare("SELECT * FROM candidate_validation_runs WHERE id = ?").bind(runId).first<CandidateValidationRunRow>();
}

export async function createClient(db: D1Database, data: ClientRow): Promise<void> {
  await db.prepare(
    `INSERT INTO clients (
      id, slug, company_name, client_email,
      address_line_1, address_line_2, city, county, zip_code, country,
      business_type, business_description, ideal_client_profile,
      logo_url, preferred_colour_1, preferred_colour_2, mode,
      website_overall_style,
      facebook_url, instagram_url, twitter_url, linkedin_url, other_social_url,
      extra_information, whatsapp_number, reference_site_url, inspiration_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.slug, data.company_name, data.client_email,
    data.address_line_1, data.address_line_2, data.city, data.county, data.zip_code, data.country,
    data.business_type, data.business_description, data.ideal_client_profile,
    data.logo_url, data.preferred_colour_1, data.preferred_colour_2, data.mode,
    data.website_overall_style,
    data.facebook_url, data.instagram_url, data.twitter_url, data.linkedin_url, data.other_social_url,
    data.extra_information, data.whatsapp_number, data.reference_site_url, data.inspiration_url, data.created_at, data.updated_at
  ).run();
}

export async function createSite(db: D1Database, data: SiteRow): Promise<void> {
  await db.prepare(
    `INSERT INTO sites (
      id, client_id, current_version_id, status, revisions_count,
      preview_url, production_url, style_key, style_version,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.client_id, data.current_version_id, data.status, data.revisions_count,
    data.preview_url, data.production_url, data.style_key, data.style_version,
    data.created_at, data.updated_at
  ).run();
}

export async function createJob(db: D1Database, data: JobRow): Promise<void> {
  await db.prepare(
    `INSERT INTO jobs (
      id, site_id, client_id, job_type, status,
      current_step, error_code, error_message, job_validation_errors,
      workflow_instance_id, agent_session_id, raw_payload_r2_key,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.site_id, data.client_id, data.job_type, data.status,
    data.current_step, data.error_code, data.error_message, data.job_validation_errors,
    data.workflow_instance_id, data.agent_session_id, data.raw_payload_r2_key,
    data.created_at, data.updated_at
  ).run();
}

export async function fetchJob(db: D1Database, jobId: string): Promise<JobRow | null> {
  const result = await db.prepare("SELECT * FROM jobs WHERE id = ?").bind(jobId).first<JobRow>();
  return result;
}

export async function updateJobStatus(db: D1Database, jobId: string, status: string, extra?: Record<string, unknown>): Promise<void> {
  const sets = ["status = ?", "updated_at = ?"];
  const values: unknown[] = [status, new Date().toISOString()];

  if (extra?.current_step !== undefined) { sets.push("current_step = ?"); values.push(extra.current_step); }
  if (extra?.error_code !== undefined) { sets.push("error_code = ?"); values.push(extra.error_code); }
  if (extra?.error_message !== undefined) { sets.push("error_message = ?"); values.push(extra.error_message); }
  if (extra?.workflow_instance_id !== undefined) { sets.push("workflow_instance_id = ?"); values.push(extra.workflow_instance_id); }
  if (extra?.job_validation_errors !== undefined) { sets.push("job_validation_errors = ?"); values.push(extra.job_validation_errors); }

  values.push(jobId);
  await db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function slugExists(db: D1Database, slug: string): Promise<boolean> {
  const result = await db.prepare("SELECT 1 FROM clients WHERE slug = ?").bind(slug).first();
  return result !== null;
}

export async function getClientBySlug(db: D1Database, slug: string): Promise<ClientRow | null> {
  return db.prepare("SELECT * FROM clients WHERE slug = ?").bind(slug).first<ClientRow>();
}

export async function getClientById(db: D1Database, clientId: string): Promise<ClientRow | null> {
  return db.prepare("SELECT * FROM clients WHERE id = ?").bind(clientId).first<ClientRow>();
}

export async function updateClientReferenceSiteUrl(db: D1Database, clientId: string, url: string): Promise<void> {
  await db.prepare(
    "UPDATE clients SET reference_site_url = ?, inspiration_url = ?, updated_at = ? WHERE id = ?"
  ).bind(url, url, new Date().toISOString(), clientId).run();
}

export async function updateClientInspirationUrl(db: D1Database, clientId: string, url: string): Promise<void> {
  await updateClientReferenceSiteUrl(db, clientId, url);
}

export async function createReferenceAsset(db: D1Database, data: ReferenceAssetRow): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_assets (
      id, job_id, client_slug, site_version, kind, r2_key, original_filename,
      mime_type, width, height, byte_size, checksum, source, upload_id, capture_timestamp, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.job_id, data.client_slug, data.site_version, data.kind,
    data.r2_key, data.original_filename, data.mime_type, data.width, data.height,
    data.byte_size, data.checksum, data.source, data.upload_id ?? null, data.capture_timestamp, data.created_at
  ).run();
}

export async function getReferenceAsset(
  db: D1Database,
  jobId: string,
  siteVersion?: number,
  kind: string = "homepage_screenshot"
): Promise<ReferenceAssetRow | null> {
  if (siteVersion !== undefined) {
    return db.prepare(
      "SELECT * FROM reference_assets WHERE job_id = ? AND site_version = ? AND kind = ? LIMIT 1"
    ).bind(jobId, siteVersion, kind).first<ReferenceAssetRow>();
  }
  return db.prepare(
    "SELECT * FROM reference_assets WHERE job_id = ? AND kind = ? ORDER BY site_version DESC LIMIT 1"
  ).bind(jobId, kind).first<ReferenceAssetRow>();
}

export async function upsertReferenceCapture(db: D1Database, data: ReferenceCaptureRow): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_captures (
      id, job_id, client_slug, site_version, viewport, width, height,
      final_url, status, failure_code, failure_message,
      screenshot_r2_key, capture_json_r2_key, redirects, limitations,
      captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, viewport) DO UPDATE SET
      status=excluded.status,
      failure_code=excluded.failure_code,
      failure_message=excluded.failure_message,
      screenshot_r2_key=excluded.screenshot_r2_key,
      capture_json_r2_key=excluded.capture_json_r2_key,
      final_url=excluded.final_url,
      redirects=excluded.redirects,
      limitations=excluded.limitations,
      captured_at=excluded.captured_at`
  ).bind(
    data.id, data.job_id, data.client_slug, data.site_version, data.viewport,
    data.width, data.height, data.final_url, data.status, data.failure_code,
    data.failure_message, data.screenshot_r2_key, data.capture_json_r2_key,
    data.redirects, data.limitations, data.captured_at, data.created_at
  ).run();
}

export async function getReferenceCaptures(
  db: D1Database,
  jobId: string
): Promise<ReferenceCaptureRow[]> {
  const result = await db.prepare(
    "SELECT * FROM reference_captures WHERE job_id = ? ORDER BY width DESC"
  ).bind(jobId).all<ReferenceCaptureRow>();
  return result.results ?? [];
}

export async function upsertReferenceInteraction(db: D1Database, data: ReferenceInteractionRow): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_interactions (
      id, job_id, client_slug, site_version, viewport, status,
      observed_count, inferred_count, reduced_motion_detected, fallback_reason,
      interactions_r2_key, manifest_r2_key, captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, viewport) DO UPDATE SET
      status=excluded.status,
      observed_count=excluded.observed_count,
      inferred_count=excluded.inferred_count,
      reduced_motion_detected=excluded.reduced_motion_detected,
      fallback_reason=excluded.fallback_reason,
      interactions_r2_key=excluded.interactions_r2_key,
      manifest_r2_key=excluded.manifest_r2_key,
      captured_at=excluded.captured_at`
  ).bind(
    data.id, data.job_id, data.client_slug, data.site_version, data.viewport, data.status,
    data.observed_count, data.inferred_count, data.reduced_motion_detected, data.fallback_reason,
    data.interactions_r2_key, data.manifest_r2_key, data.captured_at, data.created_at
  ).run();
}

export async function getReferenceInteractions(
  db: D1Database,
  jobId: string
): Promise<ReferenceInteractionRow[]> {
  const result = await db.prepare(
    "SELECT * FROM reference_interactions WHERE job_id = ? ORDER BY viewport"
  ).bind(jobId).all<ReferenceInteractionRow>();
  return result.results ?? [];
}

export async function upsertBlueprint(db: D1Database, data: BlueprintRow): Promise<void> {
  await db.prepare(
    `INSERT INTO blueprints (
      id, job_id, client_slug, site_version, kind, schema_version, prompt_version, model,
      r2_key, validation_valid, validation_errors, review_issues, confidence, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, kind) DO UPDATE SET
      schema_version=excluded.schema_version,
      prompt_version=excluded.prompt_version,
      model=excluded.model,
      r2_key=excluded.r2_key,
      validation_valid=excluded.validation_valid,
      validation_errors=excluded.validation_errors,
      review_issues=excluded.review_issues,
      confidence=excluded.confidence,
      status=excluded.status`
  ).bind(
    data.id, data.job_id, data.client_slug, data.site_version, data.kind,
    data.schema_version, data.prompt_version, data.model, data.r2_key,
    data.validation_valid, data.validation_errors, data.review_issues,
    data.confidence, data.status, data.created_at
  ).run();
}

export async function getBlueprint(
  db: D1Database,
  jobId: string,
  kind: string
): Promise<BlueprintRow | null> {
  return db.prepare(
    "SELECT * FROM blueprints WHERE job_id = ? AND kind = ? LIMIT 1"
  ).bind(jobId, kind).first<BlueprintRow>();
}

export async function getSite(db: D1Database, siteId: string): Promise<SiteRow | null> {
  return db.prepare("SELECT * FROM sites WHERE id = ?").bind(siteId).first<SiteRow>();
}

export async function updateSiteStatus(db: D1Database, siteId: string, status: string): Promise<void> {
  await db.prepare("UPDATE sites SET status = ?, updated_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), siteId)
    .run();
}

export async function updateSitePreviewUrl(db: D1Database, siteId: string, previewUrl: string): Promise<void> {
  await db.prepare("UPDATE sites SET preview_url = ?, updated_at = ? WHERE id = ?")
    .bind(previewUrl, new Date().toISOString(), siteId)
    .run();
}

export async function createSiteVersion(
  db: D1Database,
  data: {
    id: string;
    site_id: string;
    version_number: number;
    source_type: string;
    source_job_id: string | null;
    build_manifest_r2_key: string | null;
    static_bundle_r2_prefix: string | null;
    deployed_worker_name: string | null;
    preview_url: string | null;
    qa_report_id: string | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO site_versions (
      id, site_id, version_number, source_type, source_job_id,
      build_manifest_r2_key, static_bundle_r2_prefix, deployed_worker_name,
      preview_url, qa_report_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`
  ).bind(
    data.id, data.site_id, data.version_number, data.source_type, data.source_job_id,
    data.build_manifest_r2_key, data.static_bundle_r2_prefix, data.deployed_worker_name,
    data.preview_url, data.qa_report_id, new Date().toISOString()
  ).run();
}

export async function getSiteVersion(db: D1Database, versionId: string): Promise<{
  id: string;
  site_id: string;
  version_number: number;
  source_type: string;
  source_job_id: string | null;
  deployed_worker_name: string | null;
  preview_url: string | null;
  qa_report_id: string | null;
} | null> {
  return db.prepare("SELECT * FROM site_versions WHERE id = ?").bind(versionId).first();
}

export async function updateSiteCurrentVersion(db: D1Database, siteId: string, versionId: string): Promise<void> {
  await db.prepare("UPDATE sites SET current_version_id = ?, updated_at = ? WHERE id = ?")
    .bind(versionId, new Date().toISOString(), siteId)
    .run();
}

export async function createPageSpec(
  db: D1Database,
  data: {
    id: string;
    site_version_id: string;
    page_name: string;
    slug: string;
    seo_title: string;
    meta_description: string;
    h1: string;
    spec_json: string;
    html_r2_key: string | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO page_specs (id, site_version_id, page_name, slug, seo_title, meta_description, h1, spec_json, html_r2_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.site_version_id, data.page_name, data.slug,
    data.seo_title, data.meta_description, data.h1, data.spec_json,
    data.html_r2_key, new Date().toISOString()
  ).run();
}

export async function createImageAsset(
  db: D1Database,
  data: {
    id: string;
    site_version_id: string;
    page_name: string;
    slot_name: string;
    prompt_text: string;
    alt_text: string;
    source_job_ref: string | null;
    r2_key: string | null;
    mime_type: string | null;
    width: number;
    height: number;
    status: string;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO image_assets (id, site_version_id, page_name, slot_name, prompt_text, alt_text,
     source_job_ref, r2_key, mime_type, width, height, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.site_version_id, data.page_name, data.slot_name,
    data.prompt_text, data.alt_text, data.source_job_ref, data.r2_key,
    data.mime_type, data.width, data.height, data.status, new Date().toISOString()
  ).run();
}

export async function updateImageAsset(
  db: D1Database,
  id: string,
  updates: { r2_key?: string; mime_type?: string; width?: number; height?: number; status?: string }
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.r2_key !== undefined) { sets.push("r2_key = ?"); values.push(updates.r2_key); }
  if (updates.mime_type !== undefined) { sets.push("mime_type = ?"); values.push(updates.mime_type); }
  if (updates.width !== undefined) { sets.push("width = ?"); values.push(updates.width); }
  if (updates.height !== undefined) { sets.push("height = ?"); values.push(updates.height); }
  if (updates.status !== undefined) { sets.push("status = ?"); values.push(updates.status); }

  if (sets.length === 0) return;
  values.push(id);
  await db.prepare(`UPDATE image_assets SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function createQaReport(
  db: D1Database,
  data: {
    id: string;
    site_version_id: string;
    status: string;
    summary: string;
    report_json: string;
    desktop_screenshot_r2_key: string | null;
    mobile_screenshot_r2_key: string | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO qa_reports (id, site_version_id, status, summary, report_json,
     desktop_screenshot_r2_key, mobile_screenshot_r2_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.site_version_id, data.status, data.summary, data.report_json,
    data.desktop_screenshot_r2_key, data.mobile_screenshot_r2_key, new Date().toISOString()
  ).run();
}

export async function createQaIssue(
  db: D1Database,
  data: {
    id: string;
    qa_report_id: string;
    severity: string;
    category: string;
    page_slug: string | null;
    selector: string | null;
    issue_text: string;
    screenshot_r2_key: string | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO qa_issues (id, qa_report_id, severity, category, page_slug, selector,
     issue_text, screenshot_r2_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.qa_report_id, data.severity, data.category,
    data.page_slug, data.selector, data.issue_text,
    data.screenshot_r2_key, new Date().toISOString()
  ).run();
}

export async function createApproval(
  db: D1Database,
  data: {
    id: string;
    job_id: string;
    status: string;
    signed_token_hash: string;
    requested_at: string;
    responded_at: string | null;
    responder_email: string | null;
    response_note: string | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO approvals (id, job_id, status, signed_token_hash, requested_at,
     responded_at, responder_email, response_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.job_id, data.status, data.signed_token_hash,
    data.requested_at, data.responded_at, data.responder_email, data.response_note
  ).run();
}

export async function createRevision(
  db: D1Database,
  data: {
    id: string;
    site_id: string;
    parent_site_version_id: string;
    requested_by_email: string | null;
    revision_prompt: string;
    revision_plan_json: string | null;
    revision_number: number;
    status: string;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO revisions (id, site_id, parent_site_version_id, requested_by_email,
     revision_prompt, revision_plan_json, revision_number, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.site_id, data.parent_site_version_id, data.requested_by_email,
    data.revision_prompt, data.revision_plan_json, data.revision_number,
    data.status, new Date().toISOString()
  ).run();
}

export async function incrementSiteRevisions(db: D1Database, siteId: string): Promise<number> {
  await db.prepare(
    "UPDATE sites SET revisions_count = revisions_count + 1, updated_at = ? WHERE id = ?"
  ).bind(new Date().toISOString(), siteId).run();

  const site = await db.prepare("SELECT revisions_count FROM sites WHERE id = ?").bind(siteId).first<{ revisions_count: number }>();
  return site?.revisions_count ?? 0;
}

export async function getJobWithSite(db: D1Database, jobId: string): Promise<{
  job: JobRow;
  site: SiteRow;
  client: ClientRow;
} | null> {
  const job = await fetchJob(db, jobId);
  if (!job) return null;

  const site = await getSite(db, job.site_id);
  if (!site) return null;

  const client = await getClientById(db, job.client_id);
  if (!client) return null;

  return { job, site, client };
}

export async function getLatestVersionForSite(db: D1Database, siteId: string): Promise<{
  id: string;
  version_number: number;
  deployed_worker_name: string | null;
  preview_url: string | null;
} | null> {
  return db.prepare(
    "SELECT id, version_number, deployed_worker_name, preview_url FROM site_versions WHERE site_id = ? ORDER BY version_number DESC LIMIT 1"
  ).bind(siteId).first();
}

export async function getWorkerNameForVersion(db: D1Database, versionId: string): Promise<string | null> {
  const result = await db.prepare(
    "SELECT deployed_worker_name FROM site_versions WHERE id = ?"
  ).bind(versionId).first<{ deployed_worker_name: string | null }>();
  return result?.deployed_worker_name ?? null;
}

// ── Phase 16.R3: append-only evidence attempts + current pointer ───────────
// All INSERTs; no upserts. Only promoteEvidenceAttempt mutates (the current
// pointer), in a single transaction. Prior attempts and evidence rows remain
// immutable and auditable.

export async function startEvidenceAttempt(
  db: D1Database,
  data: { id: string; job_id: string; client_slug: string; site_version: number; started_at: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_evidence_attempts (id, job_id, client_slug, site_version, status, started_at)
     VALUES (?, ?, ?, ?, 'in_progress', ?)`
  ).bind(data.id, data.job_id, data.client_slug, data.site_version, data.started_at).run();
}

export async function failEvidenceAttempt(
  db: D1Database,
  attemptId: string,
  failure: { code: string; message: string },
  completedAt: string
): Promise<void> {
  await db.prepare(
    `UPDATE reference_evidence_attempts SET status = 'failed', completed_at = ?, failure_code = ?, failure_message = ? WHERE id = ?`
  ).bind(completedAt, failure.code, failure.message, attemptId).run();
}

export async function promoteEvidenceAttempt(
  db: D1Database,
  attemptId: string,
  promotedAt: string
): Promise<void> {
  const attempt = await db.prepare(
    "SELECT job_id, site_version FROM reference_evidence_attempts WHERE id = ?"
  ).bind(attemptId).first<{ job_id: string; site_version: number }>();
  if (!attempt) throw new Error(`Evidence attempt ${attemptId} not found`);

  await db.batch([
    db.prepare(
      `UPDATE reference_evidence_attempts SET status = 'complete', completed_at = ? WHERE id = ?`
    ).bind(promotedAt, attemptId),
    db.prepare(
      `INSERT INTO reference_evidence_current (job_id, site_version, attempt_id, promoted_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(job_id, site_version) DO UPDATE SET
         attempt_id = excluded.attempt_id,
         promoted_at = excluded.promoted_at
       WHERE
         (SELECT rowid FROM reference_evidence_attempts WHERE id = excluded.attempt_id) >
         (SELECT rowid FROM reference_evidence_attempts WHERE id = reference_evidence_current.attempt_id)`
    ).bind(attempt.job_id, attempt.site_version, attemptId, promotedAt),
  ]);
}

export async function getCurrentEvidenceAttempt(
  db: D1Database,
  jobId: string,
  siteVersion: number
): Promise<EvidenceAttemptSummary | null> {
  const current = await db.prepare(
    `SELECT a.id AS attempt_id, a.job_id, a.client_slug, a.site_version, a.status,
            a.started_at, a.completed_at, a.failure_code, a.failure_message
     FROM reference_evidence_current c
     JOIN reference_evidence_attempts a ON a.id = c.attempt_id
     WHERE c.job_id = ? AND c.site_version = ?`
  ).bind(jobId, siteVersion).first<{
    attempt_id: string;
    job_id: string;
    client_slug: string;
    site_version: number;
    status: EvidenceAttemptSummary["status"];
    started_at: string;
    completed_at: string | null;
    failure_code: string | null;
    failure_message: string | null;
  }>();
  if (!current) return null;
  return {
    attemptId: current.attempt_id,
    jobId: current.job_id,
    clientSlug: current.client_slug,
    siteVersion: current.site_version,
    status: current.status,
    startedAt: current.started_at,
    completedAt: current.completed_at,
    failureCode: current.failure_code,
    failureMessage: current.failure_message,
  };
}

export async function createCaptureEvidence(
  db: D1Database,
  data: EvidenceReferenceCaptureRow
): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_capture_evidence_v2 (
      id, attempt_id, job_id, client_slug, site_version, viewport, http_status, status,
      diagnostics, raw_r2_key, screenshot_r2_key, capture_json_r2_key, checksum, captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.attempt_id, data.job_id, data.client_slug, data.site_version, data.viewport,
    data.http_status, data.status, data.diagnostics, data.raw_r2_key, data.screenshot_r2_key,
    data.capture_json_r2_key, data.checksum, data.captured_at, data.created_at
  ).run();
}

export async function getCaptureEvidenceForAttempt(
  db: D1Database,
  attemptId: string
): Promise<EvidenceReferenceCaptureRow[]> {
  const result = await db.prepare(
    "SELECT * FROM reference_capture_evidence_v2 WHERE attempt_id = ? ORDER BY viewport"
  ).bind(attemptId).all<EvidenceReferenceCaptureRow>();
  return result.results ?? [];
}

export async function createInteractionEvidence(
  db: D1Database,
  data: EvidenceInteractionRow
): Promise<void> {
  await db.prepare(
    `INSERT INTO reference_interaction_evidence_v2 (
      id, attempt_id, job_id, client_slug, site_version, viewport, motion_mode, status,
      observed_count, detected_count, inferred_count, reduced_motion_comparison,
      traces_r2_key, interactions_r2_key, raw_r2_key, checksum, captured_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.attempt_id, data.job_id, data.client_slug, data.site_version, data.viewport,
    data.motion_mode, data.status, data.observed_count, data.detected_count, data.inferred_count,
    data.reduced_motion_comparison, data.traces_r2_key, data.interactions_r2_key, data.raw_r2_key,
    data.checksum, data.captured_at, data.created_at
  ).run();
}

export async function getInteractionEvidenceForAttempt(
  db: D1Database,
  attemptId: string
): Promise<EvidenceInteractionRow[]> {
  const result = await db.prepare(
    "SELECT * FROM reference_interaction_evidence_v2 WHERE attempt_id = ? ORDER BY viewport, motion_mode"
  ).bind(attemptId).all<EvidenceInteractionRow>();
  return result.results ?? [];
}

export async function getEvidenceCurrent(
  db: D1Database,
  jobId: string,
  siteVersion: number
): Promise<EvidenceCurrentRow | null> {
  return db.prepare(
    "SELECT * FROM reference_evidence_current WHERE job_id = ? AND site_version = ?"
  ).bind(jobId, siteVersion).first<EvidenceCurrentRow>();
}

// ── Phase 16.R4: immutable blueprint registries + attempts + accepted pointer ─

export interface BlueprintRegistryRow {
  id: string; version: number; job_id: string; client_slug: string; site_version: number;
  evidence_attempt_id: string | null; registry_r2_key: string; screenshot_evidence_r2_key: string | null;
  checksum: string; created_at: string;
}

export interface BlueprintAttemptRow {
  id: string; registry_id: string; job_id: string; client_slug: string; site_version: number;
  attempt_number: number; schema_version: number; prompt_version: string | null;
  provider: string | null; model: string | null; design_r2_key: string | null;
  interaction_r2_key: string | null; validation_r2_key: string | null; review_r2_key: string | null;
  prompt_input_r2_key: string | null; overall_confidence: number | null; status: string;
  failure_code: string | null; failure_diagnostics: string | null;
  started_at: string; completed_at: string | null; created_at: string;
}

export async function createBlueprintRegistry(db: D1Database, data: BlueprintRegistryRow): Promise<void> {
  await db.prepare(
    `INSERT INTO blueprint_evidence_registries (
      id, version, job_id, client_slug, site_version, evidence_attempt_id,
      registry_r2_key, screenshot_evidence_r2_key, checksum, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.version, data.job_id, data.client_slug, data.site_version, data.evidence_attempt_id,
    data.registry_r2_key, data.screenshot_evidence_r2_key, data.checksum, data.created_at
  ).run();
}

export async function createBlueprintAttempt(db: D1Database, data: BlueprintAttemptRow): Promise<void> {
  await db.prepare(
    `INSERT INTO blueprint_attempts (
      id, registry_id, job_id, client_slug, site_version, attempt_number,
      schema_version, prompt_version, provider, model, design_r2_key, interaction_r2_key,
      validation_r2_key, review_r2_key, prompt_input_r2_key, overall_confidence, status,
      failure_code, failure_diagnostics, started_at, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    data.id, data.registry_id, data.job_id, data.client_slug, data.site_version, data.attempt_number,
    data.schema_version, data.prompt_version, data.provider, data.model, data.design_r2_key,
    data.interaction_r2_key, data.validation_r2_key, data.review_r2_key, data.prompt_input_r2_key,
    data.overall_confidence, data.status, data.failure_code, data.failure_diagnostics,
    data.started_at, data.completed_at, data.created_at
  ).run();
}

export async function completeBlueprintAttempt(
  db: D1Database,
  attemptId: string,
  data: { status: string; overallConfidence: number | null; completedAt: string; failureCode?: string | null; failureDiagnostics?: string | null }
): Promise<void> {
  await db.prepare(
    `UPDATE blueprint_attempts SET status = ?, overall_confidence = ?, completed_at = ?,
     failure_code = ?, failure_diagnostics = ? WHERE id = ?`
  ).bind(data.status, data.overallConfidence, data.completedAt, data.failureCode ?? null, data.failureDiagnostics ?? null, attemptId).run();
}

export async function getBlueprintAttempt(db: D1Database, attemptId: string): Promise<BlueprintAttemptRow | null> {
  return db.prepare("SELECT * FROM blueprint_attempts WHERE id = ?").bind(attemptId).first<BlueprintAttemptRow>();
}

// Promote an attempt to accepted only if its append-only row is newer than the
// current accepted row. The conditional upsert is one atomic D1 statement.
export async function promoteBlueprintAttempt(
  db: D1Database,
  attemptId: string,
  acceptedAt: string
): Promise<boolean> {
  const attempt = await db.prepare(
    "SELECT job_id, site_version FROM blueprint_attempts WHERE id = ?"
  ).bind(attemptId).first<{ job_id: string; site_version: number }>();
  if (!attempt) throw new Error(`Blueprint attempt ${attemptId} not found`);

  const result = await db.prepare(
    `INSERT INTO blueprint_accepted (job_id, site_version, accepted_attempt_id, accepted_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(job_id, site_version) DO UPDATE SET
       accepted_attempt_id = excluded.accepted_attempt_id,
       accepted_at = excluded.accepted_at
     WHERE
       (SELECT rowid FROM blueprint_attempts WHERE id = excluded.accepted_attempt_id) >
       (SELECT rowid FROM blueprint_attempts WHERE id = blueprint_accepted.accepted_attempt_id)`
  ).bind(attempt.job_id, attempt.site_version, attemptId, acceptedAt).run();
  return result.meta.changes > 0;
}

export async function createProvenanceArtifact(
  db: D1Database,
  data: {
    id: string;
    job_id: string;
    site_version_id: string;
    site_version: number;
    schema_version: number;
    parent_artifact_id: string | null;
    r2_key: string;
    manifest_json: string;
    validation_json: string;
    created_at: string;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO provenance_artifacts (
      id, job_id, site_version_id, site_version, schema_version,
      parent_artifact_id, r2_key, manifest_json, validation_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING`
  ).bind(
    data.id, data.job_id, data.site_version_id, data.site_version, data.schema_version,
    data.parent_artifact_id, data.r2_key, data.manifest_json, data.validation_json, data.created_at
  ).run();

  const stored = await db.prepare(
    `SELECT job_id, site_version_id, site_version, schema_version, parent_artifact_id,
            r2_key, manifest_json, validation_json, created_at
     FROM provenance_artifacts WHERE id = ?`
  ).bind(data.id).first<Record<string, unknown>>();
  const expected: Record<string, unknown> = {
    job_id: data.job_id,
    site_version_id: data.site_version_id,
    site_version: data.site_version,
    schema_version: data.schema_version,
    parent_artifact_id: data.parent_artifact_id,
    r2_key: data.r2_key,
    manifest_json: data.manifest_json,
    validation_json: data.validation_json,
    created_at: data.created_at,
  };
  if (!stored || Object.entries(expected).some(([key, value]) => stored[key] !== value)) {
    throw new Error(`Provenance artifact ${data.id} conflicts with an existing immutable record.`);
  }
}

export async function getAcceptedBlueprintAttempt(db: D1Database, jobId: string, siteVersion: number): Promise<BlueprintAttemptRow | null> {
  return db.prepare(
    `SELECT a.* FROM blueprint_attempts a
     JOIN blueprint_accepted x ON x.accepted_attempt_id = a.id
     WHERE x.job_id = ? AND x.site_version = ?`
  ).bind(jobId, siteVersion).first<BlueprintAttemptRow>();
}

export async function getBlueprintRegistriesForJob(db: D1Database, jobId: string, siteVersion: number): Promise<BlueprintRegistryRow[]> {
  const result = await db.prepare(
    "SELECT * FROM blueprint_evidence_registries WHERE job_id = ? AND site_version = ? ORDER BY version DESC"
  ).bind(jobId, siteVersion).all<BlueprintRegistryRow>();
  return result.results ?? [];
}
