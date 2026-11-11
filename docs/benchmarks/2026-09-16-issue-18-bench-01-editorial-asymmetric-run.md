# #18 — Benchmark Site 1 Run Evidence: bench-01-editorial-asymmetric (Kiln & Quill Studio)

Date: 2026-09-16 · Ticket: #18 (Validate Benchmark Site 1 end-to-end) · Result: **VALID BENCHMARK FAIL**

## FINAL VERDICT

**#18 COMPLETE — VALID FAIL.** The canonical run reached the genuine terminal
state **HUMAN_REVIEW_REQUIRED**: the provider-generated candidate never met the
Release Ready bar (Visual QA fidelity 88 → 87 across the ONE repair, against a
90 gate; a hard mobile composition gate failed post-repair). Truth QA and
Technical QA were clean; all 10 blueprint images were accepted for $0.50 of the
$3.00 hard gate; zero manual source edits. Per the PASS rule
(`evaluateBenchmarkPass`), any terminal other than RELEASE_READY is FAIL. The
failure evidence is actionable and the frozen target is untouched.

## IDENTITY

| Field | Value |
|---|---|
| Benchmark run ID | `e5e06c81-6ae0-4fb5-bf2b-3ac2fc35ce56` (append-only `benchmark_runs` row) |
| Benchmark case | `bench-01-editorial-asymmetric` — Kiln & Quill Studio, slot 1, archetype `asymmetric/editorial` |
| Definition version / hash | `1` / `1e1a6381f228aaa162d4b8c1e32a7974d22e6720b25e474329069a197f8f06cc` (identical at freeze, preflight and record) |
| Code SHA executing the run | `41346a59c1b8bfd964a171a5bd3f41944cb13394` (working tree clean; pipeline/harness sources byte-identical to #17's `2471d31` — verified by `git diff 2471d31..HEAD -- src/domain src/simple-design src/lib src/workflows migrations` = auth-primitive addition only) |
| Production deployment used for the record phase | `cf-website-factory-v2` version `93ff94d2-9906-4f79-a2c4-0e87a25991ff` at that SHA (deployed 2026-09-16, clean tree) |
| Execution vehicle | Frozen #17 harness semantics: drift gate → immutable Onboarding Submission → Site Generation → ONE production `WebsiteBuildWorkflow` instance (durable per-stage steps, production retry/sleep policy) → terminal → outcome reconstructed from the durable workflow result and persisted via the **unchanged** `recordBenchmarkRun`. Provider seams: none — production defaults only. |

## PRE-RUN VALIDATION (GO §2) — ALL PASS

Frozen definition hash matched at freeze/preflight/record; embedded screenshot
bytes, canonical R2 object (`benchmarks/bench-01-editorial-asymmetric/reference/screenshot.png`,
30,790 bytes, sha256 `ae8615f6…464208`) and the immutable `benchmark_cases` row
all verified (`verifyBenchmarkCaseInputs` → `frozenInputsVerified: true`).
Replacement Business Facts matched the row exactly (`.example` contacts only).
Build Mode `REFERENCE_BOUND`; no manual-edit flag (`manualSourceEdits: 0`,
operator attestation). Runtime identity recorded: KIE `nano-banana-2-lite` @
`https://api.kie.ai`; Z.AI coding plan `glm-5.3` (builder/repair) +
`glm-5.3-flash` (blueprint/visual-QA) @ `https://api.z.ai/api/coding/paas/v4`;
prompt/model schema identity equals `CANONICAL_PROMPTS` (pipeline
`simple_blueprint_v1`, blueprint v5, builder v8, visual-QA v2, repair v1,
`design-blueprint/2`). KIE cost accounting active (`image_attempts.cost_usd`
ledger, $0.05/task); image hard gate USD 3.00 armed; evidence retention class
`benchmark-run-evidence` (180 days).

## LIFECYCLE

| Stage | Value |
|---|---|
| Onboarding Submission | immutable, frozen definition facts (payload inside Site Generation `073b6c85-21a3-4411-aac9-18ddec52fd5d`) |
| Site Generation / Site | `073b6c85-21a3-4411-aac9-18ddec52fd5d` / `00cf5606-e9fd-4677-9298-95e1ec5d2f94` |
| Workflow instance | `31f22490-fa0e-477d-8a7f-f86a0d10b283` |
| Build | `c51c8236-3c1e-4a9b-91ed-7be946341473` |
| Build Versions | v1 `fcde3781-494c-4570-9cfa-ed003c00d661` (initial) → v2 `f8f4d37d-7a79-49fe-bd0f-512d27d1ee5d` (the ONE post-QA repair) |
| Repair consumed | **YES** — invoked once after v1 QA (visual 88 < 90, 1 P1); repaired version re-assembled, re-preflighted (147/147), re-deployed, re-captured, re-judged |
| Final terminal | `HUMAN_REVIEW_REQUIRED` (2026-09-16T12:54:44Z; seeded 12:31:00Z — ≈24 min wall clock) |

## REFERENCE

Suitability **SUPPORTED**, evidence sufficiency SUFFICIENT, intake class
`SCREENSHOT_ONLY`; frozen screenshot + evidence identity checksum-pinned
(sha256 `ae8615f6…464208`). Reference content/branding was not copied (Truth QA
0 blockers). No Adaptation Contract (bench-01 has none by definition).

## QUALITY

| Measure | v1 (initial) | v2 (final, post-repair) |
|---|---|---|
| Visual QA overall | 88 (< 90 gate) | **87** (< 90 gate) |
| macroLayout / typography / spacingRhythm | 88 / 90 / 88 | 88 / 90 / 86 |
| surfaceColor / imageTreatment | 92 / 85 | 92 / 88 |
| components / signatureElements / responsive | 88 / 90 / 86 | 86 / 88 / 84 |
| P0 / P1 findings | 0 / 1 | 0 / 2 |
| Hard composition gates | passed | **FAILED: `MOBILE_PRESERVES_VISUAL_IDENTITY`** |
| Truth QA (deterministic) | PASS — 0 blockers | PASS — 0 blockers |
| Technical QA (deterministic) | PASS — 0 blockers | PASS — 0 blockers |
| Deterministic Technical Preflight | 147/147 checks | 147/147 checks |

Final blockers (verbatim from `build_release_records`/QA package, persisted on
the run row's `root_cause`): `visual fidelity 87 < 90 | 2 P1 finding(s) | hard
composition gate(s) failed: MOBILE_PRESERVES_VISUAL_IDENTITY`. The two P1
findings (visual QA, rank 1–2): "Capability band columns cramped and
misaligned" (the three practice columns render too narrow with wrapping text
appearing to collide, against the reference's evenly spaced separated columns)
and "Course invite band text too narrow on desktop" (headline wrap far from the
reference's ~55% column). The repair measurably improved `imageTreatment`
(85→88) but regressed `spacingRhythm` (88→86), `components` (88→86),
`responsive` (86→84) and introduced the mobile identity hard-gate failure — net
one point worse. The Build correctly refused Release and escalated to human
review.

## COST

| Measure | Value |
|---|---|
| Image slots requested | 10 (4 wave-1 heroes + 6 wave-2 supporting; blueprint-decided, no expansion) |
| Image attempts | 10 submitted / 10 succeeded / 0 failed |
| Accepted images | 10 (6/6 wave 1, 4/4 wave 2) |
| Final image spend | **$0.50** (10 × $0.05, `SUM(image_attempts.cost_usd)`) |
| Budget status | **PASS** — $0.50 ≤ $3.00 hard gate |

## PROVENANCE (persisted on the run row from `ai_stage_runs`)

- `simple-design-blueprint` v5 · `glm-5.3-flash` · `design-blueprint/2` × 1
- `simple-website-builder` v8 · `glm-5.3` · six `builder-file/*` schema calls (home, about, services, contact, site-css, site-js — `SIX_CALL_FILE_REALIZATION`)
- `simple-visual-qa` v2 · `glm-5.3-flash` · `simple-visual-qa/1` × 2 (initial + post-repair)
- `simple-site-repair` v1 · `glm-5.3` · `site-repair-files/1` × 1
- Pipeline `simple_blueprint_v1`; image model `nano-banana-2-lite`. No fallback models, no mock providers, no benchmark-specific providers.

## EVIDENCE / RETENTION

- Preview (live at evidence time, HTTP 200): `https://b-c51c82363c-v2.wazibizwebsites.workers.dev/` (v1 candidate preview: `…-v1.wazibizwebsites.workers.dev`). Preview deployments are disposable pipeline artifacts — not a Publication; no Approval/Publication was performed.
- Standardized QA evidence retained per canonical pipeline: 9 page/viewport captures per version (desktop/intermediate/mobile across the four pages), e.g. final desktop home capture `builds/c51c8236…/v2/evidence/qa/home-1440-1.png` (1.7 MB, existence verified remotely).
- Run-row evidence index (`evidence_keys_json`, 180-day class): v2 assembled manifest, design blueprint, QA evidence bundle, QA package, QA report, site bundle + v1 reference evidence package. Spot-checked keys exist in the real bucket.
- Watch item for #23/retention: the 9 QA capture PNGs per version are referenced inside `qa_evidence_bundle.json` and stored under `…/evidence/qa/*.png`, but are not individual rows in `build_stage_artifacts`, so `indexBenchmarkEvidenceKeys` does not index them individually for the 180-day class.

## INVALID ATTEMPTS (GO §8 — held, unrecorded as results, retained as history)

1. **Direct-seam abort (build `3924700c-c2e5-497c-8559-a597ae4d7057`, no `benchmark_runs` row).** The first execution attempt drove `startBenchmarkRun` in one in-request invocation (`wrangler dev --remote`). It aborted during the builder stage: a Z.AI 429 (rate limit) is a TRANSIENT_RETRYABLE failure the pipeline rethrows for its engine — the in-request seam has no engine, so the invocation died; additionally the seam's no-op `sleep` default collapsed the KIE 15-minute provider-wait bounds (wave-2 slots burned their poll budgets in seconds). Classification: execution-transport abort, not a site-quality verdict. Wasted provider spend: $1.10 (22 KIE tasks) + partial builder calls. Fix (commit `41346a5`): the driver now seeds ONE production `WebsiteBuildWorkflow` instance — the same durable engine, retry policy and `step.sleep` waits every client Site Generation gets.
2. **A measurement defect, corrected before it mislead anything.** Interim `wrangler r2 object get` probes without `--remote` defaulted to the LOCAL simulator and suggested the run's R2 evidence had not persisted. Re-probing with `--remote` proved all run objects exist in the real bucket (frozen screenshot 30,790 bytes; QA package; accepted images). No rerun was triggered on the basis of the bad probe; the canonical run above was already recorded when the discrepancy was investigated.

`npm run db:migrations` note: migrations `0038_pre_qa_repair_plan.sql` (#14) and `0039_benchmark_run_identity.sql` (#17) were pending on remote V2 D1 and were applied before the record phase (additive; `d1 migrations apply DB --remote`, executed 9 commands).

## COMPLIANCE WITH THE PASS RULE

RELEASE_READY: **NO** (HUMAN_REVIEW_REQUIRED) · spend ≤ $3.00: **YES** ($0.50) ·
manual source edits: **0** → **Benchmark FAIL** (terminal criterion). One
bounded repair was consumed per the ONE-repair rule; no second repair; no
thresholds, prompts, gates or targets were touched before, during or after the
run. The failure remains actionable for aggregate analysis across #18–#22:
two visual-craft P1s (cramped multi-column band; too-narrow CTA band) plus a
mobile identity hard-gate failure that appeared after the repair.
