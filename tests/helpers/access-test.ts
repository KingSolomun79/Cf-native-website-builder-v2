// Cloudflare Access test harness (2026-09-12 integration blocker 2): the
// admin guard REQUIRES cryptographic verification, so admin-facing tests sign
// real RS256 JWTs against a stubbed team JWKS endpoint. Each harness uses a
// UNIQUE team domain so the guard's per-host cert cache can never leak
// certificates between test files.

import { vi } from "vitest";

export interface AccessTokenOverrides {
  iss?: string;
  aud?: string | string[];
  exp?: number;
}

export interface AccessHarness {
  /** Env vars to spread into the runtime env under test. */
  envVars: { CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string };
  /** Public JWK (with kid) served by the stubbed team certs endpoint. */
  primaryJwk: JsonWebKey & { kid: string };
  /** Keypair NOT published by the stubbed JWKS (stands in for an attacker). */
  attacker: CryptoKeyPair;
  /** Headers carrying a validly signed, unexpired assertion. */
  validHeaders(): Promise<Record<string, string>>;
  /** Signs a token; overrides replace the default claims. */
  signToken(overrides?: AccessTokenOverrides, key?: CryptoKeyPair): Promise<string>;
  /**
   * Installs a global fetch stub: the team certs URL is served the harness
   * JWKS; every other URL goes to `fallback` (default: Turnstile-style
   * `{success:true}`).
   */
  stubFetch(fallback?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>): void;
}

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonBase64url(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

export async function createAccessHarness(slug: string): Promise<AccessHarness> {
  const teamDomain = `${slug}-access-test.cloudflareaccess.com`;
  const aud = `${slug}-access-aud`;
  const algorithm: RsaHashedKeyGenParams = {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  };
  const primary = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  const attacker = (await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"])) as CryptoKeyPair;
  const primaryJwk = {
    ...((await crypto.subtle.exportKey("jwk", primary.publicKey)) as JsonWebKey),
    kid: `${slug}-test-key`,
  };
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;

  async function signToken(overrides: AccessTokenOverrides = {}, key: CryptoKeyPair = primary): Promise<string> {
    const header = { alg: "RS256", kid: primaryJwk.kid, typ: "JWT" };
    const payload = {
      iss: `https://${teamDomain}`,
      aud,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: "operator@wazibiz.ke",
      ...overrides,
    };
    const signingInput = `${jsonBase64url(header)}.${jsonBase64url(payload)}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, encoder.encode(signingInput));
    return `${signingInput}.${base64url(signature)}`;
  }

  return {
    envVars: { CF_ACCESS_TEAM_DOMAIN: teamDomain, CF_ACCESS_AUD: aud },
    primaryJwk,
    attacker,
    validHeaders: async () => ({ "Cf-Access-Jwt-Assertion": await signToken() }),
    signToken,
    stubFetch(fallback) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url === certsUrl) {
            return new Response(JSON.stringify({ keys: [primaryJwk] }), { status: 200 });
          }
          if (!fallback) return new Response(JSON.stringify({ success: true }), { status: 200 });
          return await fallback(input, init);
        })
      );
    },
  };
}
