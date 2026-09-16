import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyOperatorCapability } from "../lib/operator-capability";
import {
  fallbackSiteSlug,
  getOrAllocateSiteAddress,
  isReservedSiteSlug,
  SiteAddressError,
  sitesBaseDomain,
  slugifyBusinessName,
} from "../domain/site-address";

// Operator Site-Address backfill route (issue #48, decision 132): gives every
// legacy Site identity (created before stable Site Addresses existed) exactly
// one stable public Site Address. Idempotent by construction — allocation
// happens once per Site and re-runs prove zero pending.
//
// Access model (mirrors Approval/Publication/Rollback/Benchmark routes): an
// offline-minted, action-bound operator capability ("site-address-backfill")
// is required; denial fails closed — 401 for a missing/invalid/expired token,
// 403 for a token bound to a different action. The route is never public,
// mints nothing, and never echoes secret values.
//
// Modes:
//   { dryRun: true }  -> report proposed site_id/business/slug/host per
//                        pending Site (preview only — the UNIQUE constraint,
//                        not this preview, is the allocation authority);
//   { dryRun: false } -> allocate for real through the canonical domain
//                        service (getOrAllocateSiteAddress), one item at a
//                        time with failure isolation; the response reports
//                        pendingAfter so an idempotent re-run proves zero
//                        remaining.

interface PendingSiteRow {
  site_id: string;
  business_name: string;
}

interface BackfillItem {
  siteId: string;
  business: string;
  slug: string | null;
  host: string | null;
  status: "proposed" | "allocated" | "failed";
  error?: string;
}

const MAX_SUFFIX = 64;

async function authorize(c: Context<{ Bindings: Env }>): Promise<Response | null> {
  const authorization = c.req.header("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  const capability = await verifyOperatorCapability(c.env, bearer);
  if (!capability) {
    console.warn("site-address backfill: denied — missing, invalid or expired capability");
    return c.json({ error: { code: "CAPABILITY_REQUIRED", message: "A valid, unexpired operator capability token is required" } }, 401);
  }
  if (capability.action !== "site-address-backfill") {
    console.warn("site-address backfill: denied — capability action is not site-address-backfill");
    return c.json({ error: { code: "CAPABILITY_INSUFFICIENT", message: "This capability does not authorize the Site-Address backfill" } }, 403);
  }
  return null;
}

async function listPendingSites(env: Env): Promise<PendingSiteRow[]> {
  const rows = await env.DB.prepare(
    `SELECT s.id AS site_id, b.name AS business_name
     FROM site_identities s JOIN businesses b ON b.id = s.business_id
     LEFT JOIN site_addresses a ON a.site_id = s.id
     WHERE a.site_id IS NULL
     ORDER BY s.created_at, s.id`
  ).all<PendingSiteRow>();
  return rows.results ?? [];
}

// Dry-run proposal: the same deterministic derivation the allocation service
// performs, previewed against currently allocated slugs AND the slugs already
// proposed earlier in this run — a duplicate-name batch previews the same
// `-2`, `-3` ladder the apply will produce. The UNIQUE constraint, not this
// preview, remains the allocation authority.
async function proposeSlug(
  env: Env,
  siteId: string,
  businessName: string,
  claimedInRun: Set<string>
): Promise<{ slug: string; reserved: boolean }> {
  const base = slugifyBusinessName(businessName);
  if (!base || isReservedSiteSlug(base)) {
    return { slug: fallbackSiteSlug(siteId), reserved: true };
  }
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (claimedInRun.has(candidate)) continue;
    const taken = await env.DB.prepare("SELECT 1 AS taken FROM site_addresses WHERE slug = ?").bind(candidate).first();
    if (!taken) return { slug: candidate, reserved: false };
  }
  return { slug: `${base}-…`, reserved: false };
}

export async function backfillSiteAddresses(c: Context<{ Bindings: Env }>): Promise<Response> {
  const denied = await authorize(c);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    const raw = await c.req.text();
    if (raw) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return c.json({ error: { code: "INPUT_INVALID", message: "Request body must be JSON" } }, 400);
  }
  const dryRun = body.dryRun !== false;

  const baseDomain = sitesBaseDomain(c.env);
  const pending = await listPendingSites(c.env);
  const items: BackfillItem[] = [];
  const claimedInRun = new Set<string>();

  for (const site of pending) {
    if (dryRun) {
      const { slug, reserved } = await proposeSlug(c.env, site.site_id, site.business_name, claimedInRun);
      claimedInRun.add(slug);
      items.push({
        siteId: site.site_id,
        business: site.business_name,
        slug,
        host: `${slug}.${baseDomain}`,
        status: "proposed",
        ...(reserved ? { error: "business name is reserved or empty; deterministic fallback slug proposed" } : {}),
      });
      continue;
    }
    try {
      const address = await getOrAllocateSiteAddress(c.env, site.site_id);
      claimedInRun.add(address.slug);
      items.push({
        siteId: site.site_id,
        business: site.business_name,
        slug: address.slug,
        host: address.host,
        status: "allocated",
      });
    } catch (error) {
      // Failure isolation: one Site's allocation problem never blocks the
      // rest; the error is reported per item and the run stays inspectable.
      const message = error instanceof SiteAddressError ? `${error.code}: ${error.message}` : (error as Error).message;
      console.error(`[site-address-backfill] failed for site ${site.site_id}: ${message}`);
      items.push({ siteId: site.site_id, business: site.business_name, slug: null, host: null, status: "failed", error: message });
    }
  }

  const pendingAfter = dryRun ? pending.length : (await listPendingSites(c.env)).length;
  return c.json({ dryRun, baseDomain, pending: pending.length, items, pendingAfter });
}
