// Shared crypto helpers for the V2 platform: HMAC signing of operator
// intake (timing-safe verification), and id/time primitives. V1 approval
// tokens, candidate-validation capabilities, GitHub webhook verification and
// the V1 workflow event bridge were removed with the migration contraction.

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

export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
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

export function generateId(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
