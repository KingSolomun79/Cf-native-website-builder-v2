// V2 central WAZIBIZ Form Service (issue #11, PRD sections 34-39).
//
// Flow: visitor -> static Contact form -> POST here -> origin/schema/
// Turnstile/rate validation -> Accepted Submission (durable commit) ->
// resolve current Site Configuration -> Form Destination + Sender Identity
// -> Email Delivery with bounded server-side retry.
//
// Browser code may only send public site/form identity plus visitor fields
// (and a Turnstile token). It can never control recipient, From sender,
// sender domain, template, credentials or internal routing. Visitor email is
// validated Reply-To and never the transactional From. Form Destination and
// Sender Identity are mutable Site Configuration: changing them creates no
// Build and survives Rollback.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";

export const MAX_DELIVERY_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MINUTES = 10;
export const RATE_LIMIT_MAX_PER_WINDOW = 5;

// Platform Sender Identity (issue #32). The default outbound From is
// environment configuration — WAZIBIZ_SENDER_EMAIL, a Worker var, never a
// secret and never a hard-coded mailbox — resolved and validated at the
// delivery boundary. A Site Configuration sender_identity value, when set,
// is an explicit verified override (the future Business-owned sender path,
// PRD 38) and wins over the platform default. Missing or malformed
// configuration fails closed: no fallback address, no visitor From, no
// hard-coded production mailbox.
export const PLATFORM_SENDER_ENV_VAR = "WAZIBIZ_SENDER_EMAIL";

const EMAIL_ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmailAddress(value: string): boolean {
  return value.length <= 320 && EMAIL_ADDRESS_PATTERN.test(value);
}

/**
 * Resolves the platform Sender Identity from `env.WAZIBIZ_SENDER_EMAIL`,
 * returning the validated address or null when missing/malformed. Callers
 * fail closed on null — the value is swappable per environment (local /
 * staging / production) without source changes.
 */
export function resolvePlatformSenderIdentity(env: Env): string | null {
  const raw = env.WAZIBIZ_SENDER_EMAIL?.trim();
  if (!raw || !isValidEmailAddress(raw)) return null;
  return raw;
}

export type FormServiceErrorCode =
  | "SITE_NOT_FOUND"
  | "FORM_DISABLED"
  | "ORIGIN_NOT_ALLOWED"
  | "BROWSER_PAYLOAD_CONTRACT"
  | "FIELDS_INVALID"
  | "TURNSTILE_FAILED"
  | "RATE_LIMITED"
  | "HEADER_INJECTION"
  | "SENDER_IDENTITY_INVALID";

export class FormServiceError extends Error {
  readonly code: FormServiceErrorCode;
  readonly status: number;

  constructor(code: FormServiceErrorCode, message: string) {
    super(message);
    this.name = "FormServiceError";
    this.code = code;
    this.status =
      code === "SITE_NOT_FOUND" ? 404
      : code === "RATE_LIMITED" ? 429
      : code === "ORIGIN_NOT_ALLOWED" || code === "TURNSTILE_FAILED" || code === "FORM_DISABLED" ? 403
      : 400;
  }
}

// ── Site Configuration ──────────────────────────────────────────────────────

export interface SiteFormConfiguration {
  siteId: string;
  formEnabled: boolean;
  allowedOrigins: string[];
  formDestination: string;
  senderIdentity: string;
  turnstileRequired: boolean;
  updatedAt: string;
}

export async function upsertSiteConfiguration(
  env: Env,
  input: {
    siteId: string;
    formDestination: string;
    /** Explicit verified Sender Identity override (future Business-owned
     *  sender). When omitted, the Site uses the platform default resolved
     *  from env.WAZIBIZ_SENDER_EMAIL at delivery time (stored as ''). */
    senderIdentity?: string;
    allowedOrigins?: string[];
    formEnabled?: boolean;
    turnstileRequired?: boolean;
  }
): Promise<SiteFormConfiguration> {
  if (input.formDestination !== undefined && !isValidEmailAddress(input.formDestination.trim())) {
    throw new FormServiceError("FIELDS_INVALID", "formDestination must be a valid recipient address");
  }
  const explicitSender = input.senderIdentity?.trim();
  if (explicitSender !== undefined && explicitSender !== "" && !isValidEmailAddress(explicitSender)) {
    throw new FormServiceError("SENDER_IDENTITY_INVALID", "senderIdentity must be a valid address when provided");
  }
  const updatedAt = nowIso();
  // '' = platform default: the effective From resolves from
  // WAZIBIZ_SENDER_EMAIL at delivery time, so changing the environment value
  // changes From without touching Site Configuration or source.
  const senderIdentity = explicitSender ?? "";
  await env.DB.prepare(
    `INSERT INTO site_configurations (site_id, form_enabled, form_allowed_origins_json, form_destination, sender_identity, turnstile_required, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (site_id) DO UPDATE SET
       form_enabled = excluded.form_enabled,
       form_allowed_origins_json = excluded.form_allowed_origins_json,
       form_destination = excluded.form_destination,
       sender_identity = excluded.sender_identity,
       turnstile_required = excluded.turnstile_required,
       updated_at = excluded.updated_at`
  )
    .bind(
      input.siteId,
      input.formEnabled === false ? 0 : 1,
      JSON.stringify(input.allowedOrigins ?? []),
      input.formDestination.trim(),
      senderIdentity,
      input.turnstileRequired ? 1 : 0,
      updatedAt
    )
    .run();
  return {
    siteId: input.siteId,
    formEnabled: input.formEnabled !== false,
    allowedOrigins: input.allowedOrigins ?? [],
    formDestination: input.formDestination.trim(),
    senderIdentity,
    turnstileRequired: input.turnstileRequired === true,
    updatedAt,
  };
}

export async function getSiteConfiguration(env: Env, siteId: string): Promise<SiteFormConfiguration | null> {
  const row = await env.DB.prepare("SELECT * FROM site_configurations WHERE site_id = ?")
    .bind(siteId)
    .first<{
      site_id: string;
      form_enabled: number;
      form_allowed_origins_json: string;
      form_destination: string;
      sender_identity: string;
      turnstile_required: number;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    siteId: row.site_id,
    formEnabled: row.form_enabled === 1,
    allowedOrigins: (JSON.parse(row.form_allowed_origins_json) as string[]) ?? [],
    formDestination: row.form_destination,
    senderIdentity: row.sender_identity,
    turnstileRequired: row.turnstile_required === 1,
    updatedAt: row.updated_at,
  };
}

// ── Browser payload contract ────────────────────────────────────────────────

const ALLOWED_PAYLOAD_KEYS = new Set(["siteFormId", "name", "email", "message", "phone", "subject", "turnstileToken"]);
const FORBIDDEN_CONTROL_KEYS = ["recipient", "to", "from", "sender", "senderIdentity", "template", "credentials", "cc", "bcc", "replyTo"];

export interface VisitorFormFields {
  name: string;
  email: string;
  message: string;
  phone?: string;
  subject?: string;
}

export interface BrowserFormPayload {
  siteFormId: string;
  fields: VisitorFormFields;
  turnstileToken?: string;
}

export function parseBrowserFormPayload(raw: unknown): BrowserFormPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new FormServiceError("BROWSER_PAYLOAD_CONTRACT", "Form payload must be a JSON object");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (FORBIDDEN_CONTROL_KEYS.includes(key.toLowerCase())) {
      throw new FormServiceError(
        "BROWSER_PAYLOAD_CONTRACT",
        `Browser code must not control delivery: '${key}' is not a browser field`
      );
    }
    if (!ALLOWED_PAYLOAD_KEYS.has(key)) {
      throw new FormServiceError("BROWSER_PAYLOAD_CONTRACT", `Unexpected browser payload field '${key}'`);
    }
    if (typeof value !== "string") {
      throw new FormServiceError("FIELDS_INVALID", `Field '${key}' must be a string`);
    }
  }
  const body = raw as Record<string, string>;
  if (!body.siteFormId || !body.siteFormId.startsWith("site:")) {
    throw new FormServiceError("BROWSER_PAYLOAD_CONTRACT", "siteFormId must be the public site form identity ('site:{siteId}')");
  }
  const name = body.name ?? "";
  const email = body.email ?? "";
  const message = body.message ?? "";
  const headerInjection = /[\r\n]/.test(`${name}${email}${message}${body.phone ?? ""}${body.subject ?? ""}`);
  if (headerInjection) {
    throw new FormServiceError("HEADER_INJECTION", "Line breaks in header-derived fields are rejected");
  }
  if (name.trim().length < 1 || name.length > 200) throw new FormServiceError("FIELDS_INVALID", "name must be 1-200 characters");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) throw new FormServiceError("FIELDS_INVALID", "email must be a valid visitor address");
  if (message.trim().length < 1 || message.length > 5000) throw new FormServiceError("FIELDS_INVALID", "message must be 1-5000 characters");
  if (body.phone !== undefined && body.phone.length > 60) throw new FormServiceError("FIELDS_INVALID", "phone too long");
  if (body.subject !== undefined && body.subject.length > 200) throw new FormServiceError("FIELDS_INVALID", "subject too long");
  return {
    siteFormId: body.siteFormId,
    fields: {
      name: name.trim(),
      email: email.trim(),
      message,
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.subject !== undefined ? { subject: body.subject } : {}),
    },
    ...(body.turnstileToken !== undefined ? { turnstileToken: body.turnstileToken } : {}),
  };
}

// ── Turnstile / rate / transport seams ──────────────────────────────────────

export type TurnstileVerifier = (token: string, ipHash: string) => Promise<boolean>;

async function verifyTurnstileViaApi(env: Env, token: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  const verdict = (await response.json()) as { success: boolean };
  return verdict.success === true;
}

export interface EmailSendInput {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
}

export type EmailSendResult = { ok: true } | { ok: false; classification: "transient" | "permanent"; error: string };

export type EmailTransport = (input: EmailSendInput) => Promise<EmailSendResult>;

// Default platform transport: the native Cloudflare Email Service
// `send_email` binding (issue #28 follow-up). One authoritative outbound
// channel — no provider API key, no shared transport secret, no HTTP
// email-router hop. When the binding is absent the delivery classifies
// transient and retry stays bounded — acceptance never depends on delivery
// (PRD section 37).
//
// Failure classification maps the documented Email Service error codes
// (Workers Email Sending API: thrown Errors carry an `E_*` code property)
// onto the ledger's transient/permanent semantics. Cloudflare documents no
// official retryability table, so this is the narrowest defensible mapping:
//   transient  — quota/service/availability conditions that heal
//                (E_RATE_LIMIT_EXCEEDED, E_DAILY_LIMIT_EXCEEDED,
//                E_INTERNAL_SERVER_ERROR, E_DELIVERY_FAILED,
//                E_SENDER_DOMAIN_NOT_AVAILABLE: the domain may finish
//                onboarding while bounded retry is still running)
//   permanent  — validation/sender/recipient conditions that retrying
//                cannot change (E_SENDER_NOT_VERIFIED,
//                E_RECIPIENT_NOT_ALLOWED, E_RECIPIENT_SUPPRESSED,
//                E_VALIDATION_ERROR, E_FIELD_MISSING,
//                E_TOO_MANY_RECIPIENTS, E_TOO_MANY_ATTACHMENTS,
//                E_CONTENT_TOO_LARGE, E_HEADER_*)
//   unknown    — undocumented or code-less errors classify transient:
//                permanence is unproven and retry is capped at
//                MAX_DELIVERY_ATTEMPTS, so misclassification costs at
//                most a few bounded attempts instead of lost mail.
const TRANSIENT_EMAIL_ERROR_CODES = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
  "E_DELIVERY_FAILED",
  "E_SENDER_DOMAIN_NOT_AVAILABLE",
]);

const PERMANENT_EMAIL_ERROR_CODES = new Set([
  "E_SENDER_NOT_VERIFIED",
  "E_RECIPIENT_NOT_ALLOWED",
  "E_RECIPIENT_SUPPRESSED",
  "E_VALIDATION_ERROR",
  "E_FIELD_MISSING",
  "E_TOO_MANY_RECIPIENTS",
  "E_TOO_MANY_ATTACHMENTS",
  "E_CONTENT_TOO_LARGE",
  "E_HEADER_NOT_ALLOWED",
  "E_HEADER_USE_API_FIELD",
  "E_HEADER_VALUE_INVALID",
  "E_HEADER_VALUE_TOO_LONG",
  "E_HEADER_NAME_INVALID",
  "E_HEADERS_TOO_LARGE",
  "E_HEADERS_TOO_MANY",
]);

export function createDefaultEmailTransport(env: Env): EmailTransport {
  return async (input) => {
    const emailService = env.EMAIL;
    if (!emailService) {
      return { ok: false, classification: "transient", error: "email transport not configured" };
    }
    try {
      await emailService.send({
        to: input.to,
        from: input.from,
        replyTo: input.replyTo,
        subject: input.subject,
        text: input.text,
      });
      return { ok: true };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const errorCode = typeof code === "string" ? code : "";
      if (errorCode && PERMANENT_EMAIL_ERROR_CODES.has(errorCode)) {
        return { ok: false, classification: "permanent", error: errorCode };
      }
      if (errorCode && TRANSIENT_EMAIL_ERROR_CODES.has(errorCode)) {
        return { ok: false, classification: "transient", error: errorCode };
      }
      return {
        ok: false,
        classification: "transient",
        error: errorCode || "email send failed without a documented code",
      };
    }
  };
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ── Acceptance ──────────────────────────────────────────────────────────────

export interface AcceptFormSubmissionInput {
  origin: string | null;
  remoteAddress?: string | null;
  payload: unknown;
  turnstileVerifier?: TurnstileVerifier;
}

export interface AcceptedSubmissionResult {
  submissionId: string;
  siteId: string;
  acceptedAt: string;
}

export async function acceptFormSubmission(
  env: Env,
  input: AcceptFormSubmissionInput
): Promise<AcceptedSubmissionResult> {
  const parsed = parseBrowserFormPayload(input.payload);
  const siteId = parsed.siteFormId.slice("site:".length);

  const siteExists = await env.DB.prepare("SELECT id FROM site_identities WHERE id = ?")
    .bind(siteId)
    .first<{ id: string }>();
  if (!siteExists) {
    throw new FormServiceError("SITE_NOT_FOUND", `Unknown site form identity '${parsed.siteFormId}'`);
  }

  const configuration = await getSiteConfiguration(env, siteId);
  if (!configuration) {
    throw new FormServiceError("SITE_NOT_FOUND", "Site has no Form Service configuration");
  }
  if (!configuration.formEnabled) {
    throw new FormServiceError("FORM_DISABLED", "This Site's form is disabled");
  }

  // Allowed-origin validation.
  const origin = input.origin ?? "";
  if (!configuration.allowedOrigins.includes(origin)) {
    throw new FormServiceError("ORIGIN_NOT_ALLOWED", `Origin '${origin}' is not an allowed form origin`);
  }

  // Turnstile where configured.
  if (configuration.turnstileRequired) {
    const ipHash = await sha256Hex(`${siteId}:${input.remoteAddress ?? "unknown"}`);
    const verifier = input.turnstileVerifier ?? ((token) => verifyTurnstileViaApi(env, token));
    if (!parsed.turnstileToken || !(await verifier(parsed.turnstileToken, ipHash))) {
      throw new FormServiceError("TURNSTILE_FAILED", "Turnstile verification failed");
    }
  }

  // Rate limiting per Site + client within the window.
  const ipHash = await sha256Hex(`${siteId}:${input.remoteAddress ?? "unknown"}`);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM form_submissions WHERE site_id = ? AND ip_hash = ? AND accepted_at >= ?"
  )
    .bind(siteId, ipHash, windowStart)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT_MAX_PER_WINDOW) {
    throw new FormServiceError("RATE_LIMITED", "Too many submissions from this client; try again later");
  }

  // Durable acceptance: the Accepted Submission exists only after this
  // commit. Browser success is never granted before it.
  const submissionId = generateId();
  const acceptedAt = nowIso();
  await env.DB.prepare(
    `INSERT INTO form_submissions (id, site_id, site_form_id, visitor_name, visitor_email, visitor_message, visitor_phone, visitor_subject, source_origin, ip_hash, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      submissionId,
      siteId,
      parsed.siteFormId,
      parsed.fields.name,
      parsed.fields.email,
      parsed.fields.message,
      parsed.fields.phone ?? null,
      parsed.fields.subject ?? null,
      origin,
      ipHash,
      acceptedAt
    )
    .run();

  // First Email Delivery attempt under the CURRENT Site Configuration. The
  // effective From is the Site's explicit verified override when set, else
  // the platform Sender Identity resolved from WAZIBIZ_SENDER_EMAIL at this
  // moment (issue #32); unresolvable configuration fails closed inside the
  // attempt without ever falling back to another address.
  const senderIdentity = configuration.senderIdentity || resolvePlatformSenderIdentity(env) || "";
  await attemptEmailDelivery(env, {
    submissionId,
    destination: configuration.formDestination,
    senderIdentity,
    replyTo: parsed.fields.email,
    visitorName: parsed.fields.name,
    message: parsed.fields.message,
    subject: parsed.fields.subject ?? `New contact message from ${parsed.fields.name}`,
  });

  return { submissionId, siteId, acceptedAt };
}

// ── Email Delivery (bounded server-side retry) ──────────────────────────────

export interface DeliveryAttemptDeps {
  transport?: EmailTransport;
  now?: () => Date;
}

export async function attemptEmailDelivery(
  env: Env,
  input: {
    submissionId: string;
    destination: string;
    senderIdentity: string;
    replyTo: string;
    visitorName: string;
    message: string;
    subject: string;
  },
  deps: DeliveryAttemptDeps = {}
): Promise<{ deliveryId: string; status: "delivered" | "transient_failure" | "permanent_failure" }> {
  const transport = deps.transport ?? createDefaultEmailTransport(env);
  const now = (deps.now ?? (() => new Date()))();
  const createdAt = now.toISOString();

  const prior = await env.DB.prepare(
    "SELECT COUNT(*) AS n, MAX(attempt_number) AS last FROM email_deliveries WHERE form_submission_id = ?"
  )
    .bind(input.submissionId)
    .first<{ n: number; last: number | null }>();
  const attemptNumber = (prior?.last ?? 0) + 1;
  const latest = await env.DB.prepare(
    "SELECT id, status FROM email_deliveries WHERE form_submission_id = ? ORDER BY attempt_number DESC LIMIT 1"
  )
    .bind(input.submissionId)
    .first<{ id: string; status: string }>();
  if (latest?.status === "permanent_failure") {
    // Terminal state is idempotent: no further delivery mutations.
    return { deliveryId: latest.id, status: "permanent_failure" as const };
  }
  if (attemptNumber > MAX_DELIVERY_ATTEMPTS) {
    // Bounded retry: record terminal state without erasing the Accepted
    // Submission.
    const deliveryId = generateId();
    await env.DB.prepare(
      `INSERT INTO email_deliveries (id, form_submission_id, attempt_number, status, destination, sender_identity, reply_to, error_class, error_detail, created_at, updated_at)
       VALUES (?, ?, ?, 'permanent_failure', ?, ?, ?, 'retry_limit', 'bounded retry limit reached', ?, ?)`
    )
      .bind(deliveryId, input.submissionId, attemptNumber, input.destination, input.senderIdentity, input.replyTo, createdAt, createdAt)
      .run();
    return { deliveryId, status: "permanent_failure" };
  }

  // Fail-closed sender gate (issue #32): without a valid trusted From — an
  // explicit override or a resolvable WAZIBIZ_SENDER_EMAIL — nothing is sent.
  // There is no fallback address, no hard-coded mailbox and never a visitor
  // From. The failure is deterministic and classified transient: fixing the
  // environment lets the bounded server-side retry deliver the same Accepted
  // Submission without visitor resubmission.
  if (!isValidEmailAddress(input.senderIdentity.trim())) {
    const deliveryId = generateId();
    await env.DB.prepare(
      `INSERT INTO email_deliveries (id, form_submission_id, attempt_number, status, destination, sender_identity, reply_to, error_class, error_detail, scheduled_retry_at, created_at, updated_at)
       VALUES (?, ?, ?, 'transient_failure', ?, ?, ?, 'transient', ?, ?, ?, ?)`
    )
      .bind(
        deliveryId,
        input.submissionId,
        attemptNumber,
        input.destination,
        input.senderIdentity,
        input.replyTo,
        `platform sender identity unresolvable (${PLATFORM_SENDER_ENV_VAR} missing or malformed); no fallback From exists`,
        new Date(now.getTime() + Math.min(2 ** attemptNumber, 60) * 60_000).toISOString(),
        createdAt,
        createdAt
      )
      .run();
    return { deliveryId, status: "transient_failure" };
  }

  const result = await transport({
    to: input.destination,
    from: input.senderIdentity.trim(),
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.message,
  });

  const deliveryId = generateId();
  const status = result.ok ? "delivered" : result.classification === "permanent" ? "permanent_failure" : "transient_failure";
  // Exponential backoff for bounded transient retries.
  const retryAt = result.ok || result.classification === "permanent"
    ? null
    : new Date(now.getTime() + Math.min(2 ** attemptNumber, 60) * 60_000).toISOString();

  await env.DB.prepare(
    `INSERT INTO email_deliveries (id, form_submission_id, attempt_number, status, destination, sender_identity, reply_to, error_class, error_detail, scheduled_retry_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      deliveryId,
      input.submissionId,
      attemptNumber,
      status,
      input.destination,
      input.senderIdentity,
      input.replyTo,
      result.ok ? null : result.classification,
      result.ok ? null : result.error,
      retryAt,
      createdAt,
      createdAt
    )
    .run();

  return { deliveryId, status };
}

// Retry due transient deliveries server-side; the visitor never resubmits.
export async function processDueEmailDeliveries(
  env: Env,
  deps: DeliveryAttemptDeps & {
    submissionLoader?: (submissionId: string) => Promise<{ visitor_name: string; visitor_email: string; visitor_message: string; visitor_subject: string | null } | null>;
    /** Optional scope (e.g. one Site's retry sweep); omit to process all due. */
    submissionIds?: string[];
  } = {}
): Promise<number> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const due = await env.DB.prepare(
    `SELECT d.form_submission_id, d.destination, d.sender_identity, d.reply_to
     FROM email_deliveries d
     WHERE d.status = 'transient_failure' AND d.scheduled_retry_at IS NOT NULL AND d.scheduled_retry_at <= ?
       AND d.attempt_number = (SELECT MAX(attempt_number) FROM email_deliveries WHERE form_submission_id = d.form_submission_id)
       AND (? IS NULL OR d.form_submission_id = ?)`
  )
    .bind(now, deps.submissionIds?.[0] ?? null, deps.submissionIds?.[0] ?? null)
    .all<{ form_submission_id: string; destination: string; sender_identity: string; reply_to: string }>();
  const scoped = (deps.submissionIds ?? null) === null ? due.results ?? [] : (due.results ?? []).filter((row) => deps.submissionIds!.includes(row.form_submission_id));

  let processed = 0;
  for (const row of scoped) {
    const loader =
      deps.submissionLoader ??
      (async (submissionId: string) =>
        (await env.DB.prepare(
          "SELECT visitor_name, visitor_email, visitor_message, visitor_subject FROM form_submissions WHERE id = ?"
        )
          .bind(submissionId)
          .first<{ visitor_name: string; visitor_email: string; visitor_message: string; visitor_subject: string | null }>()));
    const submission = await loader(row.form_submission_id);
    if (!submission) continue;
    await attemptEmailDelivery(
      env,
      {
        submissionId: row.form_submission_id,
        destination: row.destination,
        // Recorded sender stays authoritative (the value captured at the
        // previous attempt). Only an empty recorded value — the
        // sender-unresolvable sentinel — re-resolves the platform default
        // from the CURRENT environment, so fixing WAZIBIZ_SENDER_EMAIL lets
        // the bounded retry heal without visitor resubmission.
        senderIdentity: row.sender_identity || resolvePlatformSenderIdentity(env) || "",
        replyTo: row.reply_to,
        visitorName: submission.visitor_name,
        message: submission.visitor_message,
        subject: submission.visitor_subject ?? `New contact message from ${submission.visitor_name}`,
      },
      deps
    );
    processed += 1;
  }
  return processed;
}
