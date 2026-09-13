import { Context } from "hono";
import type { Env } from "../env.d";
import { createIntakeDraft, validateIntakeDraftPayload, type IntakeDraftPayload } from "../domain/intake-draft";
import {
  attemptAdminNotificationSend,
  composeNewIntakeEmail,
  enqueueAdminNotification,
} from "../domain/admin-notifications";

// PUBLIC client intake (operator GO 2026-09-12).
//
// The wazibiz.ke website form posts a DRAFT here. This endpoint deliberately
// does NOT use WEBHOOK_SECRET (no HMAC capability ever reaches browser code)
// and it can NEVER start a Site Generation: it only persists a mutable Intake
// Draft and notifies the admin. Canonical generation starts exclusively
// through the admin Validate & Generate action on the operator surface.
//
// Protections (all fail closed):
//   - strict schema validation (draft shape, no unknown fields)
//   - Cloudflare Turnstile (siteverify; missing secret rejects)
//   - fixed-window rate limit keyed by a HASHED remote address
//     (SHA-256 with the platform secret as salt — no raw IP persisted)
//   - strict Origin allowlist (wazibiz.ke only)
//   - body size limit
//   - CORS: the preflight and the response headers exist ONLY for the
//     allowlisted origin (integration GO 2026-09-13) — the browser mapper
//     posts JSON cross-origin and must be able to read the JSON verdict.

const ALLOWED_ORIGINS = new Set(["https://wazibiz.ke"]);
const MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

// CORS headers echo ONLY the allowlisted origin — never a wildcard, never
// another origin, and no credentials (the endpoint is cookie-less by design).
function corsHeadersFor(origin: string): Record<string, string> | null {
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

/** CORS preflight for the public intake endpoint (allowlisted origins only). */
export async function preflightClientIntake(c: Context<{ Bindings: Env }>): Promise<Response> {
  const headers = corsHeadersFor(c.req.header("Origin") ?? "");
  if (!headers) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function submitClientIntake(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Origin allowlist: browser submissions from anywhere else are rejected
  // before any processing (with no CORS headers — an attacking page learns
  // nothing readable).
  const origin = c.req.header("Origin") ?? "";
  const cors = corsHeadersFor(origin);
  if (!cors) {
    return c.json({ error: "Origin not allowed" }, 403);
  }

  const contentLength = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return c.json({ error: "Body size out of allowed range" }, { status: 413, headers: cors });
  }
  // Measure the ACTUAL body (some clients/agents omit a reliable
  // content-length): the size limit holds either way.
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: "Invalid body" }, { status: 400, headers: cors });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ error: "Body size out of allowed range" }, { status: 413, headers: cors });
  }

  let body: { submission?: unknown };
  try {
    body = JSON.parse(rawBody) as { submission?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, { status: 400, headers: cors });
  }

  const draftPayload = (body ?? {}) as Record<string, unknown>;
  const validated = validateIntakeDraftPayload({
    submitter: draftPayload.submitter,
    business: draftPayload.business,
    designPreferences: draftPayload.designPreferences,
  });
  if (!validated.valid) {
    return c.json({ error: { code: "DRAFT_INVALID", issues: validated.issues } }, { status: 400, headers: cors });
  }

  // Turnstile BEFORE any durable write.
  const turnstileToken = typeof draftPayload.turnstileToken === "string" ? draftPayload.turnstileToken : "";
  if (!turnstileToken || !(await verifyTurnstile(c.env, turnstileToken))) {
    return c.json({ error: { code: "TURNSTILE_FAILED", message: "Turnstile verification failed" } }, { status: 403, headers: cors });
  }

  // Rate limit keyed by the HASHED remote address (never the raw IP).
  const remoteAddress = c.req.header("CF-Connecting-IP") ?? "unknown";
  const hashedIp = await hashRemoteAddress(c.env, remoteAddress);
  const windowHour = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString().slice(0, 13);
  const recent = await c.env.DB.prepare(
    "SELECT hit_count FROM public_intake_rate_limits WHERE hashed_ip = ? AND window_hour = ?"
  )
    .bind(hashedIp, windowHour)
    .first<{ hit_count: number }>();
  if ((recent?.hit_count ?? 0) >= RATE_LIMIT_MAX_PER_WINDOW) {
    return c.json({ error: { code: "RATE_LIMITED", message: "Too many submissions; try again later" } }, { status: 429, headers: cors });
  }
  if (recent) {
    await c.env.DB.prepare(
      "UPDATE public_intake_rate_limits SET hit_count = hit_count + 1 WHERE hashed_ip = ? AND window_hour = ?"
    )
      .bind(hashedIp, windowHour)
      .run();
  } else {
    await c.env.DB.prepare(
      "INSERT INTO public_intake_rate_limits (hashed_ip, window_hour, hit_count) VALUES (?, ?, 1) ON CONFLICT (hashed_ip, window_hour) DO UPDATE SET hit_count = hit_count + 1"
    )
      .bind(hashedIp, windowHour)
      .run();
  }

  // Durable draft commit — the ONLY write this endpoint performs. A public
  // submission never creates a Site Generation, Build or workflow instance.
  const storedPayload: IntakeDraftPayload = JSON.parse(JSON.stringify(validated.value));
  const draft = await createIntakeDraft(c.env, storedPayload);

  // Admin notification: idempotent ledger enqueue + one best-effort inline
  // send. Email failure never rolls back the accepted draft.
  const email = composeNewIntakeEmail(c.env, {
    draftId: draft.id,
    businessName: draft.businessName,
    submitterName: draft.submitterName,
    submitterEmail: draft.submitterEmail,
  });
  try {
    await enqueueAdminNotification(c.env, { kind: "INTAKE_NEW", ...email });
    await attemptAdminNotificationSend(c.env, email.dedupeKey);
  } catch (error) {
    console.error(`(error) admin_intake_notification_failed { draft: '${draft.id}', message: '${(error as Error).message.replace(/'/g, "")}' }`);
  }

  return c.json(
    {
      draftId: draft.id,
      status: draft.status,
      receivedAt: draft.createdAt,
      message: "Brief received. Our team will review it and get back to you.",
    },
    { status: 201, headers: cors }
  );
}

async function hashRemoteAddress(env: Env, remoteAddress: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${remoteAddress}|${env.WEBHOOK_SECRET}`));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyTurnstile(env: Env, token: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
    });
    const verdict = (await response.json()) as { success: boolean };
    return verdict.success === true;
  } catch {
    return false;
  }
}
