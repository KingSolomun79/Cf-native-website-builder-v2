# V2 CSO — Stable Site Addresses + Wildcard Wazibiz Site Gateway (#48)

Date: 2026-09-16
Scope: uncommitted working tree for issue #48 (migrations/0040, src/domain/site-address.ts, src/site-gateway/, src/routes/v2.site-address-backfill.ts, publication/form/admin surfacing, operator-capability "site-address-backfill" action, wrangler configs incl. wrangler.gateway.jsonc, docs).
Verification at audit time: `npm test` 624/624 PASS (52 files), `npm run typecheck` PASS.

## 1. What was audited

- Gateway Worker `cf-site-gateway-v2` (`src/site-gateway/gateway.ts`, `index.ts`, `wrangler.gateway.jsonc`): public wildcard serving surface.
- Address allocation service (`src/domain/site-address.ts`) + lifecycle hook in `startSiteGeneration`.
- New operator route `POST /api/v2/operator/site-addresses/backfill` + new capability action.
- Publication/rollback/admin additive `siteUrl` surfacing; `ensureSiteAddressFormOrigin` form-origin provisioning.
- Config vars `SITES_BASE_DOMAIN`, `PUBLISHED_ORIGIN_SUFFIX`; D1 migration `0040_v2_site_addresses.sql` (immutability triggers).

## 2. Security scope

New PUBLIC serving surface (gateway), one new authenticated mutating operator route, form-origin allowlist data path, hostname allocation, wildcard DNS/Worker Route activation plan (production). Touches: public endpoints, D1 access, admin tooling, origin-fetch (SSRF-class) logic.

## 3. Attack-surface summary

- Visitor → `https://{slug}.wazibiz.co.ke` → wildcard route → gateway → D1 lookups → fetch to internal published Worker origin.
- Operator → capability-gated backfill route (offline-minted token).
- Generated sites → central Form Service (origin allowlist now includes the stable Site Address).
- No new secrets; no browser-controlled value reaches origin selection or hostname construction.

## 4. Findings

### F1 — SSRF / open-proxy via gateway origin fetch — VERIFIED MITIGATED (High class, by design)
Evidence (`src/site-gateway/gateway.ts`): the origin is CONSTRUCTED as `https://{worker_name}.{PUBLISHED_ORIGIN_SUFFIX}` only; `worker_name` must match `/^pub-[a-z0-9]{1,10}-v[0-9]+$/`; the persisted `published_url` must EQUAL the constructed origin or the gateway fails closed (502) and fetches nothing; no persisted URL is ever fetched; URL parse re-validated (https, no userinfo, no port). Tests: origin-tamper, wrong-suffix, wrong-naming-contract cases all prove zero upstream fetches. Redirect-following is bounded by a post-exchange check — a chain landing off the constructed origin is refused (502, content never served). Remaining exposure: the gateway could be asked to fetch `https://{valid-published-worker}.workers.dev` paths only — that IS its job.

### F2 — Host-header injection — VERIFIED MITIGATED (High class)
The route-matched URL hostname is authoritative; a `Host` header that normalizes differently is rejected (404) — test: host mismatch. `parseSiteHost` accepts exactly `{one-label}.{SITES_BASE_DOMAIN}`: apex, deeper subdomains, lookalikes (`evilwazibiz.co.ke`, `wazibiz.co.ke.evil.com`), non-DNS labels and non-numeric ports are rejected — all pinned by tests.

### F3 — Cross-Site publication resolution / canonical-state integrity — VERIFIED MITIGATED (High class)
Resolution goes host → `site_addresses` → `site_published_state.current_publication_id` → `publications`, with three fail-closed cross-checks (site identity match, build-version match, status == 'published'). Tests prove the gateway never serves "latest" and refuses corrupted half-flips (502). Never "latest deployment/build/version".

### F4 — Wildcard routing blast radius (route interception of existing services) — OPERATIONAL, ORDERED (Medium class, deferred by design)
The wildcard DNS record and Worker Route `*.wazibiz.co.ke/*` are NOT applied by this change: `wrangler.gateway.jsonc` ships with routes commented out and activation is manual, LAST in the deployment order, gated on a recorded zone audit (inventory of existing wazibiz.co.ke DNS records and Worker routes; HOLD + report if any real first-level subdomain would be intercepted). No code path can activate the wildcard surface implicitly.

### F5 — Backfill route authorization — VERIFIED MITIGATED (High class)
Offline-minted, HMAC-signed, action-bound token (`site-address-backfill`), 60-minute verification ceiling, deny-by-default when `OPERATOR_CAPABILITY_SECRET` is unset; 401 for missing/invalid/expired, 403 for wrong action — pinned by tests. The route mints nothing, exposes no secrets, and its response (site ids, business names, proposed hosts) is operator-only data. Allocation is idempotent and per-item failure-isolated.

### F6 — Reserved-hostname takeover / slug spoofing — VERIFIED MITIGATED (Medium class)
One central reserved set (www, admin, api, mail, … 36 labels) blocks allocation of platform-shaped hostnames; deterministic `business-{shortSiteId}` fallback replaces them (tested). Slug charset is `[a-z0-9-]`, suffix-budgeted to stay a legal DNS label; Unicode names are NFD-normalized and diacritic-stripped, so homoglyph material (e.g. Cyrillic lookalikes) collapses to hyphens rather than mapping onto ASCII — no lookalike host inside the namespace. `businesses.name` later changing cannot move an address (immutable rows, tested).

### F7 — Collision allocation races — VERIFIED MITIGATED (Medium class)
The UNIQUE constraints are the authority; candidates retry bounded `-2`, `-3`, … ladders, and a same-site race converges on the winner's row via the `site_id` PK (no second address). Tested: concurrent same-site allocation yields exactly one row/address; two different Sites never share a host. If a name ladder somehow exhausts, a deterministic identity-derived ladder runs before an explicit `SITE_ADDRESS_EXHAUSTED` failure — no random slugs, no unbounded loop.

### F8 — Contact-form origin security — VERIFIED MITIGATED / WEAKENING-FREE (High class)
Origin validation remains exact-match against `site_configurations.form_allowed_origins_json`; the provisioning hook appends ONLY the Site's own stable address, preserves operator-owned fields, never adds wildcards, and provisions no row when no valid default destination resolves (fail closed, unchanged rejection behavior). Tests: exact stable origin accepted; unrelated, workers.dev and sibling-subdomain origins rejected; Turnstile and recipient/sender immutability unchanged.

### F9 — Information disclosure via new surfaces — VERIFIED OK (Low class)
Gateway rejection bodies are static ("Not found"/"Service unavailable"); diagnostic reasons go to logs only. `/__gateway-health` returns a constant with no data and no D1 access. The public intake route returns an explicit field list — `siteAddress` is NOT added to its response. Admin page renders the site address; the value is allocation-constrained to `[a-z0-9-]` over the configured base domain, so no scheme injection path exists through the data.

### F10 — Secrets/config — VERIFIED OK
No new secrets. `SITES_BASE_DOMAIN` / `PUBLISHED_ORIGIN_SUFFIX` are non-secret operational config; the directive's rule that browser input or Site data must never control them holds by construction (both are env vars consumed only by trusted code paths). The gateway D1 binding is code-constrained to SELECTs; D1 offers no read-only binding type, so the minimal-code principle (no other bindings, no workflows, no secrets) is the compensating control.

## 5. Severity summary

- Critical: none.
- High: F1, F2, F3, F5, F8 — all VERIFIED MITIGATED with regression tests.
- Medium: F4 (operational, activation-gated), F6, F7 — mitigated.
- Low: F9, F10 — clean.

## 6. Required remediation

None blocking. One mandatory operational control remains IN the deployment order and must not be skipped: the wazibiz.co.ke zone audit (F4) before creating the proxied wildcard record and Worker Route — HOLD and report if any existing real first-level subdomain would be intercepted.

## 7. Watch items

- W1: `workers_dev: true` on the gateway is retained only for pre-cutover smoke verification; disable it after the Worker Route cutover is verified live.
- W2: the gateway performs 3 D1 reads per request with no cache; if a Site gains traffic, add a short-TTL cache on the host→origin resolution (security-neutral; keep TTL short so rollback stays effectively instant).
- W3: gateway and platform worker share the V2 D1 database (same account/zone family); the gateway stays minimally-coded and SELECT-only by convention — keep it that way in review.
- W4: if Business-owned custom domains are ever added later, re-run CSO on host validation (multi-tenant hostname trust) — out of scope for #48 by decision.

## 8. Final security verdict

SECURITY OK WITH WATCH ITEMS

## 9. Next best action

Proceed to commit (#48) and the ordered production rollout: migration → backfill dry-run/apply → gateway deploy → zone audit (HOLD point) → wildcard DNS + Worker Route → TLS + live E2E. Disable the gateway workers.dev endpoint after cutover (W1).
