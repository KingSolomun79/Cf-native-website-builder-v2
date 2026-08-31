import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyApprovalToken } from "../lib/crypto";
import { fetchJob, getClientById } from "../lib/db";
import { escapeHtml } from "../lib/html";

export async function showInputForm(c: Context<{ Bindings: Env }>): Promise<Response> {
  const jobId = c.req.param("jobId");
  const token = c.req.query("token");

  if (!token) {
    return c.text("Missing token", 401);
  }

  const payload = await verifyApprovalToken(c.env, token);
  if (!payload || payload.jobId !== jobId || payload.action !== "input") {
    return c.text("Invalid or expired token", 403);
  }

  const job = await fetchJob(c.env.DB, jobId);
  if (!job) {
    return c.text("Job not found", 404);
  }

  if (job.status !== "needs_input") {
    return c.text(`Job is in state '${job.status}' and does not need input.`, 400);
  }

  const client = await getClientById(c.env.DB, job.client_id);
  if (!client) {
    return c.text("Client not found", 404);
  }

  const safeCompanyName = escapeHtml(client.company_name);
  const safeBusinessType = escapeHtml(client.business_type ?? "N/A");
  const safeJobId = escapeHtml(jobId);
  const safeToken = escapeHtml(token);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Provide Reference - ${safeCompanyName}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f5; color: #18181b; padding: 2rem; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
    h1 { margin-top: 0; font-size: 1.5rem; color: #18181b; border-bottom: 1px solid #e4e4e7; padding-bottom: 1rem; }
    .info { background: #fafafa; padding: 1rem; border-radius: 6px; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .info p { margin: 0.5rem 0; }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; font-weight: 500; margin-bottom: 0.5rem; }
    input[type="url"], input[type="file"] { width: 100%; padding: 0.5rem; border: 1px solid #d4d4d8; border-radius: 4px; box-sizing: border-box; }
    .or-divider { text-align: center; margin: 1rem 0; font-weight: bold; color: #71717a; text-transform: uppercase; font-size: 0.8rem; }
    button { background: #000; color: #fff; padding: 0.75rem 1.5rem; border: none; border-radius: 4px; font-weight: 500; cursor: pointer; width: 100%; }
    button:hover { background: #27272a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Provide Reference URL &amp; Screenshot</h1>

    <div class="info">
      <p><strong>Client:</strong> ${safeCompanyName}</p>
      <p><strong>Design Source:</strong> Reference URL and full-page screenshot</p>
      <p><strong>Business Type:</strong> ${safeBusinessType}</p>
    </div>

    <form method="POST" action="/api/jobs/${safeJobId}/input" enctype="multipart/form-data">
      <input type="hidden" name="token" value="${safeToken}" />

      <div class="form-group">
        <label for="referenceSiteUrl">Reference Site URL <span style="color:#dc2626;">*</span></label>
        <input type="url" id="referenceSiteUrl" name="referenceSiteUrl" placeholder="https://example.com" required />
        <small style="color: #71717a; display: block; margin-top: 0.25rem;">The live reference website whose design we should follow.</small>
      </div>

      <div class="form-group">
        <label for="screenshot">Full-Page Homepage Screenshot <span style="color:#dc2626;">*</span></label>
        <input type="file" id="screenshot" name="screenshot" accept="image/png" required />
        <small style="color: #71717a; display: block; margin-top: 0.25rem;">Upload a full-page PNG screenshot of the reference site's homepage (at least 1024x768, maximum 10 MB).</small>
      </div>

      <button type="submit">Start Build Workflow</button>
    </form>
  </div>

  <script>
    const form = document.querySelector('form');
    const urlInput = document.getElementById('referenceSiteUrl');
    const fileInput = document.getElementById('screenshot');

    form.addEventListener('submit', (e) => {
      const missing = [];
      if (!urlInput.value) missing.push('a Reference Site URL');
      if (!fileInput.files.length) missing.push('a Full-Page Homepage Screenshot');
      if (missing.length) {
        e.preventDefault();
        alert('Both references are required. Please provide ' + missing.join(' and ') + '.');
      }
    });
  </script>
</body>
</html>
  `;

  return c.html(html);
}
