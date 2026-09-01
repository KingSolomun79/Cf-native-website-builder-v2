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

- **W14 (#25, tracked as #27):** delete retired production secrets during the production deploy. Audit 2026-09-01 (#27): production holds exactly `SMTP2GO_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET` (`CANDIDATE_VALIDATION_SECRET` not present); all four are unreferenced by the V2 runtime. Deletion is blocked until a version that does not bind them is deployed — Cloudflare rejects secret changes with error 10215 while the latest uploaded version is undeployed, and the live version is still V1 (`dc99fb34`, restored by the 2026-08-19 rollback). Runbook: backup/export prod D1, reconcile migration tracker (0001-0016), apply 0017-0030, `wrangler deploy` V2, `wrangler secret delete` the four names, verify `wrangler secret list` shows only active V2 secrets. Full record: issue #27 audit comment.
- **W4 (#15):** capability-token gating required before approval/rollback operator routes are exposed.
- **H2 wiring:** set `WAZIBIZ_EMAIL_TRANSPORT_URL` (+ token secret) before production form traffic; fail-closed until then.
- Standing watch items M1–M3, L2–L3, W1–W16 are recorded in the individual CSO reports under `docs/security/`.
