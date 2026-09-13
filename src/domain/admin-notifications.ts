// Idempotent admin-notification ledger (operator GO 2026-09-12, client intake
// layer). One row per LOGICAL event (dedupe_key UNIQUE) — workflow-step
// retries, repeated sweeps and concurrent callers can never produce duplicate
// emails. Delivery rides a separate ADMIN_EMAIL Cloudflare Email Service
// binding (never the visitor-form EMAIL transport, never a browser-controlled
// recipient); bounded retry runs on the EXISTING cron sweep. Email failure
// never rolls back the event that triggered the notification.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { classifyEmailErrorCode, resolvePlatformSenderIdentity, type EmailSendResult } from "./form-service";

export const MAX_NOTIFICATION_ATTEMPTS = 5;
// Attempt schedule: 0 (inline), then ~1m, ~5m, ~25m, ~2h via the cron sweep.
const RETRY_BACKOFF_MS = [60_000, 300_000, 1_500_000, 7_200_000];
// A claimed send that crashed before completion is reclaimable after this long.
const STALE_SENDING_AFTER_MS = 5 * 60_000;

export type AdminNotificationKind =
  | "INTAKE_NEW"
  | "SITE_READY"
  | "SITE_HUMAN_REVIEW"
  | "GENERATION_FAILED";

export interface EnqueueAdminNotificationInput {
  kind: AdminNotificationKind;
  dedupeKey: string;
  subject: string;
  bodyText: string;
}

/** Idempotent enqueue: the UNIQUE dedupe_key makes repeated calls no-ops. */
export async function enqueueAdminNotification(env: Env, input: EnqueueAdminNotificationInput): Promise<boolean> {
  const result = await env.DB.prepare(
    `INSERT INTO admin_notifications (id, kind, dedupe_key, status, attempts, subject, body_text, created_at)
     VALUES (?, ?, ?, 'PENDING', 0, ?, ?, ?)
     ON CONFLICT (dedupe_key) DO NOTHING`
  )
    .bind(generateId(), input.kind, input.dedupeKey, input.subject, input.bodyText, nowIso())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

function resolveAdminRecipient(env: Env): string | null {
  const raw = env.WAZIBIZ_ADMIN_EMAIL?.trim();
  return raw && raw.includes("@") ? raw : null;
}

/** Admin transport: the dedicated ADMIN_EMAIL binding — separate from the
 *  visitor-form EMAIL binding, with the platform Sender Identity as From. */
export function createAdminEmailTransport(env: Env): (input: { subject: string; text: string }) => Promise<EmailSendResult> {
  return async (input) => {
    const adminEmail = env.ADMIN_EMAIL;
    if (!adminEmail) {
      return { ok: false, classification: "transient", error: "admin email transport not configured" };
    }
    const from = resolvePlatformSenderIdentity(env);
    const to = resolveAdminRecipient(env);
    if (!from || !to) {
      return { ok: false, classification: "permanent", error: "admin notification sender/recipient not configured" };
    }
    try {
      await adminEmail.send({ to, from, subject: input.subject, text: input.text });
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const errorCode = typeof code === "string" ? code : "";
      return {
        ok: false,
        classification: classifyEmailErrorCode(errorCode),
        error: errorCode || "admin email send failed without a documented code",
      };
    }
  };
}

/** ONE best-effort send for a PENDING notification (used inline right after
 *  enqueue). Claims the row atomically first so a concurrent cron sweep or
 *  workflow retry cannot double-send. Failures leave the ledger row for the
 *  bounded cron retry — the caller's outcome never depends on delivery. */
export async function attemptAdminNotificationSend(env: Env, dedupeKey: string): Promise<void> {
  const claimed = await env.DB.prepare(
    `UPDATE admin_notifications SET status = 'SENDING', attempts = attempts + 1
     WHERE dedupe_key = ? AND status = 'PENDING'`
  )
    .bind(dedupeKey)
    .run();
  if ((claimed.meta.changes ?? 0) === 0) return;

  const row = await env.DB.prepare("SELECT id, subject, body_text, attempts FROM admin_notifications WHERE dedupe_key = ?")
    .bind(dedupeKey)
    .first<{ id: string; subject: string; body_text: string; attempts: number }>();
  if (!row) return;

  const result = await createAdminEmailTransport(env)({ subject: row.subject, text: row.body_text });
  if (result.ok) {
    await env.DB.prepare("UPDATE admin_notifications SET status = 'SENT', sent_at = ? WHERE id = ?")
      .bind(nowIso(), row.id)
      .run();
    return;
  }
  if (result.classification === "permanent") {
    await env.DB.prepare("UPDATE admin_notifications SET status = 'PERMANENT_FAILED', last_error = ? WHERE id = ?")
      .bind(result.error.slice(0, 250), row.id)
      .run();
    return;
  }
  const backoff = RETRY_BACKOFF_MS[Math.min(row.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
  await env.DB.prepare(
    "UPDATE admin_notifications SET status = 'PENDING', last_error = ?, next_attempt_after = ? WHERE id = ?"
  )
    .bind(result.error.slice(0, 250), new Date(Date.now() + backoff).toISOString(), row.id)
    .run();
}

/** Cron sweep: bounded retry for PENDING notifications past their backoff and
 *  SENDING rows stranded by a crash. Runs on the existing cron trigger. */
export async function processDueAdminNotifications(env: Env): Promise<number> {
  const transport = createAdminEmailTransport(env);
  const now = nowIso();
  const staleSendingBefore = new Date(Date.now() - STALE_SENDING_AFTER_MS).toISOString();

  const due = await env.DB.prepare(
    `SELECT id, subject, body_text, attempts FROM admin_notifications
     WHERE (status = 'PENDING' AND (next_attempt_after IS NULL OR next_attempt_after <= ?1))
        OR (status = 'SENDING' AND created_at <= ?2)
     ORDER BY created_at LIMIT 10`
  )
    .bind(now, staleSendingBefore)
    .all<{ id: string; subject: string; body_text: string; attempts: number }>();

  let processed = 0;
  for (const row of due.results ?? []) {
    if (row.attempts >= MAX_NOTIFICATION_ATTEMPTS) continue;
    const claimed = await env.DB.prepare(
      `UPDATE admin_notifications SET status = 'SENDING', attempts = attempts + 1
       WHERE id = ? AND (status = 'PENDING' OR (status = 'SENDING' AND attempts = ?))`
    )
      .bind(row.id, row.attempts)
      .run();
    if ((claimed.meta.changes ?? 0) === 0) continue;

    const result = await transport({ subject: row.subject, text: row.body_text });
    processed++;
    if (result.ok) {
      await env.DB.prepare("UPDATE admin_notifications SET status = 'SENT', sent_at = ? WHERE id = ?")
        .bind(nowIso(), row.id)
        .run();
    } else if (result.classification === "permanent" || row.attempts + 1 >= MAX_NOTIFICATION_ATTEMPTS) {
      await env.DB.prepare("UPDATE admin_notifications SET status = 'PERMANENT_FAILED', last_error = ? WHERE id = ?")
        .bind(result.error.slice(0, 250), row.id)
        .run();
    } else {
      const backoff = RETRY_BACKOFF_MS[Math.min(row.attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      await env.DB.prepare(
        "UPDATE admin_notifications SET status = 'PENDING', last_error = ?, next_attempt_after = ? WHERE id = ?"
      )
        .bind(result.error.slice(0, 250), new Date(Date.now() + backoff).toISOString(), row.id)
        .run();
    }
  }
  return processed;
}

// ── Email composers ──────────────────────────────────────────────────────────

export function adminDashboardLink(env: Env, path: string): string {
  const base = (env.ADMIN_DASHBOARD_BASE_URL ?? env.PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

export interface NewIntakeEmailInput {
  draftId: string;
  businessName: string;
  submitterName: string;
  submitterEmail: string;
}

export function composeNewIntakeEmail(env: Env, input: NewIntakeEmailInput): { subject: string; bodyText: string; dedupeKey: string } {
  return {
    subject: `New Wazibiz website brief — ${input.businessName}`,
    bodyText: [
      `A new client website brief was submitted.`,
      ``,
      `Business: ${input.businessName}`,
      `Submitter: ${input.submitterName} <${input.submitterEmail}>`,
      `Submitted: ${nowIso()}`,
      ``,
      `Review it here: ${adminDashboardLink(env, `/admin/intakes/${input.draftId}`)}`,
    ].join("\n"),
    dedupeKey: `intake-new:${input.draftId}`,
  };
}

export interface SiteReadyEmailInput {
  buildId: string;
  siteId: string;
  businessName: string;
  buildVersionLabel: string;
  visualScore: string;
  previewUrl: string | null;
}

export function composeSiteReadyEmail(env: Env, input: SiteReadyEmailInput): { subject: string; bodyText: string; dedupeKey: string } {
  return {
    subject: `Website ready for approval — ${input.businessName}`,
    bodyText: [
      `A generated website reached RELEASE_READY.`,
      ``,
      `Business: ${input.businessName}`,
      `Build Version: ${input.buildVersionLabel}`,
      `Visual score: ${input.visualScore}`,
      `Preview: ${input.previewUrl ?? "(preview URL unavailable)"}`,
      ``,
      `Review it here: ${adminDashboardLink(env, `/admin/sites/${input.siteId}`)}`,
      ``,
      `A preview-ready email is NOT an Approval — Approval and Publication remain separate operator actions.`,
    ].join("\n"),
    dedupeKey: `build-terminal:${input.buildId}:RELEASE_READY`,
  };
}

export function composeHumanReviewEmail(env: Env, input: SiteReadyEmailInput): { subject: string; bodyText: string; dedupeKey: string } {
  return {
    subject: `Website ready for human review — ${input.businessName}`,
    bodyText: [
      `A generated website reached HUMAN_REVIEW_REQUIRED and needs design judgement before further action.`,
      ``,
      `Business: ${input.businessName}`,
      `Build Version: ${input.buildVersionLabel}`,
      `Visual score: ${input.visualScore}`,
      `Preview: ${input.previewUrl ?? "(preview URL unavailable)"}`,
      ``,
      `Review it here: ${adminDashboardLink(env, `/admin/sites/${input.siteId}`)}`,
    ].join("\n"),
    dedupeKey: `build-terminal:${input.buildId}:HUMAN_REVIEW_REQUIRED`,
  };
}

export function composeGenerationFailedEmail(
  env: Env,
  input: { buildId: string; siteId: string; businessName: string; terminal: string; reason: string }
): { subject: string; bodyText: string; dedupeKey: string } {
  return {
    subject: `Website generation failed — ${input.businessName}`,
    bodyText: [
      `A website generation ended in ${input.terminal}.`,
      ``,
      `Business: ${input.businessName}`,
      `Build: ${input.buildId}`,
      `Reason: ${input.reason.slice(0, 300)}`,
      ``,
      `Open it here: ${adminDashboardLink(env, `/admin/sites/${input.siteId}`)}`,
    ].join("\n"),
    dedupeKey: `build-terminal:${input.buildId}:${input.terminal}`,
  };
}

// ── Terminal-state hooks (best-effort; pipeline outcome never depends on them) ─

export interface BuildTerminalNotificationInput {
  buildId: string;
  siteId: string;
  terminal: "RELEASE_READY" | "HUMAN_REVIEW_REQUIRED" | "DEGRADED" | "FAILED";
  buildVersionId: string | null;
  previewUrl: string | null;
  reasons: string[];
}

async function businessNameForSite(env: Env, siteId: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT b.name AS name FROM site_identities s JOIN businesses b ON b.id = s.business_id WHERE s.id = ?"
  )
    .bind(siteId)
    .first<{ name: string }>();
  return row?.name ?? siteId;
}

function visualScoreFromReasons(reasons: string[]): string {
  const joined = reasons.join(" ");
  const match = joined.match(/visual (\d+)/);
  return match ? match[1] : "n/a";
}

async function buildVersionLabel(env: Env, buildId: string, buildVersionId: string | null): Promise<string> {
  if (buildVersionId) {
    const row = await env.DB.prepare("SELECT version_number FROM build_versions WHERE id = ?")
      .bind(buildVersionId)
      .first<{ version_number: number }>();
    if (row) return `v${row.version_number} (${buildId.slice(0, 8)})`;
  }
  const latest = await env.DB.prepare("SELECT MAX(version_number) AS n FROM build_versions WHERE build_id = ?")
    .bind(buildId)
    .first<{ n: number | null }>();
  return latest?.n ? `v${latest.n} (${buildId.slice(0, 8)})` : buildId.slice(0, 8);
}

/**
 * Enqueues + best-effort sends the terminal admin notification for one Build.
 * Idempotent by construction (ledger dedupe key) — workflow-step retries and
 * replays can never duplicate the email; delivery failure is invisible to the
 * pipeline outcome.
 */
export async function notifyBuildTerminal(env: Env, input: BuildTerminalNotificationInput): Promise<void> {
  if (input.terminal !== "RELEASE_READY" && input.terminal !== "HUMAN_REVIEW_REQUIRED" && input.terminal !== "DEGRADED" && input.terminal !== "FAILED") {
    return;
  }
  const businessName = await businessNameForSite(env, input.siteId);
  const versionLabel = await buildVersionLabel(env, input.buildId, input.buildVersionId);
  const visualScore = visualScoreFromReasons(input.reasons);
  let composed: { subject: string; bodyText: string; dedupeKey: string };
  if (input.terminal === "RELEASE_READY") {
    composed = composeSiteReadyEmail(env, { buildId: input.buildId, siteId: input.siteId, businessName, buildVersionLabel: versionLabel, visualScore, previewUrl: input.previewUrl });
  } else if (input.terminal === "HUMAN_REVIEW_REQUIRED") {
    composed = composeHumanReviewEmail(env, { buildId: input.buildId, siteId: input.siteId, businessName, buildVersionLabel: versionLabel, visualScore, previewUrl: input.previewUrl });
  } else {
    composed = composeGenerationFailedEmail(env, { buildId: input.buildId, siteId: input.siteId, businessName, terminal: input.terminal, reason: input.reasons.join("; ") });
  }
  await enqueueAdminNotification(env, { kind: input.terminal === "RELEASE_READY" ? "SITE_READY" : input.terminal === "HUMAN_REVIEW_REQUIRED" ? "SITE_HUMAN_REVIEW" : "GENERATION_FAILED", ...composed });
  await attemptAdminNotificationSend(env, composed.dedupeKey);
}
