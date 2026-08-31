export interface ContactWorkerOptions {
  recipient: { type: "literal"; value: string } | { type: "binding"; name: string };
  sender?: string;
}

function recipientExpression(recipient: ContactWorkerOptions["recipient"]): string {
  return recipient.type === "literal"
    ? JSON.stringify(recipient.value)
    : `env[${JSON.stringify(recipient.name)}]`;
}

export function buildContactWorker(options: ContactWorkerOptions): string {
  const recipient = recipientExpression(options.recipient);
  const sender = JSON.stringify(options.sender ?? "noreply@wazibiz.ke");

  return `export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleContact(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!body.name || !body.email || !body.message) {
    return json({ error: "Name, email, and message are required" }, 400);
  }

  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  if (!emailRegex.test(body.email)) {
    return json({ error: "Invalid email format" }, 400);
  }

  try {
    const smtpResult = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.SMTP2GO_API_KEY,
        to: [${recipient}],
        sender: ${sender},
        subject: "New enquiry from website",
        html_body: "<h2>New Enquiry</h2>" +
          "<p><strong>Name:</strong> " + escapeHtml(body.name) + "</p>" +
          "<p><strong>Email:</strong> " + escapeHtml(body.email) + "</p>" +
          (body.phone ? "<p><strong>Phone:</strong> " + escapeHtml(body.phone) + "</p>" : "") +
          (body.subject ? "<p><strong>Subject:</strong> " + escapeHtml(body.subject) + "</p>" : "") +
          "<p><strong>Message:</strong></p><p>" + escapeHtml(body.message) + "</p>",
      }),
    });

    const smtpData = await smtpResult.json();
    const data = smtpData && smtpData.data;
    const succeeded = Number(data && data.succeeded || 0);
    const failed = Number(data && data.failed || 0);
    const accepted = Boolean(data && (succeeded > 0 || data.email_id || data.schedule_id));
    const errorCode = data && data.error_code;
    const rejectedByCode = errorCode !== undefined && errorCode !== null && String(errorCode) !== "" && Number(errorCode) !== 0;
    if (!smtpResult.ok || !accepted || failed > 0 || rejectedByCode) {
      return json({ error: "Failed to send email" }, 502);
    }
  } catch {
    return json({ error: "Email service error" }, 502);
  }

  return json({ ok: true, message: "Your message has been sent." }, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
`;
}
