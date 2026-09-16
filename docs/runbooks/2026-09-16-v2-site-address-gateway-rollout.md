# Runbook — #48 Stable Site Addresses / Wildcard Gateway production rollout

Date: 2026-09-16 · Code: commit `d0a14e5` (clean tree) · Platform worker version: `491664a4-1f9c-4435-a789-37897fc1b58f`

## Completed

| Order step | Status | Evidence |
|---|---|---|
| 1-5 | ✅ | commit `d0a14e5`; npm test 624/624; typecheck PASS; /morabeza-cso SECURITY OK WITH WATCH ITEMS (docs/security/2026-09-16-v2-site-address-gateway-cso.md) |
| 6. Apply migration to production | ✅ | `wrangler d1 migrations apply website_factory_v2 --remote` → `0040_v2_site_addresses.sql` ✅; sqlite_master shows table + 3 auto-indexes + `idx_site_addresses_host` + `site_addresses_no_update`/`no_delete` triggers |
| — (prereq of 7) Deploy platform worker | ✅ | `cf-website-factory-v2` version `491664a4-1f9c-4435-a789-37897fc1b58f`; backfill route live and fails closed (unauthenticated POST → 401 CAPABILITY_REQUIRED) |
| 13. Zone audit | ✅ | See below — **HOLD condition met** |

## Zone audit — wazibiz.co.ke (zone id 12493a8ccf1a2052758e93b6b1ef0499, status active, Free plan)

- **Existing Worker routes on the zone: 0** (API: `GET /zones/{id}/workers/routes` → empty).
- **Live first-level hostnames (would be intercepted by `*.wazibiz.co.ke/*`):**
  - `www.wazibiz.co.ke` — proxied (188.114.96.x/97.x), serves **301 → https://wazibiz.ke/** (Cloudflare-served redirect)
  - `factory.wazibiz.co.ke` — proxied (resolves)
  - `wazigarden.wazibiz.co.ke` — proxied (resolves)
  - `wbdesign.wazibiz.co.ke` — proxied (resolves)
  - Sources: public DNS resolution (DoH) of 44 candidate names + Certificate Transparency (`crt.sh`, 3 extra hostnames); the authoritatively complete DNS-record list requires an API token with `dns_records:read` (the local wrangler OAuth token lacks that scope — 44-name sweep + CT is strong but not exhaustive).
- **Decision: HOLD per directive §26** — www (and likely factory/wazigarden/wbdesign) must NOT go through the site gateway. The wildcard route is NOT applied; wildcard DNS record NOT created.

## Operator actions required to proceed

1. **Backfill (order steps 7-10)** — needs an operator-minted capability (`OPERATOR_CAPABILITY_SECRET` is offline by design):
   ```
   node scripts/mint-operator-capability.mjs site-address-backfill --ttl-minutes 30
   curl -X POST https://cf-website-factory-v2.wazibizwebsites.workers.dev/api/v2/operator/site-addresses/backfill \
     -H "Authorization: Bearer <token>" -H "content-type: application/json" -d '{"dryRun":true}'   # inspect
   curl -X POST .../backfill -d '{"dryRun":false}'                                                  # apply (reports pendingAfter; re-run must be 0)
   ```
2. **Wildcard routing (order steps 13-15)** — decide the exclusion strategy for the four live hostnames, e.g.:
   - more-specific Worker routes for those hostnames bound to a pass-through worker (redirect rules for www execute before Workers, but verify each hostname's serving path), or
   - a scoped non-wildcard route set is NOT viable (no per-site records) — the wildcard + explicit exclusions is the only shape; any decision here is a new operator decision to record on #48.
   Then: create proxied wildcard placeholder (`AAAA * → 100::`, orange cloud), uncomment the route in `wrangler.gateway.jsonc`, `npx wrangler deploy --config wrangler.gateway.jsonc`, verify TLS + unknown-host 404 + live E2E, then disable the gateway's workers.dev endpoint (CSO watch item W1).
3. **First live Site E2E** — order step 18 / directive §28 (or record READY_FOR_FIRST_REAL_PUBLICATION_E2E).
