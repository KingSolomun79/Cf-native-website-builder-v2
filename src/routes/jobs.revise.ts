import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyApprovalToken, generateId, nowIso, sendWorkflowEvent } from "../lib/crypto";
import { fetchJob, updateJobStatus, getSite } from "../lib/db";

export async function reviseJob(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId");
  const token = c.req.header("Authorization")?.replace("Bearer ", "") ?? new URL(c.req.url).searchParams.get("token");

  if (!token) {
    return c.json({ error: "Missing approval token" }, 401);
  }

  const payload = await verifyApprovalToken(c.env, token);
  if (!payload || payload.jobId !== jobId || payload.action !== "revise") {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const job = await fetchJob(c.env.DB, jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "waiting_approval") {
    return c.json({ error: `Job is not waiting for approval (current: ${job.status})` }, 409);
  }

  const site = await getSite(c.env.DB, job.site_id);
  if (!site) {
    return c.json({ error: "Site not found" }, 404);
  }

  const maxRevisions = parseInt(c.env.MAX_REVISIONS ?? "3", 10);
  if (site.revisions_count >= maxRevisions) {
    return c.json(
      { error: "Maximum revisions reached. Approve or reject." },
      409
    );
  }

  const body = await c.req.json<{ prompt: string; reviewerEmail?: string }>();
  if (!body.prompt?.trim()) {
    return c.json({ error: "Revision prompt is required" }, 400);
  }

  const now = nowIso();
  const revisionId = generateId();

  await c.env.DB.prepare(
    `INSERT INTO approvals (id, job_id, status, signed_token_hash, requested_at, responded_at, response_note)
     VALUES (?, ?, 'revise_requested', ?, ?, ?, ?)`
  ).bind(generateId(), jobId, await hashToken(token), job.created_at, now, body.prompt).run();

  await c.env.DB.prepare(
    `INSERT INTO revisions (id, site_id, parent_site_version_id, requested_by_email, revision_prompt, revision_number, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)`
  ).bind(
    revisionId,
    job.site_id,
    site.current_version_id ?? "",
    body.reviewerEmail ?? null,
    body.prompt.trim(),
    site.revisions_count + 1,
    now
  ).run();

  await c.env.DB.prepare(
    `UPDATE sites SET revisions_count = revisions_count + 1, updated_at = ? WHERE id = ?`
  ).bind(now, job.site_id).run();

  await updateJobStatus(c.env.DB, jobId, "running", { current_step: "revision" });

  await sendWorkflowEvent(c.env.SITE_BUILD_WORKFLOW, jobId, { status: "revise_requested", prompt: body.prompt.trim() });

  return c.json({ ok: true, status: "revise_requested", revisionId });
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
