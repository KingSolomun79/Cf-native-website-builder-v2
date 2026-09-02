# V2 Production Topology Audit and Deployment Matrix (#27/#30 preparation, Phase A)

**Date:** 2026-09-01 · **Mode:** read-only audit — nothing was created, mutated or deleted.
**Account:** `c1c0f6b100d55a09ce6a7a3121a19224` (Wazibizwebsites, subdomain `wazibizwebsites`).
**Method:** `wrangler` read commands (`d1 list`/`execute --remote` SELECTs, `r2 bucket list`, `secret list`, `deployments list`, `versions view`) plus read-only Cloudflare API `GET`s (scripts, zones, KV, queues) with the same OAuth credentials wrangler uses.

## Context

The live `cf-website-factory` Worker belongs to the **preserved V1 product** (separate repository `CF-native-website-builder`, confirmed to declare `cf-website-factory` + `website_factory_v1` + `website-factory-assets` and the `WebsiteAgent`/`SiteBuildWorkflow` handlers the live Worker exports). V1 is actively serving: generated-site Workers were published by V1 as recently as 2026-09-01. **No V2 production resource set exists.** Therefore #27/#30 are a **fresh V2 production deployment**, not an in-place upgrade.

> ⚠️ **Standing hazard until #27 executes:** this repo's `wrangler.jsonc` still inherits the V1 names (`cf-website-factory`, D1 `website_factory_v1`, R2 `website-factory-assets`). A plain `npm run deploy` from the V2 repo would overwrite the preserved V1 Worker. CI only dry-runs (verified). Do not run production deploys from this repo before the #27 re-point.

## A1 — Inventory and classification

### Workers (31)

| Worker | Class | Evidence |
|---|---|---|
| `cf-website-factory` | **V1 (production)** | live deployment = rollback `dc99fb34` (2026-08-19); exports V1 handlers `WebsiteAgent` + `SiteBuildWorkflow`; matches the V1 repo config; holds V1 secrets below |
| `cf-website-factory-pr28-validation` | V1 (validation env) | V1 handlers; Aug 11–17; pairs with D1/R2 `*-pr28-validation` |
| `cf-website-factory-sandbox` | V1 (sandbox env) | V1 handlers; Aug 24–26; pairs with D1/R2 `*-sandbox` |
| `cf-website-factory-staging` | **V2 (staging)** | exports `scheduled` + `WebsiteBuildWorkflow`; created 2026-09-01 by issue #28; D1 `website_factory_staging`; cron `*/10`; `send_email` binding `EMAIL` |
| `cf-website-factory-testbench` | unknown (separate effort) | exports `TestbenchBuildWorkflow` — not a class in this repo; created 2026-09-01 |
| `roomraccoon-worker` | unknown (unrelated) | Jul 20; `FollowUpWorkflow` |
| 24 × `site-*`, `simple-electricals-*`, `ngong-farm-retreat-*`, `testbench-*` | V1 product output (generated Sites) | static per-site Workers published by V1's pipeline; several created 2026-09-01 — V1 is live |

`wazibiz-email-router` (interim #28 transport) was deleted on 2026-09-01 and no longer appears.

### D1 databases (4)

| Database | Class | Evidence |
|---|---|---|
| `website_factory_v1` (`370051b4-…`) | **V1 (production data)** | tables = V1 schema only (`clients`, `sites`, `jobs`, `contact_submissions`, `approvals`, …); **zero** V2 tables; `d1_migrations` empty (V1 applied schema outside the tracker) |
| `website_factory_staging` (`c347bcf9-…`) | **V2 (staging)** | created by #28; all migrations 0001–0030 applied; holds the #28 smoke ledger evidence |
| `website_factory_pr28_validation` | V1 (validation) | pairs with the V1 validation Worker |
| `website_factory_sandbox` | V1 (sandbox) | pairs with the V1 sandbox Worker |

Running V2 migrations against `website_factory_v1` would eventually execute `0030_v2_contract_v1_removal.sql`, which **drops `clients`/`sites`** — destroying V1 data. Never point V2 at it.

### R2 buckets (5)

| Bucket | Class |
|---|---|
| `website-factory-assets` | **V1 (production)** — declared by the V1 repo |
| `website-factory-assets-pr28-validation` | V1 (validation) |
| `website-factory-assets-sandbox` | V1 (sandbox) |
| `theme-screenshots` | unknown/shared |
| `testbench-assets` | unknown (separate effort) |

### Secrets (names only; values are write-only)

`cf-website-factory` (V1) holds: `APPROVAL_SECRET`, `CF_AIG_TOKEN`, `CF_DEPLOY_API_TOKEN`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `KIE_API_KEY`, `OPENROUTER_API_KEY`, `SMTP2GO_API_KEY`, `WEBHOOK_SECRET`, `ZHIPU_API_KEY`.
`cf-website-factory-staging` (V2): none (the interim transport token was deleted with the corrected #28 architecture).

V2-runtime mapping of those names (per `src/env.d.ts` + corrected #28):

- Retired V1 integrations, **must not exist on the V2 Worker**: `SMTP2GO_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET`, `CANDIDATE_VALIDATION_SECRET` (not present anywhere).
- Required by V2 but **values are operator-held** (cannot be read back from V1): `ZHIPU_API_KEY`, `OPENROUTER_API_KEY`, `KIE_API_KEY`, `CF_AIG_TOKEN`, `CF_DEPLOY_API_TOKEN`, `TURNSTILE_SECRET_KEY` (optional while `turnstile_required = 0`).
- Required by V2 and **generatable fresh**: `WEBHOOK_SECRET` (inbound route HMAC), `OPERATOR_CAPABILITY_SECRET` (issue #29, W-29a).
- **#33 re-audit (2026-09-01):** every name above re-verified against live `src/` references (env.d.ts + routes/domains); zero source references remain for `SMTP2GO_API_KEY` (only a negative-assertion comment in `src/lib/publish.ts`), `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET`, `CANDIDATE_VALIDATION_SECRET`, `WAZIBIZ_EMAIL_TRANSPORT_TOKEN`, `WAZIBIZ_EMAIL_TRANSPORT_URL`, `EMAIL_ROUTER`. Retired dummy vars removed from `wrangler.test.jsonc`. Name-only hygiene gate: `scripts/verify-v2-secrets.mjs`.
- Email: **no secret at all** — native Cloudflare Email Service `send_email` binding (issue #28 follow-up); the platform Sender Identity is the `WAZIBIZ_SENDER_EMAIL` Worker **var** (issue #32, configuration not a secret) — unset in production until the operator approves the mailbox; delivery fails closed without it.

### Other

- KV namespaces: none. Queues: none.
- Cron: only `cf-website-factory-staging` (`*/10 * * * *`, the Email Delivery retry sweep). V1 has no scheduled handler.
- Zones: 30 active Cloudflare-DNS zones in the account, including `wazibiz.com`, `wazibiz.co.ke`, `wazibiz.ke`, `morabeza.digital` → in-account candidates for the Email Service sending-domain onboarding.
- Workers routes/custom domains: none (all Workers serve via `*.wazibizwebsites.workers.dev`).

## A2 — Intended V2 production deployment matrix

| Resource | Production name | Binding | Exists? | Required action | Issue | Verification |
|---|---|---|---|---|---|---|
| Main Worker | `cf-website-factory-v2` (proposed) | — | no | re-point `wrangler.jsonc` `name` away from the V1 name; deploy | #27 | `wrangler deployments list` shows the SHA-built version; V1 worker untouched |
| D1 | `website_factory_v2` (create) | `DB` | no | create; apply migrations 0001–0030 in order (fresh-DB path proven on staging: V1-era tables created then dropped by 0030) | #27 | `d1_migrations` = 30 rows; V2 tables present; `clients`/`sites` absent |
| R2 | `website-factory-v2-assets` (create) | `SITE_BUCKET` | no | create; keep V2 artifacts isolated from V1's bucket | #27 | bucket listed; first preview upload works in #30 |
| Workflow/DO | `website-build-workflow` | `WEBSITE_BUILD_WORKFLOW` | no | created by deploy (worker-scoped) | #27 | binding present in version view |
| Browser rendering | — | `BROWSER` | no | binding on deploy | #27 | binding present |
| Images | — | `IMAGES` | no | binding on deploy | #27 | binding present |
| Cloudflare Email Service | `send_email: [{name: EMAIL}]` | `EMAIL` | binding: no (staging: live) / domain: **wazibiz.ke onboarded 2026-09-02** | binding deploys with the Worker; domain onboarding **done** via dashboard (Enabled, DNS Configured; existing SPF/DMARC p=reject preserved) | #27/#30 | staging ledger already shows `delivered` (#33 evidence) |
| Platform Sender Identity | `WAZIBIZ_SENDER_EMAIL` (var, **not** a secret) | — | staging: `notifications@wazibiz.ke` (live) / production: no | decided value `notifications@wazibiz.ke`; set as the production var at the #27 deploy; **deliberately unset until then — delivery fails closed** (issue #32) | #33/#27 | `wrangler versions view` shows the var; Form Service ledger `sender_identity` equals it (already proven on staging) |
| Cron | `*/10 * * * *` | `scheduled` | no | deploys with the Worker | #27 | schedule listed; sweep log line in #30 |
| Secrets | `OPERATOR_CAPABILITY_SECRET`, `WEBHOOK_SECRET` | — | no | generate fresh, `wrangler secret put` (V2 Worker only) | #27 | `secret list` shows exactly the required set |
| Secrets (operator values) | `ZHIPU_API_KEY`, `OPENROUTER_API_KEY`, `KIE_API_KEY`, `CF_AIG_TOKEN`, `CF_DEPLOY_API_TOKEN`, (optional `TURNSTILE_SECRET_KEY`) | — | no | **operator supplies values** (unreadable from V1) | #27 | same |
| Public URL | `https://cf-website-factory-v2.wazibizwebsites.workers.dev` (proposed); custom domain (e.g. `app.wazibiz.com`) optional later | var `PUBLIC_APP_URL` | no | update var at re-point | #27 | smoke fetch |
| Staging env | `cf-website-factory-staging` + `website_factory_staging` | `env.staging` | **yes** | keep as-is (V2 verification environment) | — | unchanged |

Naming note: `cf-website-factory-v2` / `website_factory_v2` / `website-factory-v2-assets` are proposals; any distinct-from-V1 names satisfy the constraint. If the operator later wants the original public URL for V2, that is a deliberate cutover (custom domain or V1 retirement), out of scope here.
