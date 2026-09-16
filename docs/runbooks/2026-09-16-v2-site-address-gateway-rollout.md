# Runbook — #48 Stable Site Addresses / Wildcard Gateway production rollout

Date: 2026-09-16 · Code: commit `d0a14e5` + correction `f060a58` (clean tree) · Platform worker version: `491664a4-1f9c-4435-a789-37897fc1b58f` (pre-correction; redeployed at correction — see log)

## Operator decisions (recorded on issue #48, 2026-09-16)

1. **EXISTING HOSTNAME STRATEGY** — the wildcard Site Gateway uses
   `*.wazibiz.co.ke/*` → `cf-site-gateway-v2`; existing infrastructure
   hostnames are excluded with more-specific **no-script Worker Routes**.
   Initial exclusion set (no Worker attached — the empty route exists
   specifically to negate the less-specific wildcard Worker route and let the
   hostname's normal existing serving path continue; Cloudflare route
   specificity guarantees the exact-hostname route wins over the wildcard):
   - `www.wazibiz.co.ke/*`
   - `factory.wazibiz.co.ke/*`
   - `wazigarden.wazibiz.co.ke/*`
   - `wbdesign.wazibiz.co.ke/*`
2. **BACKFILL** — proceed with the canonical Site Address backfill:
   dry-run → inspect → apply → second dry-run = zero pending.
3. **RESERVED-NAME CORRECTION** (commit `f060a58`) — a hostname deliberately
   excluded from the wildcard gateway must never later be allocated as a
   customer Site Address, so `factory`, `wazigarden` and `wbdesign` joined the
   central reserved set (`www` was already reserved). Tests prove Factory,
   Wazigarden and WBDesign never receive their namesake hostname and their
   deterministic `business-{shortSiteId}` fallbacks obey the 63-char DNS
   label rule. The backfill runs only against a platform-worker deployment
   that includes this correction.

## Completed

| Order step | Status | Evidence |
|---|---|---|
| 1-5 | ✅ | commit `d0a14e5`; npm test 624/624; typecheck PASS; /morabeza-cso SECURITY OK WITH WATCH ITEMS (docs/security/2026-09-16-v2-site-address-gateway-cso.md) |
| 6. Apply migration to production | ✅ | `wrangler d1 migrations apply website_factory_v2 --remote` → `0040_v2_site_addresses.sql` ✅; sqlite_master shows table + 3 auto-indexes + `idx_site_addresses_host` + `site_addresses_no_update`/`no_delete` triggers |
| — (prereq of 7) Deploy platform worker | ✅ | `cf-website-factory-v2` version `491664a4-1f9c-4435-a789-37897fc1b58f`; backfill route live and fails closed (unauthenticated POST → 401 CAPABILITY_REQUIRED) |
| 13. Zone audit | ✅ | See below — **HOLD condition met** |
| — Correction: reserved infrastructure hostnames | ✅ | commit `f060a58`; npm test 625/625; typecheck PASS |

## Zone audit — wazibiz.co.ke (zone id 12493a8ccf1a2052758e93b6b1ef0499, status active, Free plan)

- **Existing Worker routes on the zone: 0** (API: `GET /zones/{id}/workers/routes` → empty).
- **Live first-level hostnames (would be intercepted by `*.wazibiz.co.ke/*`):**
  - `www.wazibiz.co.ke` — proxied (188.114.96.x/97.x), serves **301 → https://wazibiz.ke/** (Cloudflare-served redirect)
  - `factory.wazibiz.co.ke` — proxied (resolves)
  - `wazigarden.wazibiz.co.ke` — proxied (resolves)
  - `wbdesign.wazibiz.co.ke` — proxied (resolves)
  - Sources: public DNS resolution (DoH) of 44 candidate names + Certificate Transparency (`crt.sh`, 3 extra hostnames); the authoritatively complete DNS-record list requires an API token with `dns_records:read` (the local wrangler OAuth token lacks that scope — 44-name sweep + CT is strong but not exhaustive).
- **Resolution: operator decisions 1-3 above (exclusion routes + backfill + reserved correction)** — the HOLD is lifted for the exclusion-route strategy.

## Execution log (GO — 2026-09-16, post-decisions)

| Step | Directive § | Status | Evidence |
|---|---|---|---|
| A. Reserved-host correction | §A | ✅ | commit `f060a58`, 625/625, typecheck PASS |
| Platform worker redeploy with correction | §A prereq | ✅ | `ac72ab75` (from `6e89d41`), then `7517d420` (from `e20bfbd`); backfill route 401 fail-closed re-verified |
| C. Baseline probes | §C | ✅ | Six hosts (www, factory, wazigarden, wbdesign, **baharini-coral-lodge**, apex): all `301 → https://wazibiz.ke/`, byte-identical 167-byte Cloudflare body, fp `446a6087825fa73e`. Account inventory: 0 zone Worker routes, 0 Pages projects, 4 Workers Custom Domains account-wide — on this zone: `factory` → `cf-website-factory` (V1), `baharini-coral-lodge` → `baharini-coral-lodge-260908100315-7985a1` (V1 published site). Redirect ruleset expression unreadable from this environment (scope); DNS record list unreadable (no `dns_records` scope) |
| — Discovery 1: fifth live hostname | §C | ⚠️ | `baharini-coral-lodge.wazibiz.co.ke` — live V1 customer-site Custom Domain, invisible to DNS+CT sweeps. Reserved in commit `e20bfbd` (625/625, typecheck PASS) |
| — Discovery 2: catch-all zone redirect | §C | ⚠️ | EVERY `wazibiz.co.ke` hostname — including never-allocated random labels (verified via TLS `--resolve` probes: `gateway-scope-probe-7f3a`, `totally-unheard-9q`) — 301s to `wazibiz.ke` via a zone redirect rule. Redirect Rules execute BEFORE Workers (empirically confirmed: both Custom-Domain hosts are redirected before their Workers run) |
| D. Backfill | §D | ⏸ operator | `OPERATOR_CAPABILITY_SECRET` confirmed absent from the automation environment (Worker secret list shows the name only). Exact command set below. Route live, fails closed |
| E. Gateway deploy (no route) | §E | ✅ | `cf-site-gateway-v2` version `7c1ce682-ca80-4d21-98b7-c5eb55c39f63` from clean `6e89d41`; workers.dev: `/__gateway-health` → 200 `ok`; any other path → 404 (host validation); mismatched-Host request rejected at the workers.dev edge (403) before the Worker |
| F. No-script exclusion routes | §F | ✅ | Created (`script: null` — omitting the field is the API form; empty string is rejected 10019): `www` (`4bbe42c37ade4157bd2383da96a54741`), `wazigarden` (`2d1f1db0bf3b483286c5bdb6dafb6aed`), `wbdesign` (`0ace0893312d4eb09b89ca745f095ccc`). **Documented deviation:** no routes on `factory`/`baharini-coral-lodge` — they are Workers Custom Domains, and per Cloudflare docs a same-hostname route takes precedence over the Custom Domain, so a no-script route there would BYPASS the V1 worker; they are excluded from the wildcard by exact-hostname Custom Domain precedence instead. Post-change regression probe: all six hosts byte-identical to baseline → **F GATE PASS** |
| G. Wildcard DNS | §G | ⛔ HOLD | Blocked by Discovery 2 (see below) |
| H. `*.wazibiz.co.ke/*` → gateway | §H | ⛔ HOLD | Same blocker |
| I. Regression gate | §I | blocked | Requires G–H |
| J. Negative tests (404) | §J | blocked | Under the catch-all redirect an unallocated host currently 301s; the gateway can never observe it |
| K. TLS | §K | blocked | Universal SSL `*.wazibiz.co.ke` applies at the edge regardless; verification deferred to activation |
| L–N. Real E2E / form / rollback | §L-N | pending | Designated safe candidate: **"WAZIBIZ #30 Smoke Business"** (site `5ce85bdf-e1a1-4e1a-bb0b-601ab934f82f`, current publication `7e0f7b9d…`, worker `pub-dddd8e0d86-v2`, published 2026-09-02) — operator-owned smoke-test site, not a benchmark, not a customer. D1: 70 sites / 0 addresses / 2 published sites. Blocked on backfill (§D) + Discovery-2 decision |

## Why G–H are on HOLD (Discovery 2 — operator decision required)

The zone-wide redirect rule redirects every `wazibiz.co.ke` hostname to `wazibiz.ke` **before** Workers execute. Activating the wildcard DNS + gateway route while it stands yields a live-but-fully-shadowed gateway: unallocated hosts would 301 (not 404), and no Site Address could ever serve. Narrowing that rule changes V1-era zone serving configuration — an operator decision, not an autonomous one. The proposed, behavior-preserving narrowing:

- Restrict the redirect rule's match to the six currently-live hostnames (apex + www + factory + wazigarden + wbdesign + baharini-coral-lodge). Every existing hostname's observable behavior stays byte-identical (verified reproducible via the baseline fingerprints); all other first-level labels are freed for the gateway.
- Completeness caveat: the DNS record list is not readable from this environment (no `dns_records` scope), so "six live hostnames" rests on the Custom Domain inventory (authoritative for worker-attached hosts) + the 44-name DNS sweep + CT logs. After activation, the baseline fingerprints are the rollback gate.

## Staged activation command set (operator, after the redirect-rule decision)

```sh
# 0. Read the redirect rule (dashboard: wazibiz.co.ke -> Rules -> Redirect Rules) and narrow it
#    to apex + the five first-level hosts; re-run the baseline probes -> all six UNCHANGED.

# 1. Wildcard placeholder DNS (needs a token with dns_records:edit):
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/12493a8ccf1a2052758e93b6b1ef0499/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "content-type: application/json" \
  -d '{"type":"AAAA","name":"*","content":"100::","proxied":true,"comment":"wildcard Site Address placeholder (issue #48)"}'

# 2. Gateway wildcard route:
curl -sS -X POST "https://api.cloudflare.com/client/v4/zones/12493a8ccf1a2052758e93b6b1ef0499/workers/routes" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "content-type: application/json" \
  -d '{"pattern":"*.wazibiz.co.ke/*","script":"cf-site-gateway-v2"}'
#    (exact pattern — NOT *wazibiz.co.ke/*; the apex must stay unmatched)

# 3. Re-run baseline probes (six hosts) -> UNCHANGED, then directive §I-K:
#    random host 404 from gateway, apex not gateway-owned, TLS on a random
#    first-level label, then the L-N E2E on the smoke site below.
```

## Operator backfill command set (directive §D — run in a trusted local shell where `OPERATOR_CAPABILITY_SECRET` exists)

```sh
# 1. Mint the capability (never print/paste the secret; token stays local):
node scripts/mint-operator-capability.mjs site-address-backfill --ttl-minutes 30

# 2. Dry run (inspect proposed rows; never echoes the token):
CAP=$(node scripts/mint-operator-capability.mjs site-address-backfill --ttl-minutes 30 | sed -n '/^token:$/{n;p}')
curl -sS -X POST https://cf-website-factory-v2.wazibizwebsites.workers.dev/api/v2/operator/site-addresses/backfill \
  -H "Authorization: Bearer $CAP" -H "content-type: application/json" -d '{"dryRun":true}' | tee backfill-dryrun.json

# 3. Inspect: reserved-name handling, duplicate suffixes, labels <=63 chars,
#    no duplicate hosts, no existing infrastructure hostname allocated.

# 4. Apply once, then re-run the dry run — required result: pending = 0:
curl -sS -X POST https://cf-website-factory-v2.wazibizwebsites.workers.dev/api/v2/operator/site-addresses/backfill \
  -H "Authorization: Bearer $CAP" -H "content-type: application/json" -d '{"dryRun":false}' | tee backfill-apply.json
curl -sS -X POST https://cf-website-factory-v2.wazibizwebsites.workers.dev/api/v2/operator/site-addresses/backfill \
  -H "Authorization: Bearer $CAP" -H "content-type: application/json" -d '{"dryRun":true}'
```

Do NOT rotate `OPERATOR_CAPABILITY_SECRET` merely because the automation
environment cannot read it. If the operator no longer possesses the existing
secret, STOP and report before proposing any rotation.
