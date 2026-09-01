# V2 Implementation Log — issue tranche record

One dedicated commit per issue; commit message references the issue number.
Every issue advanced only after full `npm test` + `npm run typecheck` were
green and the mandatory `/morabeza-cso` pass had no unresolved blocking
findings. CSO reports live in `docs/security/`.

## Tranche #3–#13

| Issue | Commit | Tests | Typecheck | CSO |
|---|---|---|---|---|
| #3 Brownfield V1→V2 migration manifest | `a04e972` | 351 pass | pass | covered by tranche CSO below |
| #4 V2 domain lifecycle backbone | `b1f0aca` | 351 pass | pass | covered by tranche CSO below |
| #5 Revision Request + Fact Update lifecycle | `1e4c279` | 360 pass | pass | tranche CSO (report 2026-09-01) |
| #6 Canonical prompt/schema/provenance contracts | `41cb9e0` | 366 pass | pass | tranche CSO |
| #7 Reference intake, suitability, evidence freeze | `e75431c` | 379 pass | pass | tranche CSO |
| #8 Reference Analysis, Visual Blueprint, Implementation Contract | `6d9e792` | 389 pass | pass | tranche CSO |
| #9 Complete REFERENCE_BOUND four-page Site | `b81d1b5` | 395 pass | pass | tranche CSO |
| #10 Budgeted two-wave image generation | `3793e96` | 402 pass | pass | tranche CSO |
| #11 WAZIBIZ Form Service | `712b1ad` | 408 pass | pass | tranche CSO + H2 remediation |
| #12 Technical Preflight + Preview deployment | `c89a91d` | 414 pass | pass | tranche CSO + H1 remediation |
| #13 Standardized visual evidence + release QA | `d32b7ab` | 423 pass | pass | tranche CSO |
| CSO tranche sign-off + H1/H2 remediation regression tests | `a40a145` | 428 pass | pass | **SECURITY OK FOR CURRENT SCOPE** |

Tranche CSO report: `docs/security/2026-09-01-v2-issues-3-13-cso.md`.
Findings H1 (V1 contact-worker/SMTP2GO injection in the preview deployer)
and H2 (unwired email transport) were remediated before this commit; the
Medium/Low findings (M1 read-API auth, M2 rate-limit hardening, M3 script
allowlist, L2 image byte validation, L3 hygiene) are recorded there as
non-blocking watch items. Final tranche verification: 35 test files /
428 tests passed, `tsc --noEmit` clean, `wrangler deploy --dry-run` passes,
working tree clean.

Per-issue test counts above are the cumulative suite size at the time the
issue's implementation was verified; the tranche was verified end-to-end
after the CSO remediation at 428/428.

## Sequential issues #14-#26, #29

| Issue | Commit | Tests | Typecheck | CSO |
|---|---|---|---|---|
| #14 Bounded Automated Repair | `b78ed69` | 436 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-14-cso.md`, watch items W1-W3, none blocking) |
| #15 Approval, Publication, Rollback | `4b1cec7` | 442 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-15-cso.md`, W4 gates future operator routes) |
| #16 Deployment + artifact retention lifecycle | `a0d8128` | 448 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-16-cso.md`, W7 fixed in-diff) |
| #17 Five-site benchmark harness | `dd67a43` | 454 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-17-cso.md`) |
| #18 Benchmark Site 1 (asymmetric/editorial) | `ae739df` | 457 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-18-cso.md`) |
| #19 Benchmark Site 2 (hospitality/travel) | `b5f09c4` | 460 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-19-cso.md`) |
| #20 Benchmark Site 3 (corporate/professional) | `ccdfb0b` | 463 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-20-cso.md`) |
| #21 Benchmark Site 4 (trades/local service) | `a52b883` | 466 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-21-cso.md`) |
| #22 Benchmark Site 5 (responsive/motion) | `66ea5f9` | 469 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-22-cso.md`) |
| #23 REFERENCE_BOUND proof gate | `39d4018` | 474 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-23-cso.md`) |
| #24 ORIGINAL_DESIGN site generation | `d7d98b8` | 478 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-24-cso.md`) |
| #25 Contract away V1 architecture | `75cd12d` | 149 pass (V1 suites removed with their modules) | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-25-cso.md`; W14 = operational secret deletion) |
| #26 Final integration + release verification | `9812017` | 153 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-26-cso.md`; W17 fixed in-diff) |
| #29 Capability-token gating of Approval/Rollback operator routes (W4) | `66f5019` | 182 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-29-cso.md`; F1-F4 fixed in-diff; W-29a = set `OPERATOR_CAPABILITY_SECRET` in production) |
| #28 WAZIBIZ Form Service email transport (H2) | `bde4be5` | 195 pass | pass | OK WITH WATCH ITEMS (`docs/security/2026-09-01-v2-issue-28-cso.md`; F1 caught live + fixed in-diff; W-28d = production token + `SMTP2GO_API_KEY` set at the #27 deploy; W-28f = real verified Sender Identity) |
| #28 follow-up: native Cloudflare Email Service transport | `f8e6afb` | 186 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-28-email-service-cso.md`; interim SMTP2Go/router architecture fully removed; W-28h = dashboard domain onboarding before production delivery; W-28g = tighten binding sender allowlist after onboarding) |
| #31 Capability-gated Publication operator route | `fc1a75c` | 194 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-31-cso.md`; W-29b closed; publish-side TOCTOU enforced at the mutation boundary) |
| #32 Configurable platform Sender Identity (`WAZIBIZ_SENDER_EMAIL`) | `3636880` | 201 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-issue-32-cso.md`; hard-coded mailbox removed; fail-closed sender gate; W-32a = set production var at #33/#27) |

| QA sweep (#5-#16, #24, #25) | `7ff3433` | 166 pass | pass | 4 findings (1 Medium criterion gap, 2 Medium, 1 Low) — `docs/qa/2026-09-01-v2-qa-sweep.md` |
| QA remediation (F1-F3) | (this commit) | 166 pass | pass | OK FOR CURRENT SCOPE (`docs/security/2026-09-01-v2-qa-remediation-cso.md`); F4 deferred |

## Sequence complete (#3-#26)

All issues #3-#26 landed sequentially, each with a dedicated commit
referencing the issue, a passing per-issue `/morabeza-cso` sign-off with no
unresolved blocking findings, and full `npm test` + `npm run typecheck`
green before and (where fixes were applied) after the CSO pass. Final
state: 26 test files / 153 tests, typecheck clean, `wrangler deploy
--dry-run` passes, working tree clean. Requirement-to-evidence map:
`docs/v2-verification-evidence.md`. Release follow-ups: W14 secret
deletions, H2 transport wiring, W4 gating before operator routes.

Issue #29 (post-verification follow-up W4) later added the capability-token
gated Approval and Rollback operator routes on the same gates: 28 test
files / 182 tests, typecheck clean, `wrangler deploy --dry-run` passes.
W4 is closed; remaining release follow-ups: W14 secret deletions, H2
transport wiring, W-29a production secret set.

Issue #28 (post-verification follow-up H2) implemented the transport
endpoint itself — the `wazibiz-email-router` Worker (bearer-authenticated
platform contract, SMTP2Go provider leg, fail-closed until its secrets are
complete), deployed live — plus the `EMAIL_ROUTER` service-binding channel
(Workers cannot fetch each other's `*.workers.dev` URLs within one
account; live-verified), the `*/10` cron retry sweep (PRD 37 bounded
server-side retry now has a production trigger), and a staging-equivalent
environment (`cf-website-factory-staging` + `website_factory_staging` D1)
whose controlled smoke produced live ledger evidence for acceptance →
Email Delivery through the configured router, both fail-closed states, and
the cron-driven retry. Production secret wiring stays deploy-coupled to the
#27 runbook (Cloudflare blocks secret changes until a V2 version deploys);
the final `delivered` status additionally needs the operator to set
`SMTP2GO_API_KEY` on the router. Final state: 29 test files / 195 tests,
typecheck clean, `wrangler deploy --dry-run` passes.

The #28 follow-up commit then replaced that interim architecture with the
**native Cloudflare Email Service `send_email` binding** (`env.EMAIL`) as
the single authoritative outbound transport: no provider API key, no
shared transport secret, no HTTP email-router hop. The router Worker
(live), its config, tests, deploy script and the staging transport-token
secret were all removed; failure classification now maps only documented
Cloudflare `E_*` error codes (quota/service/availability → transient,
validation/sender/recipient → permanent, undocumented → bounded
transient). The `*/10` cron sweep and the staging environment remain. Live
re-verification: the redeployed staging Worker invoked the real Email
Service and recorded the documented `E_SENDER_DOMAIN_NOT_AVAILABLE` as
bounded `transient_failure` — fail-closed pending the dashboard domain
onboarding (Compute > Email Service > Email Sending), which replaces all
email-secret steps in the #27 runbook. Final state: 28 test files / 186
tests, typecheck clean, `wrangler deploy --dry-run` passes for production
and staging.

Issue #31 then exposed the Publication domain service through its own
operator surface, `POST /api/v2/build-versions/:buildVersionId/publication`,
closing W-29b: a publish capability is its own action-bound token
(buildId + buildVersionId + artifactManifestHash + expiry) under the #29
HMAC scheme, so Approval and Rollback capabilities are structurally
insufficient and vice versa. Denial order is fixed (401 absent/invalid/
expired, 403 wrong action/binding, then the domain call), the authorized
manifest hash is re-enforced at the persistence mutation boundary
(`expectedArtifactManifestHash` — the publish-side analogue of rollback's
conditional state flip), the mint script gained the `publish` action
(byte-pinned by a new known-answer vector), and route success tests
exercise the real production assets-only deployer against a stubbed
Cloudflare API. Publication semantics are unchanged: exact approved
version, exact manifest hash, no regeneration, idempotent retry only for
the same permitted version. Final state: 28 test files / 194 tests,
typecheck clean, `wrangler deploy --dry-run` passes for production and
staging.

Issue #32 then removed the hard-coded platform sender mailbox from
product behavior: the default outbound From is the WAZIBIZ_SENDER_EMAIL
Worker var (configuration, not a secret), validated at the delivery
boundary, swappable per environment without source changes. Site
Configuration sender_identity remains an explicit verified override (the
future Business-owned sender path) and is now validated at the config
boundary; missing or malformed configuration fails closed with a ledger
row naming the cause, zero transport calls, no fallback address and
never a visitor From, while the Accepted Submission stays accepted and
the bounded retry heals after the environment is fixed. The recorded
sender stays authoritative on retry (existing Email Delivery contract).
Production deliberately defines no value until the operator approves the
mailbox (#33/#27); staging and the test environment carry explicitly
labelled example addresses. Final state: 28 test files / 201 tests,
typecheck clean, `wrangler deploy --dry-run` passes for production
(without the var) and staging (with it).
