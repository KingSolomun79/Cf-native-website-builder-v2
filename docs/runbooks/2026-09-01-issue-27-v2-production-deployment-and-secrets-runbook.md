# Issue #27 Runbook — Fresh V2 Production Deployment and Secret Hygiene (Phase B, prepared not executed)

**Prepared:** 2026-09-01 · **Status:** NOT EXECUTED — blocked on the operator inputs in step 0.
**Interpretation:** per the #27/#30 assignment, the acceptance criterion is about the **V2 production runtime** containing no retired V1 integration secrets. The preserved V1 Worker (`cf-website-factory`) keeps its secrets and is never touched. A fresh V2 Worker that never received them satisfies #27 by construction.
**Prerequisite:** corrected #28 committed (`f8e6afb`, recorded `fbf2f32`) — complete.

## Step 0 — Operator inputs (hard blockers, not automatable from this repository)

1. ~~**Email Service domain onboarding (dashboard):**~~ **DONE 2026-09-02 (guided #33 setup):** `wazibiz.ke` onboarded under Compute > Email Service > Email Sending — dashboard reports **Enabled / DNS records Configured**; public DNS confirms the `cf-bounce` MX is live and the pre-existing apex SPF and DMARC (`p=reject`) were preserved untouched (the domain's existing Cloudflare Email Routing inbound setup was not modified).
2. ~~**Production sender mailbox (issue #32):**~~ **DECIDED 2026-09-02:** `notifications@wazibiz.ke`. Set as the `WAZIBIZ_SENDER_EMAIL` production var in Step 2 — configuration, not a secret. **Real-delivery proof already recorded on staging** (see the #33 evidence): Form Submission → Accepted → Email Delivery → Cloudflare Email Service → `delivered`, attempt 1.
3. **Secret values for the V2 Worker** (unreadable from V1 — secrets are write-only): `ZHIPU_API_KEY`, `OPENROUTER_API_KEY`, `KIE_API_KEY`, `CF_AIG_TOKEN`, `CF_DEPLOY_API_TOKEN`, and optionally `TURNSTILE_SECRET_KEY`. *Last remaining operator input.*
4. Confirm (or change) the proposed V2 production names: Worker `cf-website-factory-v2`, D1 `website_factory_v2`, R2 `website-factory-v2-assets`.

## Step 1 — Create V2 resources

```bash
npx wrangler d1 create website_factory_v2
export CLOUDFLARE_ACCOUNT_ID=c1c0f6b100d55a09ce6a7a3121a19224
npx wrangler r2 bucket create website-factory-v2-assets
```

Record the new D1 `database_id`.

## Step 2 — Re-point the production config (repo change, attributable to #27)

In `wrangler.jsonc` (top level only; `env.staging` stays as-is):

- `"name": "cf-website-factory-v2"`
- D1: `database_name: website_factory_v2`, new `database_id`
- R2: `bucket_name: website-factory-v2-assets`
- `vars.PUBLIC_APP_URL`: `https://cf-website-factory-v2.wazibizwebsites.workers.dev`
- `vars.WAZIBIZ_SENDER_EMAIL`: `notifications@wazibiz.ke` (decided in Step 0.2 — the onboarded `wazibiz.ke` sending domain)

This step is also the fix for the standing hazard where the V2 repo inherited the V1 Worker name.

## Step 3 — Schema

```bash
npx wrangler d1 migrations apply website_factory_v2 --remote
```

Expected: 0001–0030 applied (fresh-DB path proven on `website_factory_staging`). Verify `d1_migrations` count = 30 and that `clients`/`sites` do not exist (dropped by 0030 on a fresh DB).

## Step 4 — Secrets on the V2 Worker only

Generate fresh (values into local gitignored `.dev.vars`; also used offline by `scripts/mint-operator-capability.mjs`):

```bash
node -e "console.log('OPERATOR_CAPABILITY_SECRET='+require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('WEBHOOK_SECRET='+require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put OPERATOR_CAPABILITY_SECRET   # Worker: cf-website-factory-v2
npx wrangler secret put WEBHOOK_SECRET
```

Then the operator-supplied values (provider ownership; audited against actual `src/` references in #33):

```bash
npx wrangler secret put ZHIPU_API_KEY          # Z.ai / Zhipu — api.z.ai LLM key (primary text-provider leg)
npx wrangler secret put OPENROUTER_API_KEY     # OpenRouter — openrouter.ai key (text + vision fallback legs)
npx wrangler secret put KIE_API_KEY            # KIE.ai — image-generation API key
npx wrangler secret put CF_AIG_TOKEN           # Cloudflare AI Gateway token (account c1c0f6b1…, gateway "website-factory")
npx wrangler secret put CF_DEPLOY_API_TOKEN    # Cloudflare API token with Workers Scripts + static-assets permissions
npx wrangler secret put TURNSTILE_SECRET_KEY   # optional — Cloudflare Turnstile (only once any Site sets turnstile_required = 1)
```

Fresh credentials are preferred over reusing V1 values: secrets are write-only (unreadable from V1 anyway), V1 stays independently alive on its own credentials, and fresh keys isolate blast radius and keep rotation simple. Reuse is possible only if the operator still holds the V1-era values — a deliberate choice, not a requirement.

Post-provision name hygiene (names only; values are never readable):

```bash
node scripts/verify-v2-secrets.mjs --worker cf-website-factory-v2
```

Must report: exactly the required set, no retired names (`SMTP2GO_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET`, `CANDIDATE_VALIDATION_SECRET`, `WAZIBIZ_EMAIL_TRANSPORT_TOKEN`), nothing unexpected. Also confirm the `WAZIBIZ_SENDER_EMAIL` **var** via `npx wrangler versions view <id>` (it is configuration, not a secret).

## Step 5 — Gates, then deploy

```bash
npm test && npm run typecheck
npx wrangler deploy --dry-run
npx wrangler deploy          # creates cf-website-factory-v2 + bindings + cron
```

Record: Git SHA, Worker version/deployment ID, timestamp.

## Step 6 — #27 verification (the actual acceptance evidence)

1. `npx wrangler secret list` (V2 Worker): contains **only** the Step-4 names; assert absent: `SMTP2GO_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET`, `CANDIDATE_VALIDATION_SECRET`.
2. `npx wrangler versions view <id>` (or dashboard): bindings = `DB` (new D1 id), `SITE_BUCKET` (new bucket), `WEBSITE_BUILD_WORKFLOW`, `BROWSER`, `IMAGES`, `EMAIL` (Send Email), cron `*/10`, no services.
3. **V1 untouched proof:** `cf-website-factory` live deployment still `dc99fb34`; `website_factory_v1` still V1-schema-only; V1 secret list unchanged (10 names); a recent generated-site Worker still serves.
4. Repo tree clean; commit referencing #27.

## Step 7 — Evidence and closure

Record on issue #27: Worker name + version ID, resource names, active binding names, retired-secret check results, V1-untouched proof, deploy verification, `/morabeza-cso` result if anything security-relevant changed beyond config. Close #27 only when the V2 runtime is clean.

## Stop conditions (abort and report)

Any of: operator inputs unavailable; D1/R2 creation or migration failure; deployed bindings differ from the matrix; any command would target `cf-website-factory` / `website_factory_v1` / `website-factory-assets`; V1 state changes at any point.
