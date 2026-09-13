// Cloudflare Access guard for the operator dashboard (operator GO 2026-09-12;
// fail-closed cryptographic verification per the 2026-09-12 integration
// blocker correction).
//
// The admin hostname (e.g. admin-builder.wazibiz.ke) sits behind Cloudflare
// Access at the edge; every request that reaches the Worker through it carries
// the `Cf-Access-Jwt-Assertion` header. The application layer is defense in
// depth, never a substitute for the edge — and it can NEVER be satisfied by a
// manufactured header:
//
//   1. BOTH CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD must be configured. If
//      either is absent, EVERY admin route answers 503
//      ADMIN_ACCESS_NOT_CONFIGURED. Presence-only enforcement is removed.
//   2. Every accepted admin request must carry a Cf-Access-Jwt-Assertion
//      that parses as a JWT, declares alg=RS256, whose signature verifies
//      against the configured Access team's published certs (WebCrypto;
//      certs cached per isolate per team), whose exp exists and is not
//      expired, whose iss matches the configured team, and whose aud includes
//      the exact CF_ACCESS_AUD. No partial verification.

import type { Env } from "../env.d";

export const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";
export const ADMIN_ACCESS_NOT_CONFIGURED = "ADMIN_ACCESS_NOT_CONFIGURED";

type AccessJwk = JsonWebKey & { kid?: string };

interface AccessCertCache {
  certs: AccessJwk[];
  fetchedAt: number;
}
// Per-isolate cache, keyed by team host so distinct teams never share certs.
const certCaches = new Map<string, AccessCertCache>();
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

function teamHost(teamDomain: string): string {
  return teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function fetchTeamCerts(host: string): Promise<AccessJwk[]> {
  const cached = certCaches.get(host);
  if (cached && Date.now() - cached.fetchedAt < CERT_CACHE_MS) return cached.certs;
  const response = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access certs fetch failed: ${response.status}`);
  const jwks = (await response.json()) as { keys?: AccessJwk[] };
  const certs = Array.isArray(jwks.keys) ? jwks.keys : [];
  if (certs.length === 0) throw new Error("Access certs response carried no keys");
  certCaches.set(host, { certs, fetchedAt: Date.now() });
  return certs;
}

async function verifyAccessJwt(
  teamDomain: string,
  aud: string,
  token: string
): Promise<{ ok: true; payload: AccessJwtParts["payload"] } | { ok: false; reason: string }> {
  const parts = parseJwt(token);
  if (!parts) return { ok: false, reason: "unparseable access token" };
  if (parts.header.alg !== "RS256") return { ok: false, reason: "unsupported access token algorithm" };

  const host = teamHost(teamDomain);
  const keys = await fetchTeamCerts(host).catch(() => null);
  if (!keys || keys.length === 0) return { ok: false, reason: "access certs unavailable" };

  // The token must verify against a key the team actually publishes: an
  // exact kid match when the token declares one, otherwise any published key.
  const kid = parts.header.kid;
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  if (candidates.length === 0) return { ok: false, reason: "access token key id is not published by the Access team" };
  const signedInput = new TextEncoder().encode(`${parts.rawHeader}.${parts.rawPayload}`);
  let signatureValid = false;
  for (const jwk of candidates) {
    try {
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      if (await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, parts.signature as unknown as ArrayBuffer, signedInput)) {
        signatureValid = true;
        break;
      }
    } catch {
      // Not a usable RSA verification key — try the next published key.
    }
  }
  if (!signatureValid) return { ok: false, reason: "access token signature invalid" };

  if (typeof parts.payload.exp !== "number" || !Number.isFinite(parts.payload.exp)) {
    return { ok: false, reason: "access token missing expiry" };
  }
  if (parts.payload.exp * 1000 <= Date.now()) return { ok: false, reason: "access token expired" };

  if (parts.payload.iss !== `https://${host}`) return { ok: false, reason: "access token issuer mismatch" };

  const tokenAud = Array.isArray(parts.payload.aud) ? parts.payload.aud : [parts.payload.aud];
  if (!tokenAud.includes(aud)) return { ok: false, reason: "access token audience mismatch" };

  return { ok: true, payload: parts.payload };
}

/**
 * Route guard for /admin and /api/admin. Returns a Response (503
 * ADMIN_ACCESS_NOT_CONFIGURED when the verification inputs are missing, 401
 * when the assertion is absent or fails any verification step) when the
 * caller may not proceed; null only for a cryptographically verified Access
 * identity for the configured team and audience.
 */
export async function requireCloudflareAccess(env: Env, request: Request): Promise<Response | null> {
  const teamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env.CF_ACCESS_AUD ?? "").trim();
  if (!teamDomain || !aud) {
    return Response.json(
      {
        error: {
          code: ADMIN_ACCESS_NOT_CONFIGURED,
          message:
            "Admin access is not configured: both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are required, and admin routes deny all traffic until they are set",
        },
      },
      { status: 503 }
    );
  }
  const token = request.headers.get(ACCESS_ASSERTION_HEADER);
  if (!token) {
    return Response.json(
      { error: "Cloudflare Access assertion missing — the admin surface is only reachable through the Access-protected hostname" },
      { status: 401 }
    );
  }
  const verified = await verifyAccessJwt(teamDomain, aud, token);
  if (!verified.ok) {
    return Response.json({ error: `Cloudflare Access verification failed: ${verified.reason}` }, { status: 401 });
  }
  return null;
}
