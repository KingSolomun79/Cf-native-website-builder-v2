// Operator capability tokens (issue #29, W4 from the #15 CSO pass).
//
// Approval and Rollback are the two human/operational release actions, and
// their routes must never trust an unauthenticated caller. A capability token
// is a short-lived HMAC-SHA256-signed credential minted OFFLINE by an operator
// holding OPERATOR_CAPABILITY_SECRET (scripts/mint-operator-capability.mjs);
// the Worker only ever verifies. There is deliberately no minting route: no
// HTTP surface, public or internal, can produce a token, so generated-site
// code and visitors cannot obtain one.
//
// Bindings follow the #15 CSO prescription — an Approval capability binds
// buildId + buildVersionId + artifactManifestHash, so a token minted for one
// Build Version can never approve another or survive manifest drift. A
// Rollback capability binds siteId + the Build Version that is current at
// mint time, so a stale token cannot roll a Site back after a newer
// publication has replaced what the operator reviewed.
//
// Verification fails closed: missing secret, malformed token, bad signature,
// expired or too-far-future expiry, or unknown shape all yield null.

import type { Env } from "../env.d";
import { hmacSha256, timingSafeEqualStrings } from "./crypto";

export type OperatorCapabilityAction = "approve" | "rollback";

/** Hard ceiling on token lifetime at verification time (defense against
 *  long-lived credentials minted with far-future expiry). */
export const OPERATOR_CAPABILITY_MAX_TTL_MS = 60 * 60_000;

export interface ApproveCapability {
  action: "approve";
  buildId: string;
  buildVersionId: string;
  artifactManifestHash: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

export interface RollbackCapability {
  action: "rollback";
  siteId: string;
  /** The Build Version that must STILL be the current Published Version when
   *  the token is used; anything newer invalidates the token. */
  fromBuildVersionId: string;
  exp: number;
}

export type OperatorCapability = ApproveCapability | RollbackCapability;

// Ids, hashes and other bound values are limited to this charset so the ':'
// delimiter of the canonical string below can never be smuggled into a field.
const BOUND_VALUE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function canonical(payload: OperatorCapability): string {
  switch (payload.action) {
    case "approve":
      return `v2opcap/1:approve:${payload.buildId}:${payload.buildVersionId}:${payload.artifactManifestHash}:${payload.exp}`;
    case "rollback":
      return `v2opcap/1:rollback:${payload.siteId}:${payload.fromBuildVersionId}:${payload.exp}`;
  }
}

function base64UrlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function signOperatorCapability(
  env: Env,
  payload: OperatorCapability
): Promise<string> {
  if (!env.OPERATOR_CAPABILITY_SECRET) {
    throw new Error("OPERATOR_CAPABILITY_SECRET is required to mint operator capabilities");
  }
  const sig = await hmacSha256(env.OPERATOR_CAPABILITY_SECRET, canonical(payload));
  return base64UrlEncode(JSON.stringify({ ...payload, sig }));
}

function boundFieldsValid(payload: OperatorCapability): boolean {
  switch (payload.action) {
    case "approve":
      return (
        BOUND_VALUE.test(payload.buildId ?? "") &&
        BOUND_VALUE.test(payload.buildVersionId ?? "") &&
        BOUND_VALUE.test(payload.artifactManifestHash ?? "")
      );
    case "rollback":
      return BOUND_VALUE.test(payload.siteId ?? "") && BOUND_VALUE.test(payload.fromBuildVersionId ?? "");
  }
}

/**
 * Verifies signature, format and expiry of an operator capability token and
 * returns its claims, or null for ANY denial reason (fail closed). Callers
 * must additionally check that the returned action and resource bindings
 * match the operation being attempted — a validly signed capability for the
 * wrong Build Version or Site is insufficient, not absent.
 */
export async function verifyOperatorCapability(
  env: Env,
  token: string | null | undefined,
  now: number = Date.now()
): Promise<OperatorCapability | null> {
  const secret = env.OPERATOR_CAPABILITY_SECRET;
  if (!secret || typeof token !== "string" || token.length === 0 || token.length > 4096) {
    return null;
  }

  let decoded: OperatorCapability & { sig?: unknown };
  try {
    decoded = JSON.parse(base64UrlDecode(token)) as OperatorCapability & { sig?: unknown };
  } catch {
    return null;
  }

  if (decoded.action !== "approve" && decoded.action !== "rollback") return null;
  if (typeof decoded.sig !== "string") return null;
  if (!boundFieldsValid(decoded)) return null;
  if (!Number.isSafeInteger(decoded.exp) || decoded.exp <= now || decoded.exp > now + OPERATOR_CAPABILITY_MAX_TTL_MS) {
    return null;
  }

  const expected = await hmacSha256(secret, canonical(decoded));
  if (!timingSafeEqualStrings(decoded.sig, expected)) return null;

  const { sig: _sig, ...claims } = decoded;
  return claims;
}
