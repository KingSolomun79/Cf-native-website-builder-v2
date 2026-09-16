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
| Platform worker redeploy with correction | §A prereq | pending | |
| C. Baseline probes (4 hosts + apex) | §C | pending | |
| D. Backfill (operator capability) | §D | pending | |
| E. Gateway deploy (no route) | §E | pending | |
| F. Four no-script exclusion routes | §F | pending | |
| G. Wildcard AAAA `*` → `100::` proxied | §G | pending | |
| H. `*.wazibiz.co.ke/*` → gateway route | §H | pending | |
| I. Regression vs baseline (release gate) | §I | pending | |
| J. Gateway negative tests | §J | pending | |
| K. TLS verification | §K | pending | |
| L-N. Real publication E2E / form / rollback | §L-N | pending | |
| O. CSO production-topology follow-up | §O | pending | |

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
