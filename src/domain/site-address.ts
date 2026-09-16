// Stable public Site Addresses (issue #48, FINAL-DECISION-RECORD decision 132).
//
// One address `https://{site-slug}.{SITES_BASE_DOMAIN}` per Site identity,
// allocated exactly once at the canonical Site-creation boundary. The address
// belongs to the Site — never to a Build Version — so it is derived only from
// already-frozen identity inputs (the Business name) and never re-derived.
//
// The UNIQUE constraints on site_addresses.slug / site_addresses.host are the
// final collision authority: candidate INSERTs retry bounded `-2`, `-3`, ...
// suffixes; there is deliberately no SELECT-max heuristic, which would race
// under concurrent Site creations. Allocation is a D1 side effect only and
// must never alter frozen generation inputs (facts snapshot, Onboarding
// Submission, Blueprint/Builder/prompt/QA inputs, benchmark definitions).

import type { Env } from "../env.d";

export const SITES_BASE_DOMAIN_DEFAULT = "wazibiz.co.ke";
export const PUBLISHED_ORIGIN_SUFFIX_DEFAULT = "wazibizwebsites.workers.dev";

export function sitesBaseDomain(env: Pick<Env, "SITES_BASE_DOMAIN">): string {
  return env.SITES_BASE_DOMAIN?.trim() || SITES_BASE_DOMAIN_DEFAULT;
}

export function publishedOriginSuffix(env: Pick<Env, "PUBLISHED_ORIGIN_SUFFIX">): string {
  return env.PUBLISHED_ORIGIN_SUFFIX?.trim() || PUBLISHED_ORIGIN_SUFFIX_DEFAULT;
}

// DNS label ceiling. Every slug candidate keeps room for a `-NN` collision
// suffix by truncating the BASE slug to 63 - 3 characters BEFORE any suffix is
// appended, so even the widest legal candidate stays a single DNS label.
const MAX_DNS_LABEL = 63;
const MAX_SUFFIX_WIDTH = "-99".length;
const BASE_SLUG_MAX = MAX_DNS_LABEL - MAX_SUFFIX_WIDTH;
const MAX_ALLOCATION_ATTEMPTS = 64;

// First-level hostnames that must never be allocated to a Business: they
// belong to platform operations or are conventionally infrastructure-shaped.
// One central set — gateway host validation and allocation share it.
export const RESERVED_SITE_SLUGS: ReadonlySet<string> = new Set([
  "www", "admin", "api", "mail", "email", "smtp", "ftp", "ns1", "ns2", "app",
  "apps", "auth", "login", "dashboard", "builder", "gateway", "cdn", "static",
  "assets", "media", "status", "support", "help", "docs", "shop", "store",
  "pay", "payments", "forms", "form", "webhook", "webhooks", "preview",
  "staging", "stage", "dev", "test",
]);

export type SiteAddressErrorCode =
  | "SITE_ADDRESS_SITE_NOT_FOUND"
  | "SITE_ADDRESS_EXHAUSTED";

export class SiteAddressError extends Error {
  readonly code: SiteAddressErrorCode;

  constructor(code: SiteAddressErrorCode, message: string) {
    super(message);
    this.name = "SiteAddressError";
    this.code = code;
  }
}

// Deterministic, locale-independent slugification: Unicode-normalize, strip
// Latin diacritics where a base letter exists, lowercase, collapse every
// non-ASCII-alphanumeric run into one hyphen, trim, and keep the result inside
// the suffix-budgeted DNS label limit. A Business whose name reduces to
// nothing (e.g. all non-Latin characters) yields "" — the caller applies the
// deterministic fallback.
export function slugifyBusinessName(name: string): string {
  const decomposed = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dashed = decomposed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BASE_SLUG_MAX)
    .replace(/-+$/g, "");
  return dashed;
}

export function isReservedSiteSlug(slug: string): boolean {
  return RESERVED_SITE_SLUGS.has(slug);
}

export function fallbackSiteSlug(siteId: string): string {
  return `business-${siteId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}`;
}

export interface SiteAddress {
  siteId: string;
  slug: string;
  host: string;
  url: string;
}

// Read-only lookup of a Site's stable address. Returns null when the Site has
// no row yet (legacy Site awaiting backfill) — callers surface that honestly
// instead of synthesizing a URL.
export async function getSiteAddress(env: Env, siteId: string): Promise<SiteAddress | null> {
  const row = await env.DB.prepare(
    "SELECT site_id, slug, host FROM site_addresses WHERE site_id = ?"
  )
    .bind(siteId)
    .first<{ site_id: string; slug: string; host: string }>();
  return row ? toAddress(row.site_id, row.slug, row.host) : null;
}

function uniqueViolationFragment(error: unknown, fragment: string): boolean {
  return error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${fragment}`);
}

// Idempotent, deterministic, bounded: an existing address row always wins
// (allocation happens exactly once); a new one inserts candidate slugs until
// the UNIQUE authority accepts one. Concurrent creations of the same Site
// converge on the winner's row via the site_id primary key; concurrent
// creations of DIFFERENT Sites can never share a slug or host.
export async function getOrAllocateSiteAddress(
  env: Env,
  siteId: string
): Promise<SiteAddress> {
  const existing = await getSiteAddress(env, siteId);
  if (existing) {
    return existing;
  }

  const business = await env.DB.prepare(
    "SELECT b.name AS name FROM site_identities s JOIN businesses b ON b.id = s.business_id WHERE s.id = ?"
  )
    .bind(siteId)
    .first<{ name: string }>();
  if (!business) {
    throw new SiteAddressError(
      "SITE_ADDRESS_SITE_NOT_FOUND",
      `Site identity ${siteId} does not exist`
    );
  }

  const base = slugifyBusinessName(business.name);
  const reserved = !base || isReservedSiteSlug(base);
  const baseSlug = reserved ? fallbackSiteSlug(siteId) : base;
  const createdAt = new Date().toISOString();

  const tryLadder = async (ladderBase: string): Promise<SiteAddress | null> => {
    for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      // The base slug is already suffix-budgeted; appending -N stays a legal
      // DNS label for every attempt within the bounded maximum.
      const slug = attempt === 1 ? ladderBase : `${ladderBase}-${attempt}`;
      const host = `${slug}.${sitesBaseDomain(env)}`;
      try {
        await env.DB.prepare(
          "INSERT INTO site_addresses (site_id, slug, host, created_at) VALUES (?, ?, ?, ?)"
        )
          .bind(siteId, slug, host, createdAt)
          .run();
        return toAddress(siteId, slug, host);
      } catch (error) {
        if (uniqueViolationFragment(error, "site_addresses.site_id")) {
          // Same-site race: another caller completed the allocation. Its row
          // wins — allocate exactly once, never a second address.
          const winner = await getSiteAddress(env, siteId);
          if (winner) {
            return winner;
          }
        }
        if (
          uniqueViolationFragment(error, "site_addresses.slug") ||
          uniqueViolationFragment(error, "site_addresses.host")
        ) {
          continue;
        }
        throw error;
      }
    }
    return null;
  };

  // Ladder 1: the name-derived base. If a very common name has exhausted its
  // suffix ladder, ladder 2 derives from the Site identity itself — still
  // deterministic, collision-resistant and bounded — before failing.
  const fromName = await tryLadder(baseSlug);
  if (fromName) return fromName;
  const identityBase = fallbackSiteSlug(siteId);
  if (identityBase !== baseSlug) {
    const fromIdentity = await tryLadder(identityBase);
    if (fromIdentity) return fromIdentity;
  }

  throw new SiteAddressError(
    "SITE_ADDRESS_EXHAUSTED",
    `No free Site Address suffix within ${MAX_ALLOCATION_ATTEMPTS} attempts for "${baseSlug}"`
  );
}

function toAddress(siteId: string, slug: string, host: string): SiteAddress {
  return { siteId, slug, host, url: `https://${host}` };
}
