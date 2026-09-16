// Wildcard Wazibiz site gateway (issue #48, FINAL-DECISION-RECORD decision 132).
//
// ONE small Worker serves every stable Site Address:
//   visitor -> https://{slug}.wazibiz.co.ke
//           -> proxied wildcard DNS -> Worker Route *.wazibiz.co.ke/*
//           -> here -> canonical publication lookup -> immutable origin
//
// Resolution authority is CANONICAL PUBLICATION STATE — never "latest
// deployment", "latest build" or "highest Build Version":
//   Host -> site_addresses -> site_published_state.current_publication_id
//        -> exact publications row (cross-checked, fail closed)
//
// The origin is CONSTRUCTED from the trusted worker_name plus the configured
// PUBLISHED_ORIGIN_SUFFIX — never fetched from an arbitrary persisted URL.
// When the persisted URL and the constructed origin disagree, this Worker
// fails closed and fetches nothing: it must never become an SSRF or
// open-proxy primitive. Responses are streamed without rewriting approved
// artifacts; the visitor URL always stays on the stable Site Address.

import { publishedOriginSuffix, sitesBaseDomain } from "../domain/site-address";

export interface SiteGatewayEnv {
  DB: D1Database;
  SITES_BASE_DOMAIN?: string;
  PUBLISHED_ORIGIN_SUFFIX?: string;
}

// Published-Worker naming contract (src/domain/publication.ts): the gateway
// only ever fetches hostnames that match it exactly.
const PUBLISHED_WORKER_NAME = /^pub-[a-z0-9]{1,10}-v[0-9]+$/;
const SITE_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export type GatewayRejection =
  | { kind: "not-found"; reason: string }
  | { kind: "fail-closed"; status: 502 | 503; reason: string };

export interface ResolvedOrigin {
  kind: "ok";
  origin: string;
  siteId: string;
  workerName: string;
}

// Normalizes and validates the incoming Host: it must be EXACTLY
// `{one-label}.{SITES_BASE_DOMAIN}` — not the apex, not a deeper subdomain,
// not a lookalike, no unexpected port, no malformed label.
export function parseSiteHost(hostHeader: string, baseDomain: string): string | null {
  let host = hostHeader.trim().toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  const portStart = host.lastIndexOf(":");
  if (portStart !== -1) {
    const port = host.slice(portStart + 1);
    if (!/^[0-9]+$/.test(port)) return null;
    host = host.slice(0, portStart);
  }
  const base = baseDomain.trim().toLowerCase();
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (!label || label.includes(".")) return null;
  if (!SITE_LABEL.test(label)) return null;
  return host;
}

// Canonical publication resolution. Every inconsistency fails closed with a
// diagnostic reason for the logs — never surfaced to visitors.
export async function resolveSiteOrigin(
  env: SiteGatewayEnv,
  siteHost: string
): Promise<ResolvedOrigin | GatewayRejection> {
  const address = await env.DB.prepare(
    "SELECT site_id, slug, host FROM site_addresses WHERE host = ?"
  )
    .bind(siteHost)
    .first<{ site_id: string; slug: string; host: string }>();
  if (!address) {
    return { kind: "not-found", reason: `no site address for ${siteHost}` };
  }

  const state = await env.DB.prepare(
    `SELECT current_publication_id, current_build_version_id, rollback_publication_id
     FROM site_published_state WHERE site_id = ?`
  )
    .bind(address.site_id)
    .first<{
      current_publication_id: string;
      current_build_version_id: string;
      rollback_publication_id: string | null;
    }>();
  if (!state) {
    // Known Site that has never been published: nothing to serve.
    return { kind: "not-found", reason: `site ${address.site_id} has no publication state` };
  }

  const publication = await env.DB.prepare(
    "SELECT id, site_id, build_version_id, worker_name, published_url, status FROM publications WHERE id = ?"
  )
    .bind(state.current_publication_id)
    .first<{
      id: string;
      site_id: string;
      build_version_id: string;
      worker_name: string;
      published_url: string;
      status: string;
    }>();
  if (!publication) {
    return { kind: "fail-closed", status: 502, reason: `current publication ${state.current_publication_id} missing` };
  }
  if (publication.site_id !== address.site_id) {
    return {
      kind: "fail-closed",
      status: 502,
      reason: `publication ${publication.id} belongs to site ${publication.site_id}, address to ${address.site_id}`,
    };
  }
  if (publication.build_version_id !== state.current_build_version_id) {
    return {
      kind: "fail-closed",
      status: 502,
      reason: `publication ${publication.id} version ${publication.build_version_id} is not current ${state.current_build_version_id}`,
    };
  }
  if (publication.status !== "published") {
    return { kind: "fail-closed", status: 502, reason: `publication ${publication.id} status ${publication.status}` };
  }

  const suffix = publishedOriginSuffix(env);
  if (!PUBLISHED_WORKER_NAME.test(publication.worker_name)) {
    return { kind: "fail-closed", status: 502, reason: `worker name ${publication.worker_name} violates the published naming contract` };
  }
  const origin = `https://${publication.worker_name}.${suffix}`;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { kind: "fail-closed", status: 502, reason: "constructed origin is not a valid URL" };
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hostname !== `${publication.worker_name}.${suffix}`
  ) {
    return { kind: "fail-closed", status: 502, reason: "constructed origin violates the trusted-origin contract" };
  }
  if (publication.published_url !== origin) {
    return {
      kind: "fail-closed",
      status: 502,
      reason: `persisted published URL ${publication.published_url} disagrees with constructed origin ${origin}`,
    };
  }

  return { kind: "ok", origin, siteId: address.site_id, workerName: publication.worker_name };
}

export async function handleSiteGatewayRequest(
  env: SiteGatewayEnv,
  request: Request,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  if (request.method === "GET" && new URL(request.url).pathname === "/__gateway-health") {
    return new Response("ok", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // The route-matched URL hostname is the authoritative request host; a Host
  // header that normalizes to something different is an injection attempt and
  // is rejected. Both paths must be exactly {one-label}.{SITES_BASE_DOMAIN}.
  const baseDomain = sitesBaseDomain(env);
  const urlHost = parseSiteHost(new URL(request.url).hostname, baseDomain);
  if (!urlHost) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const headerHost = request.headers.get("Host") ?? request.headers.get("host");
  if (headerHost && parseSiteHost(headerHost, baseDomain) !== urlHost) {
    console.error(`[site-gateway] host mismatch: URL ${urlHost} vs header ${headerHost}`);
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const siteHost = urlHost;

  let resolved: ResolvedOrigin | GatewayRejection;
  try {
    resolved = await resolveSiteOrigin(env, siteHost);
  } catch (error) {
    console.error(`[site-gateway] resolution failed for ${siteHost}: ${(error as Error).message}`);
    return new Response("Service unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  if (resolved.kind === "not-found") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  if (resolved.kind === "fail-closed") {
    console.error(`[site-gateway] fail-closed for ${siteHost}: ${resolved.reason}`);
    return new Response("Service unavailable", { status: resolved.status, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const upstreamUrl = `${resolved.origin}${new URL(request.url).pathname}${new URL(request.url).search}`;
  const forwardHeaders = new Headers(request.headers);
  forwardHeaders.delete("host");
  forwardHeaders.delete("connection");
  const upstream = new Request(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    // Trailing-slash normalization inside the origin is followed internally so
    // no workers.dev Location can ever leak to the visitor; a redirect chain
    // that lands OFF the constructed origin is refused below.
    redirect: "follow",
  });

  let response: Response;
  try {
    response = await fetchImpl(upstream);
  } catch (error) {
    console.error(`[site-gateway] origin fetch failed for ${siteHost}: ${(error as Error).message}`);
    return new Response("Service unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  // The only destination this Worker ever fetches is the constructed origin;
  // if the exchange landed anywhere else, do not serve the result.
  if (response.url && !response.url.startsWith(`${resolved.origin}/`)) {
    console.error(`[site-gateway] origin exchange left the trusted origin for ${siteHost}: ${response.url}`);
    return new Response("Service unavailable", { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("set-cookie");
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}
