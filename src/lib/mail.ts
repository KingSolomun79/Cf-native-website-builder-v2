import type { Env } from "../env.d";

interface Smtp2GoRequest {
  api_key: string;
  to: string[];
  sender: string;
  subject: string;
  html_body: string;
  text_body?: string;
}

interface Smtp2GoResponse {
  data?: {
    succeeded?: number;
    failed?: number;
    error_code?: string | number;
    error?: string;
    email_id?: string;
    schedule_id?: string;
  };
}

export async function sendEmail(
  env: Env,
  params: {
    to: string | string[];
    sender?: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
  }
): Promise<{ success: boolean; emailId?: string; error?: string }> {
  const sender = params.sender ?? "info@wazibiz.ke";
  const to = Array.isArray(params.to) ? params.to : [params.to];

  const body: Smtp2GoRequest = {
    api_key: env.SMTP2GO_API_KEY,
    to,
    sender,
    subject: params.subject,
    html_body: params.htmlBody,
    text_body: params.textBody,
  };

  const response = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as Smtp2GoResponse;
  const data = result.data;
  const succeeded = Number(data?.succeeded ?? 0);
  const failed = Number(data?.failed ?? 0);
  const accepted = Boolean(data && (succeeded > 0 || data.email_id || data.schedule_id));
  const errorCode = data?.error_code;
  const rejectedByCode = errorCode !== undefined && errorCode !== null && String(errorCode) !== "" && Number(errorCode) !== 0;

  if (!response.ok || !accepted || failed > 0 || rejectedByCode) {
    return { success: false, error: data?.error || `SMTP2Go rejected the message with HTTP ${response.status}` };
  }

  return { success: true, emailId: data?.email_id ?? data?.schedule_id };
}

export async function sendInternalNotification(
  env: Env,
  params: {
    subject: string;
    htmlBody: string;
  }
): Promise<{ success: boolean; emailId?: string; error?: string }> {
  return sendEmail(env, {
    to: env.INTERNAL_NOTIFICATION_EMAIL,
    subject: `[WaziWebsites] ${params.subject}`,
    htmlBody: params.htmlBody,
  });
}

export async function sendContactFormEmail(
  env: Env,
  params: {
    clientEmail: string;
    companyName: string;
    senderName: string;
    senderEmail: string;
    senderPhone?: string;
    subject: string;
    message: string;
  }
): Promise<{ success: boolean; emailId?: string; error?: string }> {
  const htmlBody = `
    <h2>New enquiry from ${params.companyName} website</h2>
    <table style="border-collapse:collapse;width:100%;max-width:600px;">
      <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;width:120px;">Name</td><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(params.senderName)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Email</td><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(params.senderEmail)}</td></tr>
      ${params.senderPhone ? `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Phone</td><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(params.senderPhone)}</td></tr>` : ""}
      <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Subject</td><td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(params.subject)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;vertical-align:top;">Message</td><td style="padding:8px;border-bottom:1px solid #eee;white-space:pre-wrap;">${escapeHtml(params.message)}</td></tr>
    </table>
  `;

  return sendEmail(env, {
    to: params.clientEmail,
    sender: "noreply@wazibiz.ke",
    subject: `New enquiry from ${params.companyName} website`,
    htmlBody,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendPreviewEmail(
  env: Env,
  params: {
    companyName: string;
    previewUrl: string;
    jobId: string;
    qaVerdict: string;
    criticalCount: number;
    topIssues: Array<{ severity: string; page: string; issue: string }>;
    desktopScreenshotUrl?: string;
    mobileScreenshotUrl?: string;
    approveToken: string;
    reviseToken: string;
    rejectToken: string;
  }
): Promise<{ success: boolean; emailId?: string; error?: string }> {
  const siteUrl = env.PUBLIC_APP_URL;

  const verdictBadge = params.qaVerdict === "pass"
    ? `<span style="display:inline-block;padding:4px 12px;background:#16a34a;color:#fff;border-radius:4px;font-size:14px;font-weight:600;">PASS</span>`
    : params.qaVerdict === "pass_with_minor_issues"
    ? `<span style="display:inline-block;padding:4px 12px;background:#ca8a04;color:#fff;border-radius:4px;font-size:14px;font-weight:600;">PASS (minor issues)</span>`
    : params.qaVerdict === "needs_revision"
    ? `<span style="display:inline-block;padding:4px 12px;background:#ea580c;color:#fff;border-radius:4px;font-size:14px;font-weight:600;">NEEDS REVISION</span>`
    : `<span style="display:inline-block;padding:4px 12px;background:#dc2626;color:#fff;border-radius:4px;font-size:14px;font-weight:600;">FAILED</span>`;

  const topIssuesHtml = params.topIssues.length > 0
    ? `<h3 style="margin-top:16px;font-size:16px;">Top Issues</h3><ul style="margin:8px 0;padding-left:20px;">${params.topIssues.map((i) => `<li style="margin-bottom:6px;"><strong>[${i.severity}]</strong> ${escapeHtml(i.page)}: ${escapeHtml(i.issue)}</li>`).join("")}</ul>`
    : "";

  const htmlBody = `
<div style="max-width:600px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#000;">
  <h1 style="font-size:24px;margin-bottom:4px;">Preview Ready</h1>
  <p style="color:#525252;margin-bottom:4px;">${escapeHtml(params.companyName)}</p>
  <p style="color:#737373;font-size:12px;margin-bottom:16px;font-family:monospace;">Job ID: ${escapeHtml(params.jobId)}</p>
  <p>QA Verdict: ${verdictBadge}</p>
  ${params.criticalCount > 0 ? `<p style="color:#dc2626;font-weight:600;">${params.criticalCount} critical issue(s) found.</p>` : ""}
  ${topIssuesHtml}
  <h3 style="margin-top:24px;font-size:16px;">Preview</h3>
  <p><a href="${params.previewUrl}" style="display:inline-block;padding:10px 20px;background:#000;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">View Preview</a></p>
  <h3 style="margin-top:24px;font-size:16px;">Actions</h3>
  <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">
    <a href="${siteUrl}/api/jobs/${params.jobId}/approve?token=${params.approveToken}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Approve</a>
    <a href="${siteUrl}/api/jobs/${params.jobId}/revise-form?token=${params.reviseToken}" style="display:inline-block;padding:10px 20px;background:#ea580c;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Request Revision</a>
    <a href="${siteUrl}/api/jobs/${params.jobId}/reject?token=${params.rejectToken}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;font-size:14px;font-weight:600;">Reject</a>
  </div>
</div>`;

  return sendInternalNotification(env, {
    subject: `Preview ready — ${params.companyName}`,
    htmlBody,
  });
}
