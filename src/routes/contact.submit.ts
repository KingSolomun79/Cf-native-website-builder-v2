import { Context } from "hono";
import type { Env } from "../env.d";
import { sendContactFormEmail } from "../lib/mail";
import { generateId, nowIso } from "../lib/crypto";
import { getClientById } from "../lib/db";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function submitContact(c: Context<{ Bindings: Env }>): Promise<Response> {
  let body: {
    name?: string;
    email?: string;
    phone?: string;
    subject?: string;
    message?: string;
    siteId?: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!body.message?.trim()) {
    return c.json({ error: "Message is required" }, 400);
  }

  if (!body.email?.trim() || !isValidEmail(body.email.trim())) {
    return c.json({ error: "Valid email is required" }, 400);
  }

  if (!body.name?.trim()) {
    return c.json({ error: "Name is required" }, 400);
  }

  const now = nowIso();

  try {
    await c.env.DB.prepare(
      `INSERT INTO contact_submissions (id, site_id, submitted_at, sender_name, sender_email, sender_phone, subject, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      body.siteId ?? null,
      now,
      body.name.trim(),
      body.email.trim(),
      body.phone?.trim() ?? null,
      body.subject?.trim() ?? null,
      body.message.trim()
    ).run();
  } catch {
    // non-blocking: contact submission logging is best-effort
  }

  let clientEmail = c.env.INTERNAL_NOTIFICATION_EMAIL;
  let companyName = "Website";

  if (body.siteId) {
    try {
      const site = await c.env.DB.prepare(
        `SELECT s.id, c.client_email, c.company_name FROM sites s JOIN clients c ON s.client_id = c.id WHERE s.id = ?`
      ).bind(body.siteId).first<{ client_email: string; company_name: string }>();
      if (site) {
        clientEmail = site.client_email;
        companyName = site.company_name;
      }
    } catch {
      // fallback to internal notification email
    }
  }

  const result = await sendContactFormEmail(c.env, {
    clientEmail,
    companyName,
    senderName: body.name.trim(),
    senderEmail: body.email.trim(),
    senderPhone: body.phone?.trim(),
    subject: body.subject?.trim() ?? "Website Enquiry",
    message: body.message.trim(),
  });

  if (!result.success) {
    return c.json({ error: "Failed to send message", details: result.error }, 500);
  }

  return c.json({ ok: true, message: "Your message has been sent." });
}
