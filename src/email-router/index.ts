// WAZIBIZ outbound email router (issue #28, PRD sections 37-39).
//
// This Worker IS the endpoint declared as WAZIBIZ_EMAIL_TRANSPORT_URL on the
// Form Service: it accepts exactly the platform transport contract
// (POST {to, from, replyTo, subject, text} with the shared bearer token) and
// forwards to the platform ESP (SMTP2Go JSON API) using a provider key that
// never leaves Worker secrets. Generated Sites and browser code never see
// this endpoint's credentials; only the Form Service holds the bearer token.
//
// Fail-closed semantics mirror the Form Service delivery classification:
//   2xx           -> delivered
//   5xx           -> transient (bounded retry heals after the router or the
//                    ESP recovers / configuration is completed)
//   other 4xx     -> permanent (contract violation or rejected send)
// The router returns 503 while its own configuration is incomplete so the
// Form Service keeps bounded-retrying instead of terminal-failing during
// operational setup. A presented-but-wrong bearer token is a caller
// configuration error and classifies permanent (401) so it surfaces loudly.

export interface EmailRouterEnv {
  /** Shared transport bearer token (Worker secret; must match the Form Service secret). */
  WAZIBIZ_EMAIL_TRANSPORT_TOKEN?: string;
  /** SMTP2Go API key (Worker secret; the router is fail-closed without it). */
  SMTP2GO_API_KEY?: string;
}

const SMTP2GO_SEND_ENDPOINT = "https://api.smtp2go.com/v2/email/send";
const DOWNSTREAM_TIMEOUT_MS = 15_000;

const MAX_BODY_BYTES = 64 * 1024;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_SUBJECT_LENGTH = 998;
const MAX_TEXT_LENGTH = 20_000;

interface TransportRequestBody {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
}

interface Smtp2GoResponse {
  data?: { error?: { code?: string | number; message?: string } | null; email_id?: string };
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function bearerTokensMatch(presented: string, expected: string): Promise<boolean> {
  // Compare digests so mismatched lengths cannot shortcut the comparison.
  const encode = (value: string) => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(presented)),
    crypto.subtle.digest("SHA-256", encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function validateTransportBody(raw: unknown): { ok: true; body: TransportRequestBody } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "body must be a JSON object" };
  const keys = Object.keys(raw);
  const required = ["to", "from", "replyTo", "subject", "text"];
  for (const key of keys) {
    if (!required.includes(key)) return { ok: false, error: `unexpected field '${key}'` };
  }
  for (const key of required) {
    if (typeof (raw as Record<string, unknown>)[key] !== "string") {
      return { ok: false, error: `field '${key}' must be a string` };
    }
  }
  const body = raw as Record<string, string>;
  for (const field of ["to", "from", "replyTo"]) {
    if (!EMAIL_PATTERN.test(body[field]) || body[field].length > MAX_EMAIL_LENGTH) {
      return { ok: false, error: `field '${field}' must be a plain email address` };
    }
    if (/[\r\n]/.test(body[field])) return { ok: false, error: `field '${field}' must not contain line breaks` };
  }
  if (/[\r\n]/.test(body.subject)) return { ok: false, error: "field 'subject' must not contain line breaks" };
  if (body.subject.length < 1 || body.subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, error: "field 'subject' length out of range" };
  }
  if (body.text.length < 1 || body.text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: "field 'text' length out of range" };
  }
  return { ok: true, body: { to: body.to, from: body.from, replyTo: body.replyTo, subject: body.subject, text: body.text } };
}

export async function handleEmailRouterRequest(request: Request, env: EmailRouterEnv): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    // Liveness only; exposes no configuration state.
    return json(200, { ok: true });
  }

  if (url.pathname !== "/send") return json(404, { error: "not found" });
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  // Fail closed (transient) while the router cannot authenticate callers at all.
  if (!env.WAZIBIZ_EMAIL_TRANSPORT_TOKEN) {
    return json(503, { error: "email router not configured" });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!presented || !(await bearerTokensMatch(presented, env.WAZIBIZ_EMAIL_TRANSPORT_TOKEN))) {
    return json(401, { error: "unauthorized" });
  }

  // Fail closed (transient) while the provider leg is unwired; only
  // authenticated callers can observe this state.
  if (!env.SMTP2GO_API_KEY) {
    return json(503, { error: "email router provider not configured" });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return json(422, { error: "body too large" });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(422, { error: "body must be valid JSON" });
  }
  const validated = validateTransportBody(parsed);
  if (!validated.ok) return json(422, { error: validated.error });

  let upstream: Response;
  try {
    upstream = await fetch(SMTP2GO_SEND_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.SMTP2GO_API_KEY,
        to: [validated.body.to],
        sender: validated.body.from,
        subject: validated.body.subject,
        text: validated.body.text,
        custom_headers: [{ name: "Reply-To", value: validated.body.replyTo }],
      }),
      signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
    });
  } catch {
    // Network/timeout: transient for the Form Service.
    return json(502, { error: "upstream unavailable" });
  }

  if (upstream.status === 401 || upstream.status === 403) {
    // Bad or expired provider key is router-side configuration: keep it
    // retryable so bounded Form Service retries heal once the key is fixed.
    return json(500, { error: "upstream rejected router credentials" });
  }

  let verdict: Smtp2GoResponse = {};
  try {
    verdict = (await upstream.clone().json()) as Smtp2GoResponse;
  } catch {
    verdict = {};
  }

  if (upstream.status >= 500) return json(502, { error: "upstream error" });
  if (upstream.status >= 400) return json(422, { error: "upstream rejected the request" });

  if (verdict.data?.error) {
    // ESP-level rejection (unverified sender domain, rejected recipient):
    // permanent for this message; surfaced without echoing secrets.
    return json(422, { error: "upstream rejected the send", code: String(verdict.data.error.code ?? "rejected") });
  }
  return json(200, { accepted: true });
}

export default {
  async fetch(request: Request, env: EmailRouterEnv): Promise<Response> {
    return handleEmailRouterRequest(request, env);
  },
};
