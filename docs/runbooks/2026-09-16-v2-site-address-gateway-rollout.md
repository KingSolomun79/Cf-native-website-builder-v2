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

## Activation attempt 2 (GO "RESUME FROM ACTIVATION", 2026-09-16, later) — HELD: operator preconditions not verified in production

Read-only verification BEFORE any mutation — **two of the three GO preconditions are false at the production edge**:

| GO precondition | Claimed | Verified in production | Evidence |
|---|---|---|---|
| Backfill applied, pending = 0 | ✅ | ❌ **`site_addresses` = 0 rows / 70 sites** | Triple-checked via `wrangler d1 execute website_factory_v2 --remote`: table + both immutability triggers exist; counts `addr=0, sites=70, pubs=3, states=2`. Rows cannot have been deleted (no-delete trigger) — the apply never landed in THIS database (`9e2597d1-9598-4c50-adcf-764c1b6319da`, the one `cf-website-factory-v2` binds) |
| Redirect rule narrowed (random label no longer redirects) | ✅ | ❌ **catch-all still 301s unallocated labels** | Cache-busted `--resolve` edge probes on two distinct random labels (`gateway-scope-probe-7f3a`, `zz-unallocated-4t9x`) across both edge IPs + re-probe: all `301 → https://wazibiz.ke/` (Location echoes the `?cb=` param — live rule evaluation, not cache) |
| Six hosts retain behavior | ✅ | ✅ | All six byte-identical to baseline fp `446a6087825fa73e` |

**Additional finding:** the designated E2E site's published origin **`pub-dddd8e0d86-v2` no longer exists** (account worker list: only `pub-5320a22982-v2` present; the smoke origin 404s on `/`, `/index.html`, `/about/`). Retention lifecycle (#16) or cleanup removed the deployment. RankForge Kenya's origin (`pub-5320a22982-v2`) serves 200 — it is the viable E2E candidate after the preconditions are actually met.

**Also verified (GO steps 1-2, read-only):** gateway `cf-site-gateway-v2` healthy (`/__gateway-health` → 200 `ok`); zone route inventory exactly the three no-script exclusions (`www`, `wazigarden`, `wbdesign`), no wildcard route.

**Mutation decision: NONE.** Wildcard DNS and the `*.wazibiz.co.ke/*` route were NOT created — with the catch-all still live and zero address rows, activation would be doubly shadowed and the E2E impossible. Plausible root cause for both precondition failures: the dashboard/backfill work landed in a different account/zone than `c1c0f6b1…` / zone `12493a8c…` (wrangler `whoami` shows the operator identity spans multiple accounts — e.g. a narrowing made on `wazibiz.KE` or in the personal account `9a3b764a…` would produce exactly this signature), and/or the backfill curl ran against a non-production endpoint/environment.

### Operator re-run checklist (production truth tests)

1. **Backfill**: run the runbook §D curl set; the dry-run response must list ~70 items and the apply response `pendingAfter: 0`. Then verify independently: `npx wrangler d1 execute website_factory_v2 --remote --json --command "SELECT COUNT(*) AS n FROM site_addresses"` → must be 70.
2. **Redirect rule**: the narrowed rule must live on zone **`12493a8ccf1a2052758e93b6b1ef0499`** (account `c1c0f6b1…`) in **Redirect Rules** — and check the other redirect mechanisms too (Page Rules, Bulk Redirects): any remaining catch-all wins. Production truth test: `curl --resolve randomlabel.wazibiz.co.ke:443:188.114.97.5 https://randomlabel.wazibiz.co.ke/` must NOT return 301 → wazibiz.ke.
3. **E2E candidate**: use RankForge Kenya (`5e1a9db8…`, origin alive) or re-publish the smoke site via canonical #15 authority (operator capabilities). Its `site_configurations.form_allowed_origins_json` will need the #48 provisioning to have run (re-publication provisions it) before the contact-form E2E.

## Activation attempt 3 precondition audit (HOLD — investigate orphan, 2026-09-16) — retention proven innocent; orphan is external; gates 1-2 still fail

### A. Missing current published worker — canonical chain + root cause

Chain for **WAZIBIZ #30 Smoke Business** (site `5ce85bdf-e1a1-4e1a-bb0b-601ab934f82f`):

| Link | Value |
|---|---|
| site_published_state | current_publication_id `7e0f7b9d-af70-4f5f-8f91-5320e02cf613`, current_build_version_id `edecd502-da5a-4b16-8f7f-660c8088c6e8`, rollback NULL, updated **2026-09-04T21:51:42.300Z** (rollback moment) |
| publications (current) | `7e0f7b9d…` status `published`, attempt 1, error NULL, created 2026-09-02T22:13:40.083Z, completed 2026-09-02T22:14:00.345Z, worker `pub-dddd8e0d86-v2`, manifest `7faf8a6975f3…` |
| build_deployments (current) | `4900c1f4-d833-4816-bffd-b6cd490a90e8` role `published`, **status `active`**, created 2026-09-02T22:14:00.345Z, updated 2026-09-04T21:51:42.300Z (re-activated by the rollback) |
| Cloudflare Worker | **does not exist** (account worker list: only `pub-5320a22982-v2`); origin answers `404`, body `error code: 1042` (workers.dev edge "worker absent" signature) |
| same-site second publication | `41c2dd04…` → worker `pub-7da9e4fa5c-v2`, published 2026-09-04T21:49:46Z, deployment `7a6cc44f…` marked `superseded` by the 09-04 21:51:42Z rollback, then **`deleted` 2026-09-16T13:20:48Z by the #16 cron sweep** |

**Root-cause attribution: the #16 retention code is PROVEN INNOCENT for the orphan.**
1. `cleanupDisposableDeployments` candidate selection (`loadDisposableCandidates`, src/domain/retention.ts:84-95) selects ONLY `role='preview'` rows or `role='published' AND status='superseded'` — an `active` published row is structurally unselectable, and pub 1's row was `active` continuously since the rollback.
2. Even for candidates, `isVersionProtectedNow` (retention.ts:100-118) re-reads canonical protection immediately before every destructive delete — `edecd502…` was `current_build_version_id` in every sweep window since 09-04 (and current via state since 09-02→09-04), protected at all times.
3. There is NO code path that deletes a worker and leaves its deployment row `active`: after any deletion attempt the row converges to `deleted` (success or "already absent"), and transport failures leave the row untouched for retry. D1 says `active` ⇒ this code never deleted that worker.
4. Today's sweep behaved exactly per policy on pub 2: superseded 09-04 21:51:42Z + 7-day rollback window (`ROLLBACK_WINDOW_DAYS` default 7) → eligible from 09-11 → deleted+marked today. **#16 works as designed; no retention regression. No #16 correction required.**

**Attribution: external/manual deletion, actor and exact time not determinable from this environment** (Cloudflare audit logs and API-token minting are both scope-blocked here — errors 7003/9109). The worker was removed out-of-band sometime after 09-04; the codebase has no deletion path consistent with the D1 evidence.

### B. Current-publication health audit (all `site_published_state` rows — production)

| Site | Publication | Worker | D1 coherence | Origin probe | Verdict |
|---|---|---|---|---|---|
| `5e1a9db8…` RankForge Kenya | `377bf98f…` | `pub-5320a22982-v2` | deployment `4e66e17a…` active, version/status cross-check OK | **200**, 6634 bytes | **HEALTHY** |
| `5ce85bdf…` WAZIBIZ #30 Smoke Business | `7e0f7b9d…` | `pub-dddd8e0d86-v2` | deployment `4900c1f4…` says `active` — **incoherent with reality** | 404 `error code: 1042` | **ORPHANED** |

current publications: **2** · healthy: **1** · orphaned: **1** (`7e0f7b9d-af70-4f5f-8f91-5320e02cf613` / site `5ce85bdf-e1a1-4e1a-bb0b-601ab934f82f`).

### D. Recovery (canonical, exact — no regeneration, no new Approval)

Approval (1), release record (1), 14 indexed artifact keys and the published publication row all survive for version `edecd502…` → exact re-publication through #15 is viable once the operator mints the capability:
`node scripts/mint-operator-capability.mjs publish --build-id dddd8e0d-8620-46b8-a0d6-626aca6bc838 --build-version-id edecd502-da5a-4b16-8f7f-660c8088c6e8 --artifact-manifest-hash 7faf8a6975f3c23555da78664f5d17153bd2846961128d5805903416092d9bce`
→ `POST /api/v2/build-versions/edecd502-da5a-4b16-8f7f-660c8088c6e8/publication` (same endpoint as any publication; re-provisions the Worker from retained artifacts).

### E. Gateway orphan defense (shipped before activation)

Test-first: reproduced the production failure at the gateway seam (`tests/v2-site-gateway.test.ts`), then fixed `src/site-gateway/gateway.ts` — an upstream 404 whose body is the edge-generated `error code: <NNNN>` now returns a generic **502** (no streaming the edge page, no fallback publication, no "latest" guess, no self-repair, no internal detail); a Site-authored 404 from a healthy origin passes through untouched (companion test pins it). 627/627, typecheck PASS, commit `949c363`, deployed `cf-site-gateway-v2` version `6f34cca5-aec0-4782-ae8d-2bad7b9f130f` from clean tree.

### Gates at close of this audit

- **GATE 1 — FAIL**: `site_addresses` = **0** / 70 sites (re-verified this run; `OPERATOR_CAPABILITY_SECRET` confirmed still absent here — backfill remains an operator-local action; exact command set + required response checks in this runbook §D-command block).
- **GATE 2 — FAIL**: cache-busted `--resolve` probes, two fresh random labels (`gateway-negative-8fk2`, `gateway-negative-qw49`): both still `301 → https://wazibiz.ke/?cb=…`. The active redirect mechanism remains unreadable from this environment (rulesets/pagerules APIs scope-blocked: 10000/9109) — the operator must narrow it on zone `12493a8ccf1a2052758e93b6b1ef0499` (Redirect Rules **and** Page Rules **and** Bulk Redirects — any one catch-all wins).
- **GATE 3 — PASS**: retention protection proven (see A); orphan explained as external; gateway orphan defense shipped, tested and deployed.

## Staged activation command set (unchanged — execute only after GATES 1-2 verify true)

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
