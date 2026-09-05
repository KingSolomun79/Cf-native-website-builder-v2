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

Issue #33 automatable preparation (commit `d0002c0`) completed the
production-readiness work that needs no operator credentials: the V2
secret inventory re-audited against live source references (required:
ZHIPU_API_KEY, OPENROUTER_API_KEY, KIE_API_KEY, CF_AIG_TOKEN,
CF_DEPLOY_API_TOKEN, OPERATOR_CAPABILITY_SECRET, WEBHOOK_SECRET; optional:
TURNSTILE_SECRET_KEY while turnstile_required = 0; retired names all
unreferenced), retired dummy vars purged from wrangler.test.jsonc, a
name-only hygiene gate added (scripts/verify-v2-secrets.mjs — validated
read-only against the preserved V1 Worker, which correctly fails V2
hygiene while remaining untouched), provider ownership and
fresh-over-reuse guidance added to the #27 runbook, and the staging smoke
Site reset to the platform-default sender sentinel. Live staging
verification (deployed from clean tree `d0002c0`; Worker
cf-website-factory-staging version `a2902da6-e6ae-4dca-ba4c-63eaddf991e0`;
WAZIBIZ_SENDER_EMAIL var live): a controlled submit was Accepted
(submission `fde3ede4-fe64-47a3-9f63-e235fa2159d7`) and the real
Cloudflare Email Service path recorded
sender_identity = noreply@staging.wazibiz.example (exactly the env value —
issue #32 wiring), destination from Site Configuration, visitor email as
Reply-To, and E_SENDER_DOMAIN_NOT_AVAILABLE as bounded transient_failure
with a scheduled retry — deterministic fail-closed pending the operator's
dashboard domain onboarding. Remaining #33 items are operator-gated:
sender-domain onboarding, production WAZIBIZ_SENDER_EMAIL approval, and
provider secret provisioning at #27. Final state: 28 test files / 201
tests, typecheck clean, dry-runs pass, tree clean.

The guided #33 Email Service setup completed on 2026-09-02: the operator
onboarded wazibiz.ke under Compute > Email Service > Email Sending
(dashboard: Enabled, DNS records Configured — public DNS confirms the
cf-bounce MX and that the pre-existing apex SPF and DMARC p=reject were
preserved untouched alongside the domain's live Cloudflare Email Routing
inbound setup) and selected notifications@wazibiz.ke as the platform
sender. Staging WAZIBIZ_SENDER_EMAIL was repointed to the real mailbox
(commit `f546a8a`; Worker cf-website-factory-staging version
`e0234372-ec84-4a64-abc3-294cd7798ee2`), and the committed smoke path
recorded the #33 success gate on the REAL Cloudflare Email Service:
submission `70b5906e-50d1-41bd-b220-95c7f4c43338` → Accepted →
**delivered** on attempt 1, with sender_identity =
notifications@wazibiz.ke (exactly the env var), destination from Site
Configuration, and the visitor address strictly as Reply-To. Production
still defines no sender var until the #27 deploy; the one remaining #33
operator input is the provider secret values at #27 time.

Issue #27 executed 2026-09-02 as a fresh V2 production deployment (guided
operator runbook). Config re-point commit `32f65a3` fixed the inherited V1
deployment identity: Worker cf-website-factory-v2, D1 website_factory_v2
(`9e2597d1-9598-4c50-adcf-764c1b6319da`, created fresh), R2
website-factory-v2-assets (created fresh), PUBLIC_APP_URL v2, production
var WAZIBIZ_SENDER_EMAIL=notifications@wazibiz.ke, and the ZAI-primary
LLM plan (text glm-5-turbo, vision glm-4v, AI Gateway fallback;
OPENROUTER_API_KEY optional by operator decision). Migrations applied
30/30 to the clean database — all V2 tables present, zero V1-era tables
(0030's IF EXISTS guards). Deployed from clean tree `32f65a3` (first
version `852dacda-2e23-47b4-add8-14fa5983ddf8`; handlers fetch+scheduled;
cron */10; workflow website-build-workflow). Operator provisioned all
seven secrets via hidden prompts with explicit --name guardrails
(ZHIPU_API_KEY, KIE_API_KEY, CF_AIG_TOKEN, CF_DEPLOY_API_TOKEN,
OPERATOR_CAPABILITY_SECRET fresh >=32B, WEBHOOK_SECRET fresh >=32B,
TURNSTILE_SECRET_KEY) — live version after secret changes
`e741c1a6-5e65-4752-98e0-4082700ad409`. Secret-name hygiene gate clean:
required present, all six retired V1/interim names absent,
scripts/verify-v2-secrets.mjs updated to classify OPENROUTER_API_KEY as
optional per the operator decision. Health probes: GET / 404 (alive),
D1-backed route answers JSON, approval and publication routes deny 401
CAPABILITY_REQUIRED (capability gating live in production), form route
enforces the browser payload contract (400). V1 untouched proof against
the before-inventory: Worker live version still dc99fb34 (2026-08-19
rollback), D1/R2 unchanged, 10 V1 secret names unchanged. Gates: 28
files / 201 tests, typecheck clean, dry-run passes. CSO for the
deployment boundary: SECURITY OK FOR CURRENT SCOPE
(docs/security/2026-09-02-v2-issue-27-phase7-cso.md).

Issue #30 executed 2026-09-02/03 as the full production release verification
plus the canonical model correction.

**Model correction (Parts 0-5):** one canonical LLM model — glm-5.3-flash on
every V2 textual/multimodal call — replaced the per-provider/per-stage model
vars (ZHIPU_MODEL glm-5-turbo, VISION_PRIMARY_MODEL glm-4v, FALLBACK/
VISION_FALLBACK models retired) with a single LLM_MODEL seam
(src/lib/ai-gateway.ts CANONICAL_LLM_MODEL; provider failover keeps the exact
same model, never a substitution). Serving-shape corrections discovered live:
the AI Gateway proxy legs reject the plain canonical name (HTTP 400 code 2019,
"<provider>/<model>" demanded) so the ZAI primary leg calls the provider's
OpenAI-compatible endpoint directly; glm-5.3-flash is a reasoning model whose
thinking consumed the 4096-token budget (empty content, finish_reason=length)
and exceeded the provider's ~100s edge window (524), so the ZAI leg disables
thinking and floors max_tokens at 16384; the boundary states the stage's JSON
Schema on every first attempt, strips null-valued optional properties,
extracts JSON from markdown/prose, and records provider-reported model
identity in provenance. scripts/verify-llm-model-routing.mjs (wired into
`npm test`) fails the build on any legacy model literal in executable
routing. Production provenance for the Release Ready build: every
ai_stage_runs row records provider=zhipu model=glm-5.3-flash.

**Production pipeline wiring:** WebsiteBuildWorkflow now drives the full
REFERENCE_BOUND lifecycle through src/domain/build-pipeline.ts with every
stage as its own durable step (bounded engine retries); new KIE v2 adapter
(lib/kie-v2.ts, 1000-char z-image prompt cap, 429 backoff, USD-gated);
browser-backed QA capture (domain/qa-capture.ts); HMAC-gated
POST /api/v2/builds/:buildId/pipeline for Revision-Request Builds; generated
Contact forms post to PUBLIC_APP_URL (the placeholder form-service default is
gone); screenshot-only References get a canonical-screenshot evidence anchor.
Retry-safety hardened across ten live-diagnosed failure modes (frozen-artifact
reuse at the orchestration seam, per-subkey generation reuse, tolerant
deterministic re-freezes, KIE spend-resume, ≤1MiB step outputs, repair-time
artifact reuse, repair-plan wording rule, qa_report retry window).

**Live production results:** controlled REFERENCE_BOUND generation reached
Release Ready through a real bounded repair (v1 QA fail -> Fix Coordinator ->
immutable v2 -> confirmation pass; QA-A visual 93 / content 94 / QA-B 94;
12 accepted images; KIE spend $0.60; manifest 7faf8a69…d9bce). Approval
recorded under a minted capability with exact hash binding (negatives: no
token 401, wrong action/binding 403, expired 401); Publication deployed the
exact approved artifact with no regeneration (https://pub-dddd8e0d86-v2.
wazibizwebsites.workers.dev; four pages, shared assets, no provider URLs).
A controlled contact submission through the published site's browser contract
reached **delivered** on attempt 1 via the native Cloudflare Email Service
with From=notifications@wazibiz.ke, Reply-To=visitor only, To=the configured
Form Destination — #28's production criterion. Retired V1 routes 404 on the
V2 worker; the preserved V1 Worker still serves dc99fb34, untouched.
Rollback was correctly refused while no prior Published Version existed.

**Remaining gap (#30 stays open):** the second publication for the rollback
window did not reach Release Ready in six Revision-Request attempts — each
terminated in a correct bounded state (FAILED on stochastic generation
validation drift, HUMAN_REVIEW_REQUIRED when confirmation QA kept valid
blockers) after the accumulated fixes eliminated the systematic causes
(attempt-key collisions, repair regeneration regressions, boundary-regex
false positives, transient D1/DO step faults). The rollback execution and
stale-capability checks therefore remain unexercised in production;
CSO: docs/security/2026-09-02-v2-issue30-release-cso.md (SECURITY OK FOR
CURRENT SCOPE, watch items recorded).

## 2026-09-04 — #34/#35/#36 Workflow-retry & repair-effectiveness hardening; #30 second-publication attempts 1-7

**Session goal:** resume #30 from the second-publication requirement by first fixing the documented
repair-loop state defect (#34). Every attempt then surfaced and fixed one more real defect; five
dedicated commits shipped, each with regression tests and a deployed exact SHA.

**Defects fixed (all regression-tested, all live-observed first):**

1. **#34 — repair-loop state vs engine retries (22225c1, worker 5dde4344).** The bounded-repair
   position is now reconstructed from the append-only `repair_batches` ledger on every pipeline
   entry; a re-entry no longer re-runs the Fix Coordinator into the storage ceiling. Also: repaired
   versions inherit frozen design artifacts; `qa_report` verdicts are reused (with record-pinning)
   on re-entry; `applyRepairBatch` pre-checks the budget before creating a version (no more orphan
   versions). Latent copy bug found by the new tests: the artifact-inheritance INSERT…SELECT bound
   ONE id for all rows, so INSERT OR IGNORE copied only the first row.
2. **Image-attempt resume (4e94895, worker 40bde02d).** `runImageWave` restarted attempt numbering
   at 1 every pass → UNIQUE (build_version_id, slot_id, attempt_number) crash-loops on re-entry
   (live: build 09c9f1ab). Numbering now resumes from persisted rows; exhausted slots are skipped
   so the wave completes and assembly routing/preflight decides.
3. **#35 — repair never applied (c32b2bf, worker c1441c94).** The repaired version was a verbatim
   copy of the failed one, so confirmation QA re-judged identical content and blockers (incl.
   GATE_PREVIOUS_BLOCKERS_RESOLVED) were structurally unresolvable. Repaired versions are now
   GENERATED WITH their batch's plan directives, loaded from D1 truth
   (`repair_batches.plan_json` by `created_build_version_id`) so re-entries reapply the same plan;
   design-origin artifacts stay frozen; boundary re-validated on every load.
4. **Rejected-manifest re-freeze (79cfd57, worker 9df800f1).** The preflight-REJECTED assembly
   wrote its diagnostic manifest non-tolerantly, poisoning `v{n}/manifest.json` so every retried
   assemble crashed on "Immutable R2 artifact already exists" (live: build 940570ff).
5. **#36 — boundary-heuristic false positives (722ae4a, worker f8a12cc8).** The plan-text mutation
   regex tripped on legitimate realization wording 2 of 6 attempts and crashed builds to FAILED.
   Planner now gets ONE bounded re-word with the violation shown; a persistent violator routes the
   build to HUMAN_REVIEW_REQUIRED (no batch consumed, no version created) instead of FAILED.
6. **Composition targets (77e3fb8, worker db90851e).** Systematic visual-gate failures diagnosed:
   the generator received only qualitative region purposes while QA hard-gates measured numbers.
   The frozen evidence's region viewport-height ratios now reach the home prompt as an explicit
   COMPOSITION TARGETS block (same evidence QA measures — no gate change).

**#30 second-publication attempts (all bounded terminals, none Release Ready):**
09c9f1ab FAILED (boundary trip); f19a1baf HUMAN_REVIEW_REQUIRED (verbatim-copy era); 940570ff
workflow errored at poisoned manifest; f0dd789d FAILED (boundary trip after repair-regeneration
drift); 8fea4b6b FAILED (footer-less regeneration caught by deterministic validation); 513390c3
HUMAN_REVIEW_REQUIRED — repair lifted visual fidelity 63 → 86 with composition targets + applied
directives, remaining blockers GEOMETRY_REGION_ORDER + CRITICAL_IMAGE_SLOTS_RESOLVE. 78c6da8b
(attempt 7, after composition targets) HUMAN_REVIEW_REQUIRED at the full ceiling: visual 62 → 88
across the two applied batches; remaining blockers gate-region-order + technical 74 — converging
toward the gates on exactly the region-semantics finding.

**Open product-design finding (needs a human decision, deliberately NOT auto-fixed):** Reference
Analysis aggregates the reference's ~9 visually-segmented regions into 4 blueprint regions;
generation realizes the 4; but QA geometry compares the candidate capture's independent ~9-block
segmentation against the un-aggregated reference segmentation (live: blueprint 4 regions
`region_01_hero…region_04_conversion` vs candidate capture 9 blocks `region-1…region-9`,
first block 0.081 viewport = the header). Until segmentation semantics are unified (capture by
`[data-region]`, or comparator against blueprint-aggregated regions), the geometry gates measure a
topology the generator is told to build differently. Changing either side is a QA-gate semantics
decision, not a mechanics fix.

**Gates at session end:** 31 test files / 216 tests, typecheck clean, dry-run pass. CSO:
docs/security/2026-09-04-v2-issue34-repair-retry-cso.md + addenda 1-4 (SECURITY OK FOR CURRENT
SCOPE). #34/#35/#36 closed; #30 remains OPEN — second publication, rollback execution and
stale-capability rejection remain unexercised pending the region-semantics decision.

## 2026-09-04 — #37 canonical region semantics; #38 confirmation resolution semantics

**#37 (fixed, production-verified, closed — commit 948fac8):** the canonical
region-semantics inconsistency is resolved. The authoritative model is now:
Reference Evidence = observational/raw measured evidence; Reference Analysis =
interpretation/aggregation; Visual Blueprint = binding canonical region
topology; Generator implements Blueprint topology; QA topology gates judge
against the Blueprint; measured fidelity gates keep using raw Reference
Evidence. Production-proven in the #30 revision of build bbe8c8f9:
PAGE_SILHOUETTE_REGION_ORDER passed correctly. Not to be reopened.

**#38 (this session, implementation b6043541a7391376b2c20e79c1ac95f8ba315d5e):**
confirmation QA re-emitted resolved blockers as P1 findings and
`resolveAfterConfirmation` counted every P0/P1 finding as an active Release
Blocker — driving a factually clean repaired candidate (visual 93, content 92,
technical 93, all gates green) to HUMAN_REVIEW_REQUIRED with "2 valid Release
Blocker(s)" that were actually verified resolutions. The defect was two-layered:
the confirmation seam had no structured way to report resolution state, and the
resolver classified findings by severity alone.

**Fix (narrow, confirmation seam only):** confirmation findings now carry a
REQUIRED structured `status: "ACTIVE" | "RESOLVED"` (schemas
`qa-a-confirmation/2` / `qa-b-confirmation/2`); the confirmation prompt
instructs explicit classification (RESOLVED = fixed prior defect reported with
its ORIGINAL severity — a resolution record, never an active blocker; ACTIVE =
unfixed / partially fixed prior blocker or NEW defect); `isReleaseBlocker` and
both release evaluators count only non-RESOLVED P0/P1 findings; RESOLVED
findings are returned as a `resolved` evidence bucket on the verdict and
resolution result. Fail-closed: missing/ambiguous status fails schema
validation → one structural repair → stage failure → FAILED terminal — it can
never silently become Release Ready. Fresh QA-A/QA-B schemas are byte-identical
(findings cannot carry `status`), so fresh blocker semantics, thresholds
(>=90), hard gates and P0/P1 definitions are unchanged. Repair budgets, region
semantics (#37) and glm-5.3-flash routing untouched.

**Regression evidence:** the new pipeline test reproduces the production defect
end-to-end (repaired v2 whose confirmation re-reports the fixed first-viewport
P1 with original severity): pre-fix RED (terminal FAILED — the seam could not
even express resolution state), post-fix RELEASE_READY at v2 with exactly one
fix_coordinator batch and the release record pinned to the repaired version.
Evaluator matrix covers resolved P0/P1 (A/B), still-active P0/P1 (C/D), new
P0/P1 discovered during confirmation (E/F), the exact production note (G),
fresh-QA invariance, and schema fail-closed guards (H); lifecycle seam tests
cover the full-budget RESOLVED release (I), still-active + new blockers
(J), and the ambiguous-output escalation.

**Gates at session end:** 32 test files / 235 tests passing (+10), typecheck
clean, wrangler dry-run pass. CSO:
docs/security/2026-09-04-v2-issue38-confirmation-resolution-cso.md (SECURITY OK
FOR CURRENT SCOPE; watch item: model-controlled status manipulation is the
pre-existing LLM-evaluator trust boundary, not widened — scores/gates/fabrication
remain independent conjuncts and full status-bearing findings persist in
immutable R2 artifacts).

## 2026-09-04 — #30 closed: second publication, rollback and stale-capability rejection (post-#38)

Deployed the #38 implementation SHA b6043541a7391376b2c20e79c1ac95f8ba315d5e
to cf-website-factory-v2 (worker version 257ea70c-c9d7-4ba4-9d71-74ef41a12163,
2026-09-04T21:29Z; targets verified: D1 website_factory_v2, R2
website-factory-v2-assets, V1 untouched). Production health verified.

**One new Revision Request d7d38808** on published build dddd8e0d (Site
5ce85bdf) created Build 7da9e4fa. The real pipeline ran: v1 failed QA-A
(first-viewport hero at 0.081 of viewport vs required 0.9, region-count
deviation) → ONE Fix Coordinator batch → repaired immutable v2 4f8cf734 →
confirmation QA → **RELEASE_READY**.

**#38 proven in production:** the confirmation reports re-emitted both prior
P1 blockers with their ORIGINAL severity and `status: RESOLVED` (four findings
across QA-A/QA-B — the exact production defect pattern), and the resolver
counted zero active blockers: release record visual 92 / content 94 /
technical 92, fabrication 0, all hard+mandatory gates green,
`releaseBlockers: 0`, verdict RELEASE_READY. The Release Blocker Fix budget
was never consumed (exactly one repair batch). Provenance:
provider=zhipu, model=glm-5.3-flash on fix-coordinator and both confirmation
stages.

**Release lifecycle:** Approval acedb185 (2026-09-04T21:49:03Z) bound to v2
4f8cf734 + artifactManifestHash 4ade328bca45106b680246cad440c99f5c0cce8426d7d11587c8b43b2db687ec.
An approval capability against the publication endpoint was correctly denied
403 CAPABILITY_INSUFFICIENT; a separate publish capability executed the second
Publication 41c2dd04 (https://pub-7da9e4fa5c-v2.wazibizwebsites.workers.dev,
published 2026-09-04T21:49:22Z) with the exact approved hash — no
regeneration, no candidate reselection. Live verification: four pages 200,
site.css/site.js + assets 200 (project-controlled asset paths only), contact
form posts to the platform Form Service endpoint, no provider temp URLs, no
secrets.

**Rollback:** capability bound to Site 5ce85bdf + current Published Version #2
executed → Published Version #1 restored (publication 7e0f7b9d, build version
edecd502, https://pub-dddd8e0d86-v2.wazibizwebsites.workers.dev) — no new
Build, no new Approval, no new publication row, exact prior artifact, Site
Configuration untouched. A subsequent rollback capability stale relative to
the now-current state was **rejected 403 CAPABILITY_INSUFFICIENT**.

**Form/email:** live submission on the restored version → Accepted Submission
(202) → email_deliveries `delivered` attempt 1 to the platform sender identity
(destination notifications@wazibiz.ke). Origin enforcement verified fail-closed
(403 ORIGIN_NOT_ALLOWED without allowed Origin).

**V1 unchanged:** worker cf-website-factory last deployed 2026-08-19
(version dc99fb34, predates all V2 work); D1 website_factory_v1 and R2
website-factory-assets present and untouched. V2 has no V1 fallback path.

**Final #30 gates:** 32 test files / 235 tests passing, typecheck clean,
wrangler dry-run pass. CSO final verdict (with production addendum):
docs/security/2026-09-04-v2-issue38-confirmation-resolution-cso.md — SECURITY
OK FOR CURRENT SCOPE.

## 2026-09-05 — #39 evidence-sufficiency guard (REFERENCE_BOUND fidelity remediation, issue A)

Forensic diagnosis accepted (RankForge/Morabeza: a dimensions-only evidence
package reached Release Ready at 92 while consuming no reference pixels).
Implementation order: scoped issues #39-#46; #39 lands first.

**Change:** deterministic, versioned evidence-sufficiency evaluation
(`reference-sufficiency.ts`, `REFERENCE_SUFFICIENCY_VERSION=1`). Blocking
dimensions `region_structure` + `measured_elements` (the synthetic
canonical-screenshot anchor never satisfies them). Undeclared missing blocking
dimension -> INSUFFICIENT -> build-pipeline terminal HUMAN_REVIEW_REQUIRED with
root cause EVIDENCE_EXTRACTION; Adaptation Contract declarations
(`evidence_missing:<dimension>`) -> PARTIAL (proceeds; downstream #42 coverage
must treat them as uncovered). Verdict computed pre-freeze, persisted on the
immutable package (migration 0031: nullable `evidence_sufficiency` enum mirror
+ `evidence_sufficiency_verdict_json`), legacy pre-#39 rows evaluated lazily on
read without rewriting frozen evidence. Screenshot-only + dimensions-only is
now insufficient by design; screenshot-only + extracted evidence (#41) will be
valid. ORIGINAL_DESIGN untouched.

**Fleet migration:** pipeline fixtures moved from dimensions-only
SCREENSHOT_ONLY to SCREENSHOT_AND_URL with a measured reference-capture
fixture (`createPipelineScripts().capture` seam added to `BuildPipelineDeps`,
production default unchanged). Fixture reference host changed to
`meridian-atelier.example.com` (the blueprint reference-content lint would
otherwise trip on the host token `reference` appearing in blueprint prose).

**Gates:** full suite 33 files / 243 tests passing (new suite
`tests/v2-reference-sufficiency.test.ts` pins the frozen RankForge evidence
shape as INSUFFICIENT and proves no AI stage runs on it). Typecheck clean.
Wrangler dry-run pass. CSO:
docs/security/2026-09-05-v2-issue39-evidence-sufficiency-cso.md — SECURITY OK
FOR CURRENT SCOPE (watch item: #42 must treat declared-missing dimensions as
uncovered).

**Commit:** 6d309dca0ce146e0e064000bb274b02956d25057

## 2026-09-05 — #40 production reference capture + modern capture contract (issue B)

**Change:** `defaultProductionCapture` (zero-arg, `playwrightAdapter.launch(undefined)`
on every production URL intake — the P0 crash of 9c27006e) replaced by
`createProductionReferenceCapture(env)`: the Worker environment is bound at
factory time and validated pre-launch, making `launch(undefined)` unreachable
by construction. The capture itself is now a bounded multi-signal sequence:
load -> bounded overlay dismissal (≤3 clicks, each gated by typed countMatches,
cookie/consent/close selectors only, recorded in discrepancies) -> wait
images/assets -> real scroll sweep with settle waits -> viewport checkpoints at
section boundaries (≤8) -> post-sweep layout (flattened truth) -> canonical
full-page capture -> bounded mobile pass (375×812; failure recorded, not
fatal). Adapter-measured surface colours, spacing and image inventory now ride
the measuredElements channel instead of being dropped. New limitation kind
`unreliable_scroll_flattening`: topology collapse / extreme reflow under real
scroll -> SUPPORTED_WITH_LIMITATIONS (Adaptation Contract mandatory);
modest lazy-load growth stays non-flagged. Screenshot-authority semantics
unchanged.

**Tests:** new `tests/v2-reference-capture.test.ts` (7): production-wiring seam
(launch receives the env — the test that would have caught the original
defect), pre-launch BROWSER guard, intake default path env-bound (fails closed
without BROWSER), multi-signal sequence against the fixture adapter (probes,
sweep, checkpoints, mobile, page/session hygiene, surface/spacing measurement,
flattening_check discrepancy), flatteningSignal unit rules, and
suitability integration (scroll-transform capture -> SWL + mandatory contract).
Fixture adapter gained an optional `sections` scenario override (defaults
unchanged).

**Gates:** full suite 34 files / 250 tests passing; typecheck clean; wrangler
dry-run pass; CSO: docs/security/2026-09-05-v2-issue40-production-capture-cso.md
— SECURITY OK FOR CURRENT SCOPE (watch: automated third-party clicks bounded ≤3
and recorded; capture fan-out R2 cost retention-managed; real-Playwright
staging verification deferred to the #46 production retest).

**Commit:** 7c4483ec6584ffa8ddd7f8f871f2891de89f6f31

## 2026-09-05 — #41 Reference Visual Package + deterministic evidence extraction (issue C)

**Change:** the reference pixels can no longer disappear from the pipeline.
New dependency-free PNG codec (`src/lib/png-codec.ts`, platform Compression
Streams; bounded inflate + 40MP ceiling — decompression-bomb guard). New
deterministic extraction (`visual-evidence-extraction.ts`): row-band
segmentation of the canonical screenshot (two-sided window boundary
detection), per-band dominant surface colour/luminance/PIXEL-level ink
density (full-res stride sampling; block averages would smooth texture away),
image-mass rectangles, surface sequence, colour roles, image-mass ratio —
UNKNOWN (null) wherever pixels cannot support a value. Evidence schema v2
(additive optional `extraction` + hash-bound `visualInputs`; v1 artifacts stay
valid). Intake extracts for EVERY input mode: screenshot-only bands become
the measured region structure (screenshot-only + extraction = valid per
#39's mapping); URL captures keep DOM regions with the pixel channel beside
them. Normalized model-consumable visual inputs (1024-wide full page, ordered
vertical slices over 6000px) persisted to build-scoped R2 with SHA-256
provenance — the Reference Visual Package.

**Comparator truthfulness:** `geometryFromRegions` loses ALL fabricated
defaults (0.9 / 0.83 / 0.22 / asymmetric / synthetic surface sequence);
unmeasured metrics are null and are skipped pairwise; the reference image
mass comes from the extraction channel — the self-compare seeding
(candidate's own capture mass into the reference profile) is deleted; an
empty reference profile yields status
`INSUFFICIENT_REFERENCE_EVIDENCE` with `similarityScore: null` — the exact
RankForge vacuous-75% path is inverted into a loud failure. QA-A evidence
summary reports similarity only with measurement coverage.

**Tests:** new `tests/v2-visual-evidence.test.ts` (9): codec round-trip,
downscale, extraction determinism + band/image-mass/colour assertions,
undecodable + too-small UNKNOWN semantics, comparator truthfulness (empty
reference -> no similarity; pairwise measured-only metrics; UNKNOWN fields),
intake integration (screenshot-only + decodable screenshot -> SUFFICIENT with
extracted bands, package artifacts hash-verified in R2). Intake test suite
bumped to evidence version "2".

**Gates:** full suite 35 files / 259 tests passing; typecheck clean; wrangler
dry-run pass; CSO:
docs/security/2026-09-05-v2-issue41-visual-package-cso.md — SECURITY OK FOR
CURRENT SCOPE (watch: coverage reported but not gating until #44).

**Commit:** 587ac6d1dea063e3ddfd47b5802af337c25cef4a

## 2026-09-05 — #42 multimodal Reference Analysis + Blueprint coverage contract (issue D)

**Change:** the analyzer finally sees the reference and the Blueprint can no
longer silently erase it.
(a) Multimodal analyzer: when frozen evidence carries normalized visual
inputs, runReferenceAnalysisStage routes through createProductionVisionGenerate
(R2 read of the primary visual input, base64, generateVisionWithGateway —
glm-5.3-flash per canonical model policy, provider chain + bounded retries;
system prompt folded into the single multimodal user turn). Provenance records
visual input artifact ids; a missing visual artifact fails typed
(VISION_INPUT_UNAVAILABLE) instead of silently degrading to text-only. The
analysis prompt declares the attached visual package, keeps JSON evidence as
the sole authority for measured facts, and includes the extraction channel.
Text-only `generate` seam remains for evidence without visual inputs (tests /
undecodable screenshots).
(b) Coverage contract: evaluateBlueprintCoverage (deterministic, significance-
based — no fixed region counts): identity-defining analysis traits preserved
via sourceTraitId; major measured masses (>= 0.35 viewport) claimed by
canonical regions via sourceEvidenceRegionIds; extraction image-mass bands
inside claimed territory (y-overlap); explicit Adaptation Contract tokens
(`mass:<id>`) may legally accept a mass drop. GAPS -> BLUEPRINT_REVIEW_REQUIRED
event -> HUMAN_REVIEW_REQUIRED terminal BEFORE Implementation Contract
production — generation never starts from a known-lossy Blueprint.
(c) Fixed the un-interpolated trait-id template literal in
buildBlueprintUserPrompt (model saw raw JS source) and added the coverage
mandate sentence. #37 aggregation/provenance semantics unchanged and
aggregation remains allowed.

**Tests:** new tests/v2-blueprint-coverage.test.ts (10): COVERED/GAPS unit
semantics (mass drop, contract-declared drop, trait erasure, sub-threshold
freedom, image-mass overlap), multimodal seam routing (vision called, text
seam proven untouched, provenance artifacts recorded, prompt metadata),
production adapter R2-miss refusal, prompt content, and full-pipeline
enforcement (lossy blueprint -> HUMAN_REVIEW_REQUIRED with no implementation
contract artifact).

**Gates:** full suite 36 files / 269 tests passing; typecheck clean; wrangler
dry-run pass; CSO:
docs/security/2026-09-05-v2-issue42-multimodal-coverage-cso.md — SECURITY OK
FOR CURRENT SCOPE.

**Commit:** (sha recorded post-commit)
