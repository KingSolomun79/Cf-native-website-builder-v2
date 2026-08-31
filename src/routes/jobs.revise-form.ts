import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyApprovalToken } from "../lib/crypto";
import { fetchJob } from "../lib/db";

export async function showReviseForm(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId");
  const token = new URL(c.req.url).searchParams.get("token");

  if (!token) {
    return new Response("Missing token", { status: 401 });
  }

  const payload = await verifyApprovalToken(c.env, token);
  if (!payload || payload.jobId !== jobId || payload.action !== "revise") {
    return new Response("Invalid or expired token", { status: 401 });
  }

  const job = await fetchJob(c.env.DB, jobId);
  if (!job || job.status !== "waiting_approval") {
    return new Response("Job not found or not awaiting approval", { status: 404 });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request Revision — Job ${jobId.slice(0, 8)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #000; padding: 4rem 2rem; }
    .container { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    p.subtitle { color: #525252; margin-bottom: 2rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; }
    textarea { width: 100%; min-height: 200px; padding: 1rem; border: 2px solid #000; font-size: 1rem; font-family: inherit; resize: vertical; margin-bottom: 1.5rem; }
    textarea:focus { outline: none; border-width: 3px; }
    .actions { display: flex; gap: 1rem; }
    button { padding: 0.75rem 2rem; font-size: 0.875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; border: 2px solid #000; }
    .btn-primary { background: #000; color: #fff; }
    .btn-secondary { background: transparent; color: #000; }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #dc2626; margin-bottom: 1rem; display: none; padding: 0.75rem; background: #fef2f2; }
    .success { color: #16a34a; margin-bottom: 1rem; display: none; padding: 0.75rem; background: #f0fdf4; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Request Revision</h1>
    <p class="subtitle">Job ${jobId.slice(0, 8)}</p>
    <div class="error" id="error"></div>
    <div class="success" id="success" style="display:none;">
      Revision submitted. The site will be updated and you will receive a new preview email.
    </div>
    <form id="reviseForm">
      <label for="prompt">Describe the changes you want</label>
      <textarea id="prompt" name="prompt" required placeholder="e.g. Change the hero heading to..."></textarea>
      <div class="actions">
        <button type="submit" class="btn-primary" id="submitBtn">Submit Revision</button>
      </div>
    </form>
  </div>
  <script>
    document.getElementById('reviseForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      var errorEl = document.getElementById('error');
      var successEl = document.getElementById('success');
      var submitBtn = document.getElementById('submitBtn');
      errorEl.style.display = 'none';
      successEl.style.display = 'none';
      var prompt = document.getElementById('prompt').value.trim();
      if (!prompt) { errorEl.textContent = 'Please describe the changes.'; errorEl.style.display = 'block'; return; }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
      try {
        var resp = await fetch('/api/jobs/${jobId}/revise?token=${token}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        var data = await resp.json();
        if (!resp.ok) { errorEl.textContent = data.error || 'Request failed.'; errorEl.style.display = 'block'; submitBtn.disabled = false; submitBtn.textContent = 'Submit Revision'; return; }
        successEl.style.display = 'block';
        document.getElementById('reviseForm').style.display = 'none';
      } catch (err) {
        errorEl.textContent = 'There was a connection issue, but your revision may have been submitted. Please check your email for updates before trying again.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Try Again';
      }
    });
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
