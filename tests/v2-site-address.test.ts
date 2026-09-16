import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { generateId, nowIso, sha256Hex } from "../src/lib/crypto";
import { startSiteGeneration } from "../src/domain/lifecycle";
import {
  RESERVED_SITE_SLUGS,
  SiteAddressError,
  fallbackSiteSlug,
  getOrAllocateSiteAddress,
  getSiteAddress,
  isReservedSiteSlug,
  slugifyBusinessName,
  sitesBaseDomain,
} from "../src/domain/site-address";
import { signOperatorCapability } from "../src/lib/operator-capability";
import { backfillSiteAddresses } from "../src/routes/v2.site-address-backfill";
import { Hono } from "hono";

// Stable public Site Addresses (issue #48, decision 132): deterministic
// slugs, central reserved names, UNIQUE-authority collision handling,
// exactly-once allocation per Site identity, immutability, and the proof
// that allocation is a D1 side effect that never perturbs the frozen
// generation inputs.

const env = providedEnv as unknown as Env;
const BASE = sitesBaseDomain(env);

// Shared persistent test storage: every test uses a random stem so runs stay
// independent and exact-suffix assertions stay valid within a run.
function stem(): string {
  return `zz${Math.random().toString(36).slice(2, 10)}`;
}

async function seedSite(businessName: string): Promise<string> {
  const siteId = generateId();
  const businessId = generateId();
  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO businesses (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(businessId, businessName, ts, ts),
    env.DB.prepare("INSERT INTO site_identities (id, business_id, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(siteId, businessId, ts, ts),
  ]);
  return siteId;
}

describe("slug derivation", () => {
  it("derives a kebab slug from an ordinary business name", () => {
    expect(slugifyBusinessName("Rift Valley Roasters")).toBe("rift-valley-roasters");
  });

  it("collapses punctuation and repeated hyphens", () => {
    expect(slugifyBusinessName("Mama's  Best -- Foods & (Grill)!")).toBe("mama-s-best-foods-grill");
  });

  it("strips Latin diacritics", () => {
    expect(slugifyBusinessName("Café Ürüm Naïve")).toBe("cafe-urum-naive");
  });

  it("yields empty for all-non-Latin names (caller applies the fallback)", () => {
    expect(slugifyBusinessName("日本語 レストラン")).toBe("");
  });

  it("keeps the base slug inside the suffix-budgeted DNS label limit", () => {
    const long = slugifyBusinessName("a".repeat(200));
    expect(long.length).toBe(60);
    // With the widest suffix appended the final label stays a legal 63.
    expect(`${long}-64`.length).toBeLessThanOrEqual(63);
  });

  it("trims trailing hyphens after truncation", () => {
    // 60 chars of "a-" land exactly on a hyphen; the re-trim removes it.
    const slug = slugifyBusinessName("a-".repeat(40));
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.length).toBe(59);
  });

  it("knows the central reserved set", () => {
    for (const reserved of ["www", "admin", "api", "mail", "preview", "test", "builder", "gateway"]) {
      expect(isReservedSiteSlug(reserved)).toBe(true);
    }
    expect(isReservedSiteSlug("rift-valley-roasters")).toBe(false);
    expect(RESERVED_SITE_SLUGS.has("shop")).toBe(true);
  });
});

describe("address allocation", () => {
  it("allocates the base slug to the first Site, -2/-3 to duplicates", async () => {
    const name = `Kilimani Dental ${stem()}`;
    const first = await getOrAllocateSiteAddress(env, await seedSite(name));
    const second = await getOrAllocateSiteAddress(env, await seedSite(name));
    const third = await getOrAllocateSiteAddress(env, await seedSite(name));
    const slug = slugifyBusinessName(name);
    expect(first.slug).toBe(slug);
    expect(second.slug).toBe(`${slug}-2`);
    expect(third.slug).toBe(`${slug}-3`);
    expect(first.host).toBe(`${slug}.${BASE}`);
    expect(first.url).toBe(`https://${first.host}`);
    expect(second.host).toBe(`${slug}-2.${BASE}`);
  });

  it("never allocates a reserved label", async () => {
    const address = await getOrAllocateSiteAddress(env, await seedSite("API"));
    expect(address.slug).not.toBe("api");
    expect(address.slug.startsWith("business-")).toBe(true);
  });

  it("uses the deterministic business-{shortSiteId} fallback for non-Latin names", async () => {
    const siteId = await seedSite("日本語 レストラン");
    const address = await getOrAllocateSiteAddress(env, siteId);
    expect(address.slug).toBe(fallbackSiteSlug(siteId));
    expect(address.host).toBe(`${fallbackSiteSlug(siteId)}.${BASE}`);
  });

  it("keeps collision suffixes inside the 63-character DNS label", async () => {
    const name = `b${stem()} ${"k".repeat(120)}`;
    const first = await getOrAllocateSiteAddress(env, await seedSite(name));
    const second = await getOrAllocateSiteAddress(env, await seedSite(name));
    expect(first.slug.length).toBeLessThanOrEqual(60);
    expect(second.slug.length).toBeLessThanOrEqual(63);
    expect(second.slug).toBe(`${first.slug}-2`);
  });

  it("is idempotent: the same Site always receives the same address", async () => {
    const siteId = await seedSite(`Idempotent Roasters ${stem()}`);
    const first = await getOrAllocateSiteAddress(env, siteId);
    const again = await getOrAllocateSiteAddress(env, siteId);
    expect(again).toEqual(first);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_addresses WHERE site_id = ?").bind(siteId).first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("never gives two concurrent creations of the same Site different addresses", async () => {
    const siteId = await seedSite(`Concurrent Cafe ${stem()}`);
    const [a, b] = await Promise.all([
      getOrAllocateSiteAddress(env, siteId),
      getOrAllocateSiteAddress(env, siteId),
    ]);
    expect(a.slug).toBe(b.slug);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_addresses WHERE site_id = ?").bind(siteId).first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("never gives two different Sites the same address", async () => {
    const name = `Duplicate Names Ltd ${stem()}`;
    const a = await getOrAllocateSiteAddress(env, await seedSite(name));
    const b = await getOrAllocateSiteAddress(env, await seedSite(name));
    expect(a.slug).not.toBe(b.slug);
    expect(a.host).not.toBe(b.host);
  });

  it("fails explicitly when the site identity does not exist", async () => {
    await expect(getOrAllocateSiteAddress(env, generateId())).rejects.toMatchObject({ code: "SITE_ADDRESS_SITE_NOT_FOUND" });
  });

  it("enforces address immutability at the storage boundary", async () => {
    const siteId = await seedSite(`Immutable Traders ${stem()}`);
    const address = await getOrAllocateSiteAddress(env, siteId);
    await expect(
      env.DB.prepare("UPDATE site_addresses SET slug = 'hijacked' WHERE site_id = ?").bind(siteId).run()
    ).rejects.toThrow("SITE_ADDRESS_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM site_addresses WHERE slug = ?").bind(address.slug).run()
    ).rejects.toThrow("SITE_ADDRESS_IMMUTABLE");
  });
});

describe("allocation integration with the lifecycle", () => {
  it("allocates at Site creation without perturbing the frozen submission inputs", async () => {
    const facts = {
      businessName: `Lifecycle Bakers ${stem()}`,
      contactEmail: "hi@lifecycle.example",
      ...canonicalStructuredFacts(),
    };
    const payload = {
      buildMode: "REFERENCE_BOUND" as const,
      facts,
      reference: { screenshotR2Key: `references/uploads/lc-${stem()}.png` },
    };
    const started = await startSiteGeneration(env, { payload });
    expect(started.siteAddress.slug).toBe(slugifyBusinessName(facts.businessName));
    expect(started.siteAddress.host.endsWith(`.${BASE}`)).toBe(true);

    const row = await env.DB.prepare(
      "SELECT payload_json, checksum, fact_snapshot_json FROM onboarding_submissions WHERE id = ?"
    )
      .bind(started.onboardingSubmissionId)
      .first<{ payload_json: string; checksum: string; fact_snapshot_json: string }>();
    // The frozen payload carries ONLY the generation inputs — the address
    // side effect added nothing to it (benchmark baseline protection).
    expect(Object.keys(JSON.parse(row!.payload_json)).sort()).toEqual(["buildMode", "facts", "reference"]);
    // Same canonical (sorted-key) stringification the lifecycle freezes.
    const sortedStringify = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(sortedStringify).join(",")}]`;
      if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${sortedStringify(v)}`).join(",")}}`;
      }
      return JSON.stringify(value) ?? "null";
    };
    const canonicalPayload = sortedStringify({
      buildMode: payload.buildMode,
      facts,
      reference: payload.reference,
    });
    expect(row!.checksum).toBe(await sha256Hex(canonicalPayload));
    expect(JSON.parse(row!.fact_snapshot_json).businessName).toBe(facts.businessName);

    // A replacement Site Generation on the same Site keeps the address.
    const next = await startSiteGeneration(env, {
      siteId: started.siteId,
      payload: { ...payload, facts: { ...facts, businessName: `Renamed Bakers ${stem()}` } },
    });
    expect(next.siteAddress.slug).toBe(started.siteAddress.slug);
  });

  it("keeps the address when the Business name later changes", async () => {
    const siteId = await seedSite(`Rename Me Traders ${stem()}`);
    const before = await getOrAllocateSiteAddress(env, siteId);
    await env.DB.prepare("UPDATE businesses SET name = ? WHERE id = (SELECT business_id FROM site_identities WHERE id = ?)")
      .bind("Completely New Name", siteId)
      .run();
    const after = await getOrAllocateSiteAddress(env, siteId);
    expect(after.slug).toBe(before.slug);
    expect(after.host).toBe(before.host);
  });

  it("reads an address back honestly as null for a Site without one", async () => {
    const siteId = await seedSite(`No Address Yet ${stem()}`);
    expect(await getSiteAddress(env, siteId)).toBeNull();
  });
});

describe("operator backfill route", () => {
  function backfillApp(): Hono<{ Bindings: Env }> {
    const app = new Hono<{ Bindings: Env }>();
    app.post("/api/v2/operator/site-addresses/backfill", backfillSiteAddresses);
    return app;
  }

  async function postBackfill(token: string | null, body: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    return backfillApp().request(
      "https://test.example.com/api/v2/operator/site-addresses/backfill",
      { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) },
      env
    );
  }

  it("denies without a capability and rejects a foreign action", async () => {
    expect((await postBackfill(null, { dryRun: true })).status).toBe(401);
    const foreign = await signOperatorCapability(env, { action: "benchmark", caseId: "bench-01", exp: Date.now() + 60_000 });
    expect((await postBackfill(foreign, { dryRun: true })).status).toBe(403);
  });

  it("dry-run proposes addresses without writing any row", async () => {
    const name = `Backfill Preview Co ${stem()}`;
    const a = await seedSite(name);
    const b = await seedSite(name);
    const token = await signOperatorCapability(env, { action: "site-address-backfill", exp: Date.now() + 60_000 });
    const response = await postBackfill(token, { dryRun: true });
    expect(response.status).toBe(200);
    const report = (await response.json()) as { dryRun: boolean; pending: number; pendingAfter: number; items: Array<{ siteId: string; slug: string; status: string }> };
    expect(report.dryRun).toBe(true);
    const mine = report.items.filter((item) => item.siteId === a || item.siteId === b);
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((item) => item.slug))).toEqual(
      new Set([slugifyBusinessName(name), `${slugifyBusinessName(name)}-2`])
    );
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_addresses WHERE site_id IN (?, ?)").bind(a, b).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  it("apply allocates through the canonical service and a re-run proves zero pending", async () => {
    const name = `Backfill Apply Co ${stem()}`;
    const a = await seedSite(name);
    const b = await seedSite(name);
    const token = await signOperatorCapability(env, { action: "site-address-backfill", exp: Date.now() + 60_000 });

    const first = await postBackfill(token, { dryRun: false });
    expect(first.status).toBe(200);
    const report = (await first.json()) as { dryRun: boolean; pendingAfter: number; items: Array<{ siteId: string; host: string | null; status: string }> };
    expect(report.dryRun).toBe(false);
    const mine = report.items.filter((item) => item.siteId === a || item.siteId === b);
    expect(mine.every((item) => item.status === "allocated" && item.host !== null)).toBe(true);
    expect(new Set(mine.map((item) => item.host)).size).toBe(2);
    expect(report.pendingAfter).toBe(0);

    // Idempotent: a second apply finds nothing left to do.
    const second = await postBackfill(token, { dryRun: false });
    const secondReport = (await second.json()) as { pending: number; pendingAfter: number; items: Array<{ siteId: string }> };
    expect(secondReport.pending).toBe(0);
    expect(secondReport.pendingAfter).toBe(0);
    expect(secondReport.items.filter((item) => item.siteId === a || item.siteId === b)).toHaveLength(0);

    // The allocated addresses are the exact stable ones.
    expect((await getSiteAddress(env, a))!.host).toBe(mine.find((item) => item.siteId === a)!.host);
    expect((await getSiteAddress(env, b))!.host).toBe(mine.find((item) => item.siteId === b)!.host);
  });
});
