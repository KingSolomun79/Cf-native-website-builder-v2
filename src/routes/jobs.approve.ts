import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyApprovalToken, generateId, nowIso, sendWorkflowEvent } from "../lib/crypto";
import { fetchJob, updateJobStatus } from "../lib/db";
import { escapeHtml } from "../lib/html";

export async function approveJob(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId");
  const token = c.req.header("Authorization")?.replace("Bearer ", "") ?? new URL(c.req.url).searchParams.get("token");

  if (!token) {
    return c.json({ error: "Missing approval token" }, 401);
  }

  const payload = await verifyApprovalToken(c.env, token);
  if (!payload || payload.jobId !== jobId || payload.action !== "approve") {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const job = await fetchJob(c.env.DB, jobId);
  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "waiting_approval") {
    return c.json({ error: `Job is not waiting for approval (current: ${job.status})` }, 409);
  }

  if (c.req.method === "GET") {
    return new Response(buildApprovalForm(jobId, token), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const now = nowIso();

  await c.env.DB.prepare(
    `INSERT INTO approvals (id, job_id, status, signed_token_hash, requested_at, responded_at)
     VALUES (?, ?, 'approved', ?, ?, ?)`
  ).bind(generateId(), jobId, await hashToken(token), job.created_at, now).run();

  try {
    await sendWorkflowEvent(c.env.SITE_BUILD_WORKFLOW, jobId, { status: "approved" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateJobStatus(c.env.DB, jobId, "waiting_approval", { current_step: "awaiting_human_review", error_message: `Workflow event send failed: ${message}` });
    return c.json({ error: "Failed to deliver approval to workflow — please retry", details: message }, 502);
  }

  await updateJobStatus(c.env.DB, jobId, "running", { current_step: "production_deployment" });

  if (c.req.header("Accept")?.includes("text/html")) {
    return new Response(buildConfirmationHtml("Approved", "The site has been approved. Production deployment is now in progress — you will receive a confirmation email shortly."), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return c.json({ ok: true, status: "approved", message: "Production deployment initiated via workflow" });
}

function buildApprovalForm(jobId: string, token: string): string {
  const action = escapeHtml(`/api/jobs/${encodeURIComponent(jobId)}/approve?token=${encodeURIComponent(token)}`);
  return buildConfirmationHtml(
    "Confirm approval",
    `Review the preview before continuing. Approval starts the production deployment.<form method="post" action="${action}"><button type="submit">Approve and deploy</button></form>`
  );
}

function buildConfirmationHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #000; padding: 4rem 2rem; }
    .container { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    p { color: #525252; margin-top: 0.5rem; }
    form { margin-top: 1.5rem; }
    button { border: 0; background: #16a34a; color: #fff; padding: 0.75rem 1rem; font: inherit; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    <div class="message">${message}</div>
  </div>
</body>
</html>`;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
