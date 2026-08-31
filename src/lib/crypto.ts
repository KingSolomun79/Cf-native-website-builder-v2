import type { Env } from "../env.d";

export async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string | null
): Promise<boolean> {
  if (!signature) return false;
  const expected = await hmacSha256(secret, body);
  return timingSafeEqual(
    new TextEncoder().encode(signature),
    new TextEncoder().encode(expected)
  );
}

export interface ApprovalTokenPayload {
  jobId: string;
  action: "approve" | "reject" | "revise" | "input";
  exp: number;
}

export interface CandidateValidationCapability {
  action: "candidate-vision-validation";
  exp: number;
  nonce: string;
}

function base64UrlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  bytes.forEach((b) => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function signApprovalToken(
  env: Env,
  payload: ApprovalTokenPayload
): Promise<string> {
  const data = `${payload.jobId}:${payload.action}:${payload.exp}`;
  const sig = await hmacSha256(env.APPROVAL_SECRET, data);
  return base64UrlEncode(JSON.stringify({ ...payload, sig }));
}

export async function verifyApprovalToken(
  env: Env,
  token: string
): Promise<ApprovalTokenPayload | null> {
  try {
    const decoded = JSON.parse(
      base64UrlDecode(token)
    ) as ApprovalTokenPayload & { sig: string };

    if (decoded.exp < Date.now()) return null;

    const data = `${decoded.jobId}:${decoded.action}:${decoded.exp}`;
    const expected = await hmacSha256(env.APPROVAL_SECRET, data);

    if (!timingSafeEqual(
      new TextEncoder().encode(decoded.sig),
      new TextEncoder().encode(expected)
    )) {
      return null;
    }

    return {
      jobId: decoded.jobId,
      action: decoded.action,
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

export async function signCandidateValidationCapability(
  env: Env,
  payload: CandidateValidationCapability
): Promise<string> {
  if (!env.CANDIDATE_VALIDATION_SECRET) throw new Error("CANDIDATE_VALIDATION_SECRET is required");
  const data = `${payload.action}:${payload.exp}:${payload.nonce}`;
  const sig = await hmacSha256(env.CANDIDATE_VALIDATION_SECRET, data);
  return base64UrlEncode(JSON.stringify({ ...payload, sig }));
}

export async function verifyCandidateValidationCapability(
  env: Env,
  token: string,
  now = Date.now()
): Promise<CandidateValidationCapability | null> {
  try {
    const secret = env.CANDIDATE_VALIDATION_SECRET;
    if (!secret) return null;
    const decoded = JSON.parse(base64UrlDecode(token)) as CandidateValidationCapability & { sig: string };
    if (decoded.action !== "candidate-vision-validation" || !/^[A-Za-z0-9_-]{16,128}$/.test(decoded.nonce)) return null;
    if (!Number.isSafeInteger(decoded.exp) || decoded.exp <= now || decoded.exp > now + 15 * 60 * 1000) return null;
    const expected = await hmacSha256(secret, `${decoded.action}:${decoded.exp}:${decoded.nonce}`);
    if (!timingSafeEqual(new TextEncoder().encode(decoded.sig), new TextEncoder().encode(expected))) return null;
    return { action: decoded.action, exp: decoded.exp, nonce: decoded.nonce };
  } catch {
    return null;
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function verifyGithubWebhook(
  env: Env,
  body: string,
  signature: string
): Promise<boolean> {
  if (!env.GITHUB_WEBHOOK_SECRET) return false;
  return verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, body, signature.replace("sha256=", ""));
}

export async function sendWorkflowEvent(
  workflowBinding: Workflow,
  instanceId: string,
  event: Record<string, unknown>,
  eventType: string = "human-approval"
): Promise<void> {
  const instance = await workflowBinding.get(instanceId);
  await instance.sendEvent({
    type: eventType,
    payload: event,
  });
}
