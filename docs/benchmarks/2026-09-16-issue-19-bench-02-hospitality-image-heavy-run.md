# #19 — Benchmark Site 2 Run Evidence: bench-02-hospitality-image-heavy (Savanna & Tide Lodges)

Date: 2026-09-16 · Ticket: #19 (Validate Benchmark Site 2 end-to-end) · Result: **PASS**

## FINAL VERDICT

**#19 COMPLETE — PASS.** The canonical run reached the genuine terminal state
**RELEASE_READY on the first Build Version, with the ONE bounded Automated
Repair unconsumed** (`repair_consumed = 0`): visual 95 / content 95 /
technical 95 (gate 90), all 6 QA-A hard composition gates and all 15 QA-B hard
technical gates passed, zero P0/P1 findings, zero polish findings, 14/14
blueprint image slots accepted for **$0.70 of the $3.00 hard gate**, zero
manual source edits. Per `evaluateBenchmarkPass` this is an unconditional PASS
(automated RELEASE_READY + zero manual edits + spend ≤ USD 3; Approval and
Publication were NOT performed and are not required for benchmark PASS).

## IDENTITY

| Field | Value |
|---|---|
| Benchmark run ID | `c1adbed2-68b1-4ac4-bf9d-a6b84d8418ec` (append-only `benchmark_runs` row, `status = pass`) |
| Benchmark case | `bench-02-hospitality-image-heavy` — Savanna & Tide Lodges, slot 2, archetype `image-heavy hospitality/travel` |
| Definition version / hash | `1` / `70fcdbb44ac148ab9ff956777c525c4583f6de59d31a40ecb207d39539270ab4` (identical at freeze, preflight, run-start and record) |
| Code SHA executing the run | `e20bfbde5f48e3f384272647d8502bfac4873a98` — the clean-tree commit the production `cf-website-factory-v2` deployment (version `7517d420-0064-4456-bc2d-cdafffaf03e2`, 2026-09-16T17:10Z) was built from. Working tree clean at `faa5ab8` throughout; `git diff e20bfbde..HEAD -- src/ migrations/` shows only `src/site-gateway/gateway.ts` + #48 tests/fixtures, i.e. every pipeline/harness/prompt source is byte-identical to HEAD. #48 stable-address infrastructure is not on the benchmark execution path (no Approval/Publication; the gateway Worker `cf-site-gateway-v2` version `6f34cca5` is a separate deployment and was not exercised). |
| Execution vehicle | Frozen #17 harness semantics via the capability-gated operator benchmark-driver route on the production deployment: drift gate → immutable Onboarding Submission + Site Generation from the frozen definition → ONE production `WebsiteBuildWorkflow` instance (durable per-stage steps, production retry/sleep policy, real provider defaults — no mock mode, no provider override, no benchmark-specific relaxation). |
| Runtime duration | Run seeded 2026-09-16T22:08:21Z → workflow terminal 2026-09-16T22:21:39Z (≈13 m 18 s). Record phase completed 22:26:43Z. |

## PRE-RUN VALIDATION — ALL PASS

1. Issue scope: #19 OPEN; acceptance criteria mirror #18 (frozen inputs unchanged; production-equivalent traversal to terminal; no manual source edits; full evidence; PASS only on RELEASE_READY within USD 3; failure evidence actionable).
2. Frozen definition: `src/domain/benchmark/definitions.ts` bench-02 entry verified (Savanna & Tide Lodges, `.example` contacts only, `adaptationContract: null`, `promptModelSchema: CANONICAL_PROMPTS`).
3. Frozen assets unchanged since #18: `git diff 2471d31..HEAD -- benchmarks/ src/domain/benchmark/ src/simple-design/ src/workflows/ v2-docs/prompts/ migrations/` = only the additive #48 migration `0040_v2_site_addresses.sql`; in-repo screenshot sha256 `d45b5a88fbab92deaf39f12f6d62fbc030e641ba5979db522d68d18690a08f45` matches its pin file.
4. Live freeze verified the canonical R2 object + immutable `benchmark_cases` row → `frozenInputsVerified: true` at preflight; runtime identity: KIE `nano-banana-2-lite` @ `https://api.kie.ai`; Z.AI coding plan `glm-5.3` (builder) + `glm-5.3-flash` (blueprint/visual-QA) @ `https://api.z.ai/api/coding/paas/v4`; image hard gate USD 3.00 armed with the `image_attempts.cost_usd` ledger; evidence retention class `benchmark-run-evidence` (180 days); `priorRunsForCase: 0`.
5. Confidence gates before any spend: `npm test` 629/629 (52 files), `npm run typecheck` clean at `faa5ab8`; remote D1 had no pending migrations.
6. Input immutability: the run consumed an immutable Onboarding Submission created from the frozen definition payload (identical hash at all four harness touchpoints); `manualSourceEdits: 0` declared on `/run` and pinned on the run row.

Operator note (transport): capability tokens minted offline with `scripts/mint-operator-capability.mjs`; the mint script prints human-readable lines before the token, so piping the whole stdout into an Authorization header produces an invalid header and the route correctly fails closed 401 — two such malformed-token requests were rejected before the single-line token was used. Both the production deployment endpoint and (for the earlier probe) a `wrangler dev --remote` session reject invalid capability material; the canonical phases all ran against the production deployment.

## LIFECYCLE (workflow timeline, all times UTC)

| Stage | At | Detail |
|---|---|---|
| Run seeded / Onboarding Submission | 22:08:21 / 22:08:24 | immutable, frozen definition facts (Site Generation `f4ac1948-2623-4bb3-98a0-17656627d168`, Site `e2154fec-0fdb-4655-b072-fcb515879b1d`) |
| Build + Build Version v1 created | 22:08:24 | Build `0b1f8695-1aff-433a-8a1f-3bfe7efea52f`, version `d97188c1-5d4c-4a5d-8aab-f142bbde01d2` — the ONLY version (`repair_consumed = 0`) |
| Reference check → evidence frozen | 22:08:27 | suitability SUPPORTED, sufficiency SUFFICIENT, `SCREENSHOT_ONLY` |
| Design Blueprint | 22:08:27 → 22:10:40 | design-blueprint/2: 8 DNA rules, 14 materialized image slots (incl. 4 page heroes), 15 acceptance conditions |
| Image wave 1 | → 22:17:02 | 12/12 slots accepted (4 page heroes + 8 home supporting) |
| Image wave 2 | → 22:18:05 | 2/2 slots accepted (about-pair-coast, about-pair-landscape) |
| Builder (SITE_GENERATION) | → 22:20:17 | SIX_CALL_FILE_REALIZATION: home, about, services, contact, site-css, site-js |
| Assembly → Technical Preflight | 22:20:26 | immutable candidate manifest `c364d607af0a…`, 20 files, 0 routing fixes; **preflight passed 177/177 checks** |
| Preview | 22:20:44 | exact candidate deployed at `https://b-0b1f86951a-v1.wazibizwebsites.workers.dev` (HTTP 200 verified post-run) |
| QA evidence | 22:21:16 | 9 page/viewport captures (desktop/intermediate/mobile × 4 pages) |
| QA → RELEASE_READY | 22:21:38–22:21:39 | "First-pass success — no repair needed" |

## REFERENCE

Suitability **SUPPORTED**, evidence sufficiency SUFFICIENT, intake class
`SCREENSHOT_ONLY`, canonical screenshot checksum-pinned; no Adaptation
Contract (bench-02 has none by definition). Reference content/branding was not
copied (Truth QA 0 blockers; fabrication 0).

## QUALITY

| Measure | v1 (initial = final; no repair) |
|---|---|
| Visual QA overall | **95** (gate ≥ 90) |
| macroLayout / typography / spacingRhythm | 96 / 95 / 95 |
| surfaceColor / imageTreatment | 96 / 94 |
| components / signatureElements / responsive | 93 / 96 / 94 |
| Content QA | **95**, fabrication 0, Truth blockers 0 |
| Technical QA | **95**, QA-B blockers 0 |
| Deterministic Technical Preflight | **177/177 checks** |
| P0 / P1 findings | **0 / 0** (`releaseBlockers: []`, `nonBlockingPolish: []`) |

Hard gates — QA-A **6/6 passed**: FIRST_VIEWPORT_MATERIALLY_CORRECT,
PAGE_SILHOUETTE_REGION_ORDER, DOMINANT_TEXT_IMAGE_MASS,
CRITICAL_SIGNATURE_TRAITS_PRESERVED, MOBILE_PRESERVES_VISUAL_IDENTITY,
CRITICAL_IMAGERY_SERVES_ROLE. QA-B **15/15 passed**: ALL_PAGES_LOAD,
INTERNAL_NAVIGATION, MOBILE_MENU, RESPONSIVE_MECHANICS, NO_PAGE_OVERFLOW,
KEYBOARD_FOCUS_ACCESSIBILITY, FORM_SERVICE_CONTRACT, TURNSTILE_INTEGRATION,
RUNTIME_CONSOLE_NETWORK_CLEAN, IMAGE_MANIFEST_RESOLUTION, NO_PROVIDER_URLS,
METADATA_CANONICAL_OG, TRUTHFUL_JSON_LD, CRAWLABILITY,
IMPLEMENTATION_CONTRACT_INTEGRITY.

The three visual-QA findings recorded on the stage artifact are
polish-grade observations below any blocker class (hero button pair slightly
heavier than reference; savanna-band caption scrim marginally lighter; 2×2
card-base padding marginally tighter) — none escalated to P0/P1 and the
release record carries zero blockers and zero polish entries.

## COST

| Measure | Value |
|---|---|
| Image slots requested | 14 blueprint-decided (12 wave-1 + 2 wave-2), no expansion |
| Image attempts | 14 submitted / 14 succeeded / 0 failed (every slot accepted its first attempt) |
| Accepted images | **14** |
| Final image spend | **$0.70** (14 × $0.05, `SUM(image_attempts.cost_usd)`) |
| Budget status | **PASS** — $0.70 ≤ $3.00 hard gate |

## PROVENANCE (persisted on the run row from `ai_stage_runs`)

- Pipeline `simple_blueprint_v1`; image model `nano-banana-2-lite`
- `simple-design-blueprint` v5 · `glm-5.3-flash` · `design-blueprint/2` × 1 (outcome valid)
- `simple-website-builder` v8 · `glm-5.3` · six `builder-file/*` schema calls (home, about, services, contact, site-css, site-js — `SIX_CALL_FILE_REALIZATION`), all valid
- `simple-visual-qa` v2 · `glm-5.3-flash` · `simple-visual-qa/1` × 1 (valid)
- `simple-site-repair` v1 — **not invoked** (repair_consumed = 0)
- Prompt domain contract v1 throughout; no fallback models, no mock providers, no benchmark-specific providers.

## EVIDENCE / RETENTION

- Run-row evidence index (`evidence_keys_json`, 180-day class): v1 assembled manifest, six builder-file artifacts, design blueprint, QA evidence bundle, QA package, QA report, release record, site bundle. Spot-checked remotely: `qa_report.json` (verdict RELEASE_READY), `qa_evidence_bundle.json`, `evidence/qa/home-1440-1.png` (4.5 MB), `assets/images/about-hero-a1.webp` (66.8 KB).
- Preview `https://b-0b1f86951a-v1.wazibizwebsites.workers.dev/` served HTTP 200 post-run. Preview deployments are disposable pipeline artifacts — not a Publication; **no Approval/Publication was performed** (and none is required for PASS).

## COMPLIANCE WITH THE PASS RULE

RELEASE_READY: **YES** (first-pass, repair unconsumed) · spend ≤ $3.00:
**YES** ($0.70) · manual source edits: **0** → **Benchmark PASS**. No
thresholds, prompts, gates, repair policy, image policy, Builder, Blueprint,
QA or benchmark definitions were touched before, during or after the run; the
ONE-repair ceiling was available and legitimately unused.
