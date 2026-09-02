# V2 Final Verification Evidence — parent #2 completion map

**Date:** 2026-09-01 · **Verified tree:** all issues #3–#26 landed, working tree clean.
**Gates at verification time:** `npm test` = 26 files / 153 tests passed · `npm run typecheck` clean · `npx wrangler deploy --dry-run` passes.

Machine-checked integration: `tests/v2-final-verification.test.ts` (full canonical lifecycle, gates, prompt-manifest agreement, capability-envelope agreement). Per-issue evidence: `docs/v2-implementation-log.md` (commit SHAs, test counts, CSO verdicts). Security reports: `docs/security/`.

## Problem-statement eliminations (V1 semantics)

| V1 assumption | Eliminated by | Evidence |
|---|---|---|
| Client/account-oriented records | #4, #25 | `tests/v2-lifecycle.test.ts` (no Client vocabulary; storage immutability); migration 0030 drops `clients`/`sites`; V1 vocabulary sweep in #25 CSO |
| Fluent-Forms-specific intake | #4, #25 | HMAC-signed `/api/v2/onboarding-submissions`; V1 webhook deleted (`75cd12d`); route table audit in #25 CSO |
| Legacy blueprint/rendering flows | #8, #9, #25 | `src/render` + blueprint v1/v2 generators deleted; V2 Visual Blueprint + incremental generator |
| SMTP2Go/per-site contact delivery | #11, #25 | Central Form Service (`tests/v2-form-service.test.ts`); `mail.ts`/builders/templates deleted; assets-only deploy regression tests |
| Old revision/version semantics | #4, #5, #12 | Revision Request → new Build; Automated Repair → new immutable Build Version; storage triggers |
| Old approval/publication behavior | #15 | Release Ready → Approval (hash-pinned, version-unique) → Publication (exact bytes) → Rollback |
| Broad artifact retention | #16 | Protection-first cleanup, compact Build Records survive pruning |
| Legacy prompt/runtime contracts | #6, #25 | Manifest-driven composition; DB prompt registry dropped (migration 0030) |

## Solution steps 1–15 (REFERENCE_BOUND pipeline)

| Step | Evidence |
|---|---|
| 1 Immutable Onboarding Submission | `v2-lifecycle.test.ts` (immutability triggers; 1:1 submission→generation) |
| 2 Suitability before generation | `v2-reference-intake.test.ts` (deterministic SUPPORTED/SWL/UNSUPPORTED) |
| 3 Frozen evidence + deterministic extraction | `v2-reference-intake.test.ts` (versioned package, screenshot authority, no rewrite) |
| 4 Analysis without redesign | `v2-blueprint-stages.test.ts` (evidence anchors; evidence untouched) |
| 5 Binding Visual Blueprint, identity preserved, brand replaced | `v2-blueprint-stages.test.ts` (identity preservation; reference-content lint) |
| 6 Implementation Contract without changing thesis | `v2-blueprint-stages.test.ts` (contract-vs-blueprint boundaries; blockers surfaced) |
| 7 Incremental four-page generation | `v2-site-generator.test.ts` (6 model calls; shared contracts) |
| 8 Two-wave images, USD 3 hard budget | `v2-image-pipeline.test.ts` (waves, reserve, hard-gate throw) |
| 9 Assembly + preflight of immutable version | `v2-assembly-preview.test.ts` (manifest hash; deterministic rejections) |
| 10 Preview + standardized evidence | `v2-assembly-preview.test.ts`, `v2-release-qa.test.ts` (1440/768/390 matrix) |
| 11 Geometry comparison + QA-A/QA-B | `v2-release-qa.test.ts` (tolerance comparator; hard gates not averageable) |
| 12 One repair batch + one blocker fix | `v2-automated-repair.test.ts` (storage-level ceiling, BLUEPRINT_REVIEW_REQUIRED) |
| 13 Release Ready only after all gates | `v2-release-qa.test.ts` (exact-version pinning) |
| 14 Approval before separate Publication | `v2-publication.test.ts` (drift prevention, retry-under-same-approval) |
| 15 Rollback retention + compact records | `v2-publication.test.ts`, `v2-retention.test.ts` |

## Cross-cutting requirements

| Requirement | Evidence |
|---|---|
| Revision/Fact-Update vs new Site Generation | `v2-revision.test.ts` (design-origin rejection; lineage fact precedence) |
| No fact fabrication | `v2-site-generator.test.ts` fabrication lints; QA-A fabrication flag |
| Form Service contracts (Accepted Submission, bounded delivery, Site Configuration) | `v2-form-service.test.ts` + e2e in `v2-final-verification.test.ts` |
| 3/5 benchmark gate before ORIGINAL_DESIGN | `v2-benchmark-harness/site-1..5/proof-gate.test.ts`; gate guard in `createInitialBuild` |
| Benchmark immutability | `v2-benchmark-harness.test.ts` (checksums, swap rejection) |
| ORIGINAL_DESIGN same downstream lifecycle | `v2-original-design.test.ts` (identical events/artifacts; no Reference dependency) |
| Prompt manifest/domain-contract runtime authority | `v2-prompt-contract.test.ts` + runtime-agreement assertion in `v2-final-verification.test.ts` |
| Capability envelope agreement | machine envelope vs generated contract/pages/files asserted in `v2-final-verification.test.ts` |
| No V1 production path/switch/fallback | #25 route-table + grep audit (`docs/security/2026-09-01-v2-issue-25-cso.md`); contracted route table re-verified in `v2-final-verification.test.ts` lifecycle run on the contracted tree |
| Retention keeps only current + rollback + records | `v2-retention.test.ts`, `v2-final-verification.test.ts` |

## Release-follow-up register (non-code, from CSO passes)

- **W14 (#25, tracked as #27) — RESOLVED 2026-09-02:** the retired-secret hygiene concern is closed **by construction**: V2 production is the fresh Worker `cf-website-factory-v2`, which never received any retired V1 secret (name-hygiene gate `scripts/verify-v2-secrets.mjs` reports clean: seven required/optional names present, all six retired V1/interim names absent). The preserved V1 Worker `cf-website-factory` keeps its own secrets untouched (10 names, unchanged through the V2 deployment — verified against the before-inventory) and requires no deletion; retiring V1's secrets belongs to a future explicit V1 decommission, deliberately out of scope. Full #27 record: implementation log above + issue #27 evidence comment.
- **W4 (#15, resolved by #29):** Approval and Rollback operator routes now exist (`POST /api/v2/build-versions/:buildVersionId/approval`, `POST /api/v2/sites/:siteId/rollback`) and are gated by offline-minted, short-lived capability tokens binding the exact version/manifest (approve) or current published state (rollback). Fails closed until `OPERATOR_CAPABILITY_SECRET` is set in production. Evidence: `tests/v2-operator-capability.test.ts` (16 tests: allowed + all denial classes + race guard), `docs/security/2026-09-01-v2-issue-29-cso.md`.
- **H2 wiring (#28 + follow-up; staging-equivalent complete through the real service; production gated on domain onboarding):** the outbound transport is now the **native Cloudflare Email Service `send_email` binding** (`env.EMAIL`), the single authoritative channel — no provider API key, no transport secret, no HTTP email-router hop. (The interim `wazibiz-email-router` + SMTP2Go design built earlier the same day was removed in full — worker deleted, tests/config/scripts dropped; see the superseded CSO report for its history.) Bounded transient retry has a production trigger (`*/10` cron sweep; handler registration is regression-tested). Live staging evidence (`cf-website-factory-staging` + `website_factory_staging` D1): acceptance → `env.EMAIL.send()` reached the **real** Email Service and the ledger recorded the documented `E_SENDER_DOMAIN_NOT_AVAILABLE` as bounded `transient_failure` — fail-closed exactly as designed — with visitor email as Reply-To and the platform Sender Identity; earlier probes in the same ledger also pin the no-transport (`"email transport not configured"`) and 4xx-permanent classification paths. Production delivery additionally requires the dashboard step: **Compute > Email Service > Email Sending > Onboard Domain** on a Cloudflare-DNS zone in the account, plus real sender identities on that domain in Site Configuration (the placeholder `noreply@mail.wazibiz.example` will be rejected `E_SENDER_NOT_VERIFIED` until then); no email secret is needed at deploy time. Failure classification maps only documented `E_*` codes (quota/service/availability → transient; validation/sender/recipient → permanent; unknown → transient, bounded at 5 attempts). CSO: `docs/security/2026-09-01-v2-issue-28-email-service-cso.md` (OK FOR CURRENT SCOPE; watch items W-28g-j).
- **W-29b (#29, resolved by #31):** Publication now has its own operator route (`POST /api/v2/build-versions/:buildVersionId/publication`) gated by an action-bound publish capability (buildId + buildVersionId + artifactManifestHash + expiry) under the #29 HMAC scheme; Approval/Rollback capabilities are insufficient and vice versa, denial order is fixed (401 → 403 → domain), and the authorized manifest hash is re-enforced at the persistence mutation boundary (`expectedArtifactManifestHash`). Route success tests run the real production assets-only deployer against a stubbed Cloudflare API; the mint script's `publish` action is byte-pinned by a known-answer vector. Evidence: `tests/v2-operator-capability.test.ts` (24 tests: token library + approval/rollback/publication routes), `docs/security/2026-09-01-v2-issue-31-cso.md`.
- **Platform Sender Identity (#32):** the hard-coded sender mailbox is removed from product behavior. The default outbound `From` is the `WAZIBIZ_SENDER_EMAIL` Worker var (configuration, not a secret), validated at the delivery boundary; Site Configuration `sender_identity` is an explicit verified override, validated at the config boundary (`SENDER_IDENTITY_INVALID`). Missing/malformed configuration fails closed: transient ledger row naming `WAZIBIZ_SENDER_EMAIL`, zero transport calls, no fallback address, never a visitor From; acceptance unaffected; the bounded retry heals after the environment is fixed. Recorded sender stays authoritative on retry (existing contract). Production var deliberately unset until the operator approves the mailbox (#33/#27); staging/test use explicit example addresses. Evidence: `tests/v2-form-service.test.ts` (issue #32 suite: configured-From, env-change, fail-closed classes, visitor/recipient contracts, retry semantics, adapter handoff, config validation), `docs/security/2026-09-01-v2-issue-32-cso.md`.
- Standing watch items M1–M3, L2–L3, W1–W16 are recorded in the individual CSO reports under `docs/security/`.
