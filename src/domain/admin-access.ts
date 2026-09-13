// Cloudflare Access guard for the operator dashboard (operator GO 2026-09-12).
//
// The admin hostname (e.g. admin-builder.wazibiz.ke) sits behind Cloudflare
// Access at the edge; every request that reaches the Worker through it carries
// the `Cf-Access-Jwt-Assertion` header. The application layer is defense in
// depth, never a substitute for the edge:
//
//   1. ALWAYS: the assertion header must be present — an admin route is
//      unreachable without it, so a hostname that lost its Access policy
//      fails closed instead of silently exposing the dashboard.
//   2. When CF_ACCESS_TEAM_DOMAIN is configured, the JWT signature, expiry
//      and issuer are verified against the team's published certs (RS256 via
//      WebCrypto; certs cached per isolate). When CF_ACCESS_AUD is configured
//      the `aud` claim must match as well.

import type { Context } from "hono";
import type { Env } from "../env.d";

export const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

type AccessJwk = JsonWebKey & { kid?: string };

interface AccessCertCache {
  certs: AccessJwk[];
  fetchedAt: number;
}
const globalCertCache: { current?: AccessCertCache } = globalThis as unknown as { current?: AccessCertCache };
const CERT_CACHE_MS = 60 * 60 * 1000;

interface AccessJwtParts {
  header: { alg: string; kid?: string };
  payload: { iss?: string; aud?: string | string[]; exp?: number; email?: string };
  rawHeader: string;
  rawPayload: string;
  signature: Uint8Array;
}

function parseJwt(token: string): AccessJwtParts | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decode = (segment: string): string => atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
    return {
      header: JSON.parse(decode(parts[0])),
      payload: JSON.parse(decode(parts[1])),
      rawHeader: parts[0],
      rawPayload: parts[1],
      signature: Uint8Array.from(decode(parts[2]), (character) => character.charCodeAt(0)),
    };
  } catch {
    return null;
  }
}

async function fetchTeamCerts(teamDomain: string): Promise<AccessJwk[]> {
  const cached = globalCertCache.current;
  if (cached && Date.now() - cached.fetchedAt < CERT_CACHE_MS) return cached.certs;
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs fetch failed: ${response.status}`);
  const jwks = (await response.json()) as { keys: JsonWebKey[] };
  globalCertCache.current = { certs: jwks.keys, fetchedAt: Date.now() };
  return jwks.keys;
}

async function verifyAccessJwt(env: Env, token: string): Promise<{ ok: true; payload: AccessJwtParts["payload"] } | { ok: false; reason: string }> {
  const parts = parseJwt(token);
  if (!parts) return { ok: false, reason: "unparseable access token" };
  if (parts.header.alg !== "RS256") return { ok: false, reason: "unsupported access token algorithm" };

  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  if (teamDomain) {
    const keys = await fetchTeamCerts(teamDomain).catch(() => null);
    if (!keys || keys.length === 0) return { ok: false, reason: "access certs unavailable" };
    const kid = parts.header.kid;
    const jwk = keys.find((key) => !kid || key.kid === kid) ?? keys[0];
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      parts.signature as unknown as ArrayBuffer,
      new TextEncoder().encode(`${parts.rawHeader}.${parts.rawPayload}`)
    );
    if (!valid) return { ok: false, reason: "access token signature invalid" };
    if (parts.payload.exp && parts.payload.exp * 1000 < Date.now()) return { ok: false, reason: "access token expired" };
    const issuer = `https://${teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    if (parts.payload.iss !== issuer) return { ok: false, reason: "access token issuer mismatch" };
  }

  const aud = env.CF_ACCESS_AUD?.trim();
  if (aud) {
    const tokenAud = Array.isArray(parts.payload.aud) ? parts.payload.aud : [parts.payload.aud];
    if (!tokenAud.includes(aud)) return { ok: false, reason: "access token audience mismatch" };
  }
  return { ok: true, payload: parts.payload };
}

/**
 * Route guard for /admin and /api/admin. Returns a 401 Response when the
 * caller is not a verified Access identity; null when the request may proceed.
 */
export async function requireCloudflareAccess(env: Env, request: Request): Promise<Response | null> {
  const token = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (!token) {
    return Response.json(
      { error: "Cloudflare Access assertion missing — the admin surface is only reachable through the Access-protected hostname" },
      { status: 401 }
    );
  }
  // Presence-only enforcement when no verification inputs are configured: the
  // edge Access policy is the primary control; the app fails closed on a
  // missing header and on any unverifiable token when verification IS configured.
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.CF_ACCESS_AUD ?? "").trim();
  if (!teamDomain && !aud) return null;
  const verified = await verifyAccessJwt(env, token);
  if (!verified.ok) {
    return Response.json({ error: `Cloudflare Access verification failed: ${verified.reason}` }, { status: 401 });
  }
  return null;
}
