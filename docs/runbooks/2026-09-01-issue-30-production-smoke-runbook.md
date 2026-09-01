# Issue #30 Runbook — V2 Production Deployment and End-to-End Smoke (Phase C, prepared not executed)

**Prepared:** 2026-09-01 · **Status:** NOT EXECUTED.
**Gates to start:** corrected #28 complete (`f8e6afb`) ✓ · #27 complete (runbook executed) · #29 complete (closed) ✓ · operator inputs from #27 Step 0 in place.

## Pre-work P0 — Publication interface gap (blocker discovered during preparation)

`publishApprovedBuildVersion` has **no production caller**: the Approval route only records the Approval, and no route/workflow/cron triggers Publication (grep-audited; only tests call it). The V2 domain requires Approval and Publication to stay separate, so the scoped fix is a capability-gated operator route (mirroring #29):

```text
POST /api/v2/build-versions/:buildVersionId/publication
Authorization: Bearer <minted 'publish' capability binding buildVersionId + artifactManifestHash>
```

Create this under a dedicated issue with its own tests + CSO before #30 executes. Do not improvise a manual D1 write at execution time.

Known limitation to record (not fix here): generated Sites currently embed a placeholder Form Service base URL (`forms.wazibiz.example`) because the workflow does not pass `formServiceBaseurl`; the smoke therefore submits directly to the Form Service endpoint, which is the contract under test.

## Pre-work P1 — Exact-commit deployment

```bash
git rev-parse HEAD                     # record SHA; must be the gated commit
npm test && npm run typecheck && npx wrangler deploy --dry-run
npx wrangler deploy                    # cf-website-factory-v2 (post-#27 config)
npx wrangler deployments list          # record version/deployment ID + timestamp
```

Abort if the deployed binding set differs from the topology matrix, or deployment does not correspond to the recorded SHA.

## Pre-work P2 — Environment verification

1. `npx wrangler secret list` → exactly the #27 Step-4 set; no retired V1 names.
2. D1 `website_factory_v2`: 30 migrations applied; `site_identities`/`builds`/`email_deliveries` present.
3. Email Service: dashboard shows the onboarded sending domain healthy (SPF/DKIM/DMARC resolving); `send_email` binding `EMAIL` present.
4. Cron `*/10 * * * *` listed for the Worker.
5. Staging (`cf-website-factory-staging`) unchanged and still serving.

## S1 — Controlled Site Generation (REFERENCE_BOUND)

Use one clearly identified test Business (`WAZIBIZ #30 Smoke Business`); no customer data. Upload a reference screenshot to the V2 bucket first:

```bash
npx wrangler r2 object put website-factory-v2-assets/references/smoke/<file>.png --file <file>.png
```

Submit the Onboarding Submission (HMAC with the V2 `WEBHOOK_SECRET`; hex `X-Signature` over the raw body):

```bash
node scripts/form-service-smoke.mjs … # (submit helper only covers forms; sign manually:)
# body: {"submission":{"buildMode":"REFERENCE_BOUND","facts":{"businessName":"WAZIBIZ #30 Smoke Business","contactEmail":"ops@wazibizwebsites.example"},"reference":{"screenshotR2Key":"references/smoke/<file>.png"}}}
# POST /api/v2/onboarding-submissions   header: X-Signature: hex(hmac_sha256(WEBHOOK_SECRET, rawBody))
```

Then `POST /api/v2/site-generations/:id/builds` (same HMAC), and poll `GET /api/v2/builds/:id` to Release Ready. Verify in D1: Build + immutable Build Version rows, images persisted in R2 (wave evidence), Technical Preflight + Preview + QA-A/QA-B artifacts recorded, exact version pinned Release Ready. (AI stages require the operator-supplied provider keys.)

## S2 — Approval (issue #29 interface)

```bash
node scripts/mint-operator-capability.mjs approve --build-id <id> --build-version-id <id> \
  --artifact-manifest-hash <hash from the assembled_manifest artifact> --secret <OPERATOR_CAPABILITY_SECRET>
curl -X POST …/api/v2/build-versions/<id>/approval -H "Authorization: Bearer <capability>" \
  -H 'content-type: application/json' -d '{"approvedBy":"#30 smoke"}'
```

Verify first: no/invalid capability → 401; wrong-action or cross-version capability → 403, with zero rows written. Then approve only the intended version; manifest hash binding must match.

## S3 — Publication (requires Pre-work P0)

Publish the approved Build Version through the new capability-gated publication route. Verify: no regeneration (Build Version id unchanged), published artifact hash equals the approved manifest hash, and the production URL serves the expected four pages (Home/About/Services/Contact) with shared `site.css`/`site.js`.

## S4 — Form Service → Cloudflare Email Service

Seed Site Configuration (destination = platform-controlled address; sender identity on the onboarded domain; allowed origin = the published Site's origin; `turnstile_required = 0` unless Turnstile keys were provided):

```bash
npx wrangler d1 execute website_factory_v2 --remote --command "INSERT INTO site_configurations … ; INSERT INTO businesses/site_identities if needed"
node scripts/form-service-smoke.mjs submit --url https://cf-website-factory-v2… --site <siteId> --origin <published origin> --email smoke@<onboarded-domain>
node scripts/form-service-smoke.mjs ledger --database website_factory_v2 --submission-id <id>
```

Verify ledger: `delivered` (real Email Service), destination = configured Form Destination, `sender_identity` = approved platform sender, `reply_to` = visitor email only. Cross-check the Email Service Activity log (Sent/Delivered) in the dashboard; record the send's message metadata without exposing any secret.

## S5 — Retry (controlled, no live-traffic harm)

Preferred: staging-equivalent proof (already recorded 2026-09-01: `E_SENDER_DOMAIN_NOT_AVAILABLE` → bounded transient; cron sweep processed 4 due). In production, only observe naturally occurring transients via the ledger/Activity log; do not inject failures into live traffic.

## S6 — Rollback

1. Verify first-publication rollback is correctly refused (no prior Published Version → route must deny with `NO_ROLLBACK_VERSION`; do not fabricate history).
2. Publish a second controlled version (new Build Version → Release Ready → Approval → Publication).
3. Mint a rollback capability against the then-current published version; verify denial paths (stale `from` version after another publish).
4. Execute Rollback; verify the exact previous Published Version is restored byte-for-byte and Site Configuration (form destination/sender) is NOT implicitly reverted.

## S7 — V1 absence checks (against the V2 worker only)

- Probe retired V1 routes on the V2 URL → 404: `/api/webhooks/github`, `/api/contact`, `/api/jobs`, `/api/webhooks/fluentforms`, V1 upload path.
- Confirm no V1 feature flags/env names in the deployed config (`SMTP2GO_API_KEY`, `GITHUB_*`, `APPROVAL_SECRET`, `CANDIDATE_VALIDATION_SECRET`).
- Confirm route table equals the contracted V2 table (pinned by `tests/v2-final-verification.test.ts`).
- Do NOT touch the V1 worker, its D1, its bucket or its generated-site workers while probing.

## S8 — Final gates

```bash
npm test && npm run typecheck && npx wrangler deploy --dry-run
```

Then `/morabeza-cso`; resolve all blocking findings. Record everything (SHAs, version IDs, submission/delivery ids, probe outputs) on issue #30; keep #30 changes attributable to #30; clean tree at handoff.

## Stop conditions

Any assignment stop condition (missing secrets, Email Service cannot send, SHA drift between Approval and Publication, V1/V2 ownership ambiguity, CSO blocking finding, any command that could target V1 resources) → stop and report; fix via scoped issues, never by manual production edits.
