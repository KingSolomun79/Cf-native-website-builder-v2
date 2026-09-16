import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { generateId, nowIso } from "../src/lib/crypto";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { getOrAllocateSiteAddress, sitesBaseDomain } from "../src/domain/site-address";
import { handleSiteGatewayRequest, parseSiteHost } from "../src/site-gateway/gateway";

// Wildcard Wazibiz site gateway (issue #48, decision 132): host validation,
// canonical-publication resolution (never "latest"), SSRF-safe origin
// construction, streaming proxy behavior and fail-closed integrity.

const env = providedEnv as unknown as Env;
const BASE = sitesBaseDomain(env);
const ORIGIN_SUFFIX = "wazibizwebsites.workers.dev";

function stem(): string {
  return `gw${Math.random().toString(36).slice(2, 10)}`;
}

async function seededPublishedSite(options?: { businessName?: string }): Promise<{
  siteId: string;
  buildId: string;
  bv1: string;
  bv2: string;
  pub1: string;
  pub2: string;
  worker1: string;
  worker2: string;
  host: string;
}> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: options?.businessName ?? `Gateway Traders ${stem()}`, contactEmail: "hi@gw.example", ...canonicalStructuredFacts() },
      reference: { screenshotR2Key: `references/uploads/gw-${stem()}.png` },
    },
  });
  const address = await getOrAllocateSiteAddress(env, started.siteId);
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  // The initial Build already carries version_number 1; V2 is seeded on top.
  const bv1 = created.buildVersionId;
  const bv2 = generateId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO build_versions (id, build_id, version_number, created_at) VALUES (?, ?, 2, ?)").bind(bv2, created.buildId, nowIso()),
  ]);
  const worker1 = `pub-${created.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v1`;
  const worker2 = `pub-${created.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v2`;
  const pub1 = generateId();
  const pub2 = generateId();
  const ts = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO publications (id, site_id, build_id, build_version_id, artifact_manifest_hash, worker_name, published_url, status, attempt, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'hash1', ?, ?, 'published', 1, ?, ?)`
    ).bind(pub1, started.siteId, created.buildId, bv1, worker1, `https://${worker1}.${ORIGIN_SUFFIX}`, ts, ts),
    env.DB.prepare(
      `INSERT INTO publications (id, site_id, build_id, build_version_id, artifact_manifest_hash, worker_name, published_url, status, attempt, created_at, completed_at)
       VALUES (?, ?, ?, ?, 'hash2', ?, ?, 'published', 1, ?, ?)`
    ).bind(pub2, started.siteId, created.buildId, bv2, worker2, `https://${worker2}.${ORIGIN_SUFFIX}`, ts, ts),
    env.DB.prepare(
      `INSERT INTO site_published_state (site_id, current_publication_id, current_build_version_id, rollback_publication_id, rollback_build_version_id, rollback_expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(started.siteId, pub1, bv1, null, null, null, ts),
  ]);
  return {
    siteId: started.siteId,
    buildId: created.buildId,
    bv1,
    bv2,
    pub1,
    pub2,
    worker1,
    worker2,
    host: address.host,
  };
}

function makeState(siteId: string, currentPublicationId: string, currentBuildVersionId: string, ts = nowIso()): Promise<unknown> {
  return env.DB.prepare(
    `UPDATE site_published_state SET current_publication_id = ?, current_build_version_id = ?, updated_at = ? WHERE site_id = ?`
  )
    .bind(currentPublicationId, currentBuildVersionId, ts, siteId)
    .run();
}

function gatewayRequest(path: string, init?: RequestInit): Request {
  return new Request(`https://gateway-host/${path.replace(/^\//, "")}`, init);
}

async function serve(host: string, path: string, fetchImpl: typeof fetch, init?: RequestInit): Promise<Response> {
  return handleSiteGatewayRequest(env, new Request(`https://${host}${path}`, init), fetchImpl);
}

function recordingFetch(response: Response): { fetch: typeof fetch; calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    calls.push({ url, method });
    return response;
  }) as typeof fetch;
  return { fetch: impl, calls };
}

describe("host validation", () => {
  it("accepts exactly one label over the base domain and normalizes case", () => {
    expect(parseSiteHost("Rift-Valley-Roasters.Wazibiz.Co.Ke", "wazibiz.co.ke")).toBe("rift-valley-roasters.wazibiz.co.ke");
    expect(parseSiteHost("rift-valley-roasters.wazibiz.co.ke:443", "wazibiz.co.ke")).toBe("rift-valley-roasters.wazibiz.co.ke");
    expect(parseSiteHost("rift-valley-roasters.wazibiz.co.ke.", "wazibiz.co.ke")).toBe("rift-valley-roasters.wazibiz.co.ke");
  });

  it("rejects the apex, deeper subdomains, lookalikes, ports and malformed labels", () => {
    expect(parseSiteHost("wazibiz.co.ke", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("a.b.wazibiz.co.ke", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("evilwazibiz.co.ke", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("wazibiz.co.ke.evil.com", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("-bad-.wazibiz.co.ke", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("under_score.wazibiz.co.ke", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("host.wazibiz.co.ke:abc", "wazibiz.co.ke")).toBeNull();
    expect(parseSiteHost("", "wazibiz.co.ke")).toBeNull();
  });
});

describe("gateway serving", () => {
  it("answers its health endpoint without any lookup", async () => {
    const response = await handleSiteGatewayRequest(env, gatewayRequest("__gateway-health"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("404s unknown hosts, the apex, and Sites that have never published", async () => {
    const noFetch = recordingFetch(new Response("should not be fetched", { status: 200 }));
    expect((await serve(`unknown-${stem()}.${BASE}`, "/", noFetch.fetch)).status).toBe(404);
    expect((await serve(BASE, "/", noFetch.fetch)).status).toBe(404);
    expect((await serve(`deep.host.${BASE}`, "/", noFetch.fetch)).status).toBe(404);
    const neverPublished = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: `Never Published ${stem()}`, contactEmail: "hi@np.example", ...canonicalStructuredFacts() },
        reference: { screenshotR2Key: `references/uploads/np-${stem()}.png` },
      },
    });
    const address = await getOrAllocateSiteAddress(env, neverPublished.siteId);
    expect((await serve(address.host, "/", noFetch.fetch)).status).toBe(404);
    expect(noFetch.calls).toEqual([]);
  });

  it("serves the exact current publication origin, preserving path, query and method", async () => {
    const site = await seededPublishedSite();
    const { fetch: fetchImpl, calls } = recordingFetch(
      new Response("<html>v1</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    );
    const response = await serve(site.host, "/about?ref=home", fetchImpl, { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>v1</html>");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(calls).toEqual([{ url: `https://${site.worker1}.${ORIGIN_SUFFIX}/about?ref=home`, method: "GET" }]);
    expect(calls[0].url.startsWith(`https://${site.host}`)).toBe(false);

    const postFetch = recordingFetch(new Response("accepted", { status: 200 }));
    await serve(site.host, "/api", postFetch.fetch, { method: "POST", body: "x=1" });
    expect(postFetch.calls[0].method).toBe("POST");
  });

  it("publish V2 then rollback: the SAME hostname serves whichever exact version is current, with no state mutation", async () => {
    const site = await seededPublishedSite();
    const { fetch: fetchImpl, calls } = recordingFetch(new Response("ok", { status: 200 }));

    await makeState(site.siteId, site.pub2, site.bv2);
    let response = await serve(site.host, "/", fetchImpl);
    expect(response.status).toBe(200);
    expect(calls.at(-1)!.url).toBe(`https://${site.worker2}.${ORIGIN_SUFFIX}/`);

    // Rollback = the canonical state flip back to the retained publication.
    await makeState(site.siteId, site.pub1, site.bv1);
    response = await serve(site.host, "/", fetchImpl);
    expect(calls.at(-1)!.url).toBe(`https://${site.worker1}.${ORIGIN_SUFFIX}/`);
    expect(response.status).toBe(200);

    const rows = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM site_addresses WHERE site_id = ?"
    )
      .bind(site.siteId)
      .first<{ n: number }>();
    expect(rows!.n).toBe(1);
  });

  it("never resolves 'latest' — the canonical publication row is the only authority", async () => {
    const site = await seededPublishedSite();
    const { fetch: fetchImpl, calls } = recordingFetch(new Response("ok", { status: 200 }));
    // A NEWER published publication row exists (pub2) but the canonical state
    // still points at pub1: the gateway must keep serving pub1's origin.
    await serve(site.host, "/", fetchImpl);
    expect(calls[0].url).toBe(`https://${site.worker1}.${ORIGIN_SUFFIX}/`);
  });
});

describe("gateway fail-closed integrity", () => {
  it("refuses a publication still in 'publishing' state", async () => {
    const site = await seededPublishedSite();
    await env.DB.prepare("UPDATE publications SET status = 'publishing' WHERE id = ?").bind(site.pub1).run();
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    const response = await serve(site.host, "/", noFetch.fetch);
    expect([502, 503]).toContain(response.status);
    expect(noFetch.calls).toEqual([]);
  });

  it("refuses when the publication belongs to a different Site", async () => {
    const other = await seededPublishedSite();
    const site = await seededPublishedSite();
    await env.DB.prepare("UPDATE site_published_state SET current_publication_id = ? WHERE site_id = ?")
      .bind(other.pub1, site.siteId)
      .run();
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    const response = await serve(site.host, "/", noFetch.fetch);
    expect(response.status).toBe(502);
    expect(noFetch.calls).toEqual([]);
  });

  it("refuses when the publication's Build Version is not the current one", async () => {
    const site = await seededPublishedSite();
    // State points at V1 but the current_build_version_id claims V2: a
    // corrupted half-flip must never serve either version.
    await env.DB.prepare("UPDATE site_published_state SET current_build_version_id = ? WHERE site_id = ?")
      .bind(site.bv2, site.siteId)
      .run();
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    const response = await serve(site.host, "/", noFetch.fetch);
    expect(response.status).toBe(502);
    expect(noFetch.calls).toEqual([]);
  });

  it("refuses a persisted URL that disagrees with the constructed origin (no arbitrary fetch)", async () => {
    const site = await seededPublishedSite();
    await env.DB.prepare("UPDATE publications SET published_url = ? WHERE id = ?")
      .bind(`https://${site.worker1}.evil.example`, site.pub1)
      .run();
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    const response = await serve(site.host, "/", noFetch.fetch);
    expect(response.status).toBe(502);
    expect(noFetch.calls).toEqual([]);
  });

  it("refuses a worker name violating the published naming contract", async () => {
    const site = await seededPublishedSite();
    await env.DB.prepare("UPDATE publications SET worker_name = ?, published_url = ? WHERE id = ?")
      .bind(`b-${site.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v1`, `https://b-${site.buildId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}-v1.${ORIGIN_SUFFIX}`, site.pub1)
      .run();
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    const response = await serve(site.host, "/", noFetch.fetch);
    expect(response.status).toBe(502);
    expect(noFetch.calls).toEqual([]);
  });

  it("refuses to serve an origin exchange that left the trusted origin", async () => {
    const site = await seededPublishedSite();
    const rogue = new Response("external content", { status: 200 });
    Object.defineProperty(rogue, "url", { value: "https://evil.example/redirected" });
    const impl = (async () => rogue) as typeof fetch;
    const response = await serve(site.host, "/", impl);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Service unavailable");
  });

  it("mishandled D1 failures fail closed as 503", async () => {
    const brokenEnv = {
      DB: {
        prepare: () => {
          throw new Error("d1 down");
        },
      },
    } as unknown as Env;
    const noFetch = recordingFetch(new Response("x", { status: 200 }));
    // A syntactically valid host under the gateway's base domain so host
    // validation passes and the failure happens at the D1 boundary.
    const response = await handleSiteGatewayRequest(
      brokenEnv,
      new Request("https://anything.wazibiz.co.ke/"),
      noFetch.fetch
    );
    expect(response.status).toBe(503);
    expect(noFetch.calls).toEqual([]);
  });
});
