# SIMPLIFIED DESIGN PIPELINE EXPERIMENT — Implementation Report

Branch: `experiment/simplified-design-pipeline` (based on `main` @ `89df4c0`)
Spec: the operator's "WAZIBIZ V2 — Simplified Design Pipeline Experiment" brief (sections 1–75).
Status: **IMPLEMENTED, all automated gates green. Live benchmark runs (spec sections 61–65) NOT yet executed** — they require live provider spend and the pre-benchmark `/morabeza-cso` pass (spec section 71). Everything below reports what exists and what is proven by tests; live-result fields are marked `PENDING OPERATOR BENCHMARK RUN`.

---

## 1. What was built

A complete, isolated SIMPLE design pipeline under `src/simple-design/` selected by an internal env var — no legacy stage was modified beyond two additive seams, and no legacy prompt was touched.

```text
src/simple-design/
  contracts.ts        design-blueprint/1 + site-bundle/1 + visual-qa + qa-package/1
                      schemas (TypeBox), deterministic blueprint quality gate,
                      blueprint→KIE slot/prompt bridge (zero LLM calls)
  pipeline.ts         runSimpleBuildPipeline: capture → blueprint → images → build
                      → QA → ONE repair → final QA → RELEASE_READY | HUMAN_REVIEW
  design-blueprint.ts ONE multimodal schema-validated call + deterministic gate
                      + frozen design_blueprint artifact + DESIGN-BLUEPRINT.md
  render-blueprint.ts deterministic Finch-style markdown renderer
  website-builder.ts  ONE builder stage (one-call, two-call single-stage fallback)
  visual-qa.ts        ONE multimodal comparative QA call (max 5 ranked findings)
  qa-package.ts       combined QA object + release finalization through the
                      EXISTING assignReleaseReady gate machinery
  bundle-qa.ts        deterministic truth lint (reuses issue-#48 scanners) +
                      technical checks backing every canonical QA-B gate
  release-mapping.ts  honest SIMPLE → QA-A/QA-B report mapping (no gate without
                      a named deterministic check behind it)
  site-repair.ts      the ONE repair (max one call; new immutable Build Version)
  vision.ts           multimodal RawAiGenerate adapter (vision gateway)
```

New prompt bodies (registered in the canonical manifest, composed with the domain contract):

```text
v2-docs/prompts/simple/01-design-blueprint.md   simple-design-blueprint/v1
v2-docs/prompts/simple/02-website-builder.md    simple-website-builder/v1
v2-docs/prompts/simple/03-visual-qa.md          simple-visual-qa/v1
v2-docs/prompts/simple/04-site-repair.md        simple-site-repair/v1
```

## 2. Selector (spec section 4)

`DESIGN_PIPELINE_VERSION` env var (`legacy_v2` | `simple_blueprint_v1`), read at the single fork point in `runBuildPipeline` (`src/domain/build-pipeline.ts`). `wrangler.jsonc` defaults the branch to `simple_blueprint_v1`; `wrangler.test.jsonc` pins `legacy_v2` so all ~60 pre-existing suites keep testing the legacy chain, and SIMPLE suites opt in per-test. Not exposed in onboarding; Build Mode stays `REFERENCE_BOUND` only.

## 3. KEEP list honored (spec section 2)

Reused unchanged: reference intake/capture, Business Facts + effective-facts lineage, stage-artifact immutability, durable KIE machinery incl. USD 3.00 gate and attempt bounds (with one additive `promptRecords` seam so the blueprint itself is the prompt authority — legacy default unchanged), accepted-image identity + repair reuse, deterministic assembly + Technical Preflight, preview deployer, standardized QA evidence, Release Ready/Approval/Publication/Rollback (through the honest report mapping), retry containment, #70 transient reset handling, lifecycle states (no new states — SIMPLE stage names live in workflow events), model policy (glm-5.3-flash, thinking disabled, provenance in `ai_stage_runs`).

Legacy design stages NOT called by SIMPLE (proven by test): reference analysis, visual blueprint + trait obligations, implementation contract, per-page generation, assembly LLM repair, craft preflight, realization repair, fix coordinator/release-blocker-fix, kie-image-prompt-generator, QA-A/QA-B LLM stages.

## 4. Migration (branch-only, spec sections 58/74)

`migrations/0035_v2_simple_design_experiment.sql` — 0032/0034 table-rebuild pattern adding exactly three artifact kinds: `design_blueprint`, `site_bundle`, `qa_package`, with a uniquely-named sentinel index. DO NOT apply to production D1; documented in the file header.

## 5. Finch known-good fixture (spec sections 11/61)

`tests/fixtures/simple/finch-hattons-design-blueprint.json` — a `design-blueprint/1` document with the Finch document's qualities (7 DNA rules, 4 page specs, 5 signature elements, 8 image slots with KIE prompts, 15 acceptance conditions, clamp() type scale). Format/quality fixture only; business content never enters runtime assumptions.

## 6. Verification (spec sections 70/72/73)

- `tsc --noEmit`: clean.
- Full suite: **64 files / 533 tests passed** (including the 39 new SIMPLE tests).
- `wrangler deploy --dry-run`: clean (branch var bound; NOT deployed).
- New suites:
  - `tests/v2-simple-blueprint.test.ts` — schema + quality gate + deterministic markdown + KIE bridge + selector + prompt registration (legacy manifest untouched).
  - `tests/v2-simple-bundle-qa.test.ts` — zero-tolerance truth lint, technical checklist, gate honesty, release mapping through the legacy evaluators.
  - `tests/v2-simple-pipeline.test.ts` — end-to-end through the real `runBuildPipeline` seam with scripted providers: first-pass RELEASE_READY (no repair), ONE repair → new immutable v2 → RELEASE_READY, failed final QA → HUMAN_REVIEW_REQUIRED, blueprint gate → HUMAN_REVIEW_REQUIRED with zero KIE spend, preview-only (no auto-publication), no legacy AI-stage invocation, `legacy_v2` still routes legacy.
  - `tests/v2-simple-finch-fixture.test.ts` — known-good blueprint → builder → valid, truth-clean bundle that assembles through the shared assembly path with real accepted-image bytes.

## 7. Metrics (spec section 69)

| Metric | SIMPLE | Legacy design chain (bypassed) |
|---|---|---|
| Production LOC | 2,566 (`src/simple-design/`) | 5,773 (11 bypassed domain modules, excluding orchestration) |
| Orchestration LOC | 731 (`pipeline.ts`) | ~1,660 (`build-pipeline.ts`) |
| Stages | 7 (capture, blueprint, images, build, QA, repair, final QA) | 12+ |
| Prompts | 4 bodies (122 lines) | 12 bodies (18,414 lines incl. shared contract) |
| New artifact contracts | 3 (`design-blueprint/1`, `site-bundle/1`, `qa-package/1`) | 12 kinds |
| Semantic repair loops | 1 max | assembly + realization + fix-coordinator + release-blocker-fix |
| Design-specific validators | 2 (blueprint gate, bundle QA) | trait obligations, coverage contract, geometry mapping, craft preflight, QA-A hard gates, regression guard |

Model-call budget (spec section 9): blueprint 1 + builder 1 (2 if the allowed transport fallback fires) + visual QA 1 (+1 after repair) + repair 1 = **max 5 major semantic design calls with repair, 3 without** — on target.

## 8. Required report

```text
SIMPLIFIED DESIGN PIPELINE EXPERIMENT

Branch:                         experiment/simplified-design-pipeline
Base SHA:                       89df4c0cecfc9e2fba90a1fa4f0bf2e211dc9931
Experiment HEAD:                (this commit)
SIMPLE implementation:          COMPLETE (see §1)
Legacy implementation:          UNCHANGED (2 additive seams: pipeline fork, image promptRecords)
Design Blueprint artifact:      design-blueprint/1 (+ deterministic DESIGN-BLUEPRINT.md)
Finch known-good Builder test:  AUTOMATED PARTS PASS (builder → valid truth-clean assemblable bundle);
                                live model run PENDING OPERATOR BENCHMARK RUN
Morabeza generated Blueprint:   PENDING OPERATOR BENCHMARK RUN (Test 2)
Morabeza Blueprint human quality: PENDING
Design DNA:                     schema-enforced 5–8, falsifiable
Signature Elements:             schema-enforced 3–5
Website Builder strategy:       ONE CALL preferred; TWO-CALL SINGLE-STAGE fallback
                                implemented (spec section 35); live preference PENDING
Builder output:                 site-bundle/1 → shared assembly/Technical Preflight/preview
Accepted Images:                via existing durable KIE machinery; blueprint slots only,
                                no 12-target forcing; USD 3.00 gate unchanged
Major semantic call count:      ≤5 with repair, 3 without (by construction; live counts PENDING)
KIE tasks / spend:              PENDING (gate enforced unchanged)
Technical QA:                   deterministic (bundle-qa.ts + Technical Preflight)
Truth QA:                       deterministic, zero tolerance (issue-#48 scanners reused)
Visual QA 1 / 2:                ONE multimodal call per evaluation, 9 scores, ≤5 ranked findings
Repair:                         USED / NOT USED per run — PENDING
Final desktop / mobile:         PENDING (standard 9-capture evidence reused)
Human Fidelity:                 PENDING
Legacy comparison:              PENDING (flip DESIGN_PIPELINE_VERSION=legacy_v2)
SIMPLE source LOC:              2,566
SIMPLE stage count:             7
SIMPLE prompt count:            4
SIMPLE semantic repair loops:   1 maximum
Legacy design-stage count:      12+ (untouched, runnable for A/B)
Legacy prompt count:            12
Manual source edits:            0 (pipeline-automated)
Release Ready:                  proven in tests; live PENDING
Approval:                       NOT PERFORMED
Publication:                    NOT PERFORMED
Production resources touched:   NO (branch-only migration 0035; do not apply remotely)
V1:                             UNCHANGED
Recommendation:                 PENDING BENCHMARK — implementation supports
                                MERGE_SIMPLIFIED_DIRECTION / ITERATE_SIMPLIFIED_ONCE /
                                KEEP_LEGACY_V2 decisioning once Tests 1–3 run
```

## 9. How to run the live benchmarks (operator)

1. Run `/morabeza-cso` on this branch (spec section 71) — no new routes, no auth changes, no secret surface changes were added; SIMPLE reuses the existing release/security boundaries and cannot publish without Approval (test-enforced).
2. Apply `migrations/0035_v2_simple_design_experiment.sql` ONLY to an explicitly experimental D1 (e.g. `website_factory_v2_simple_exp`); never to production. Deploy only to an experiment Worker (spec section 74) — never `cf-website-factory-v2`.
3. Test 1 (Finch known-good): feed `tests/fixtures/simple/finch-hattons-design-blueprint.json` + synthetic facts to the builder stage via a local/seam harness; judge with the new Visual QA.
4. Test 2 (Morabeza → RankForge): `scripts/smoke-site.mjs` with `tests/fixtures/rankforge-reference-bound.json` against the experiment Worker (it drives the same Build pipeline; SIMPLE runs inside it). STOP after Reference Capture + Design Blueprint and inspect `DESIGN-BLUEPRINT.md` (spec section 62) before continuing.
5. Test 3: full RankForge build; record model calls (per-stage counts in `ai_stage_runs`), KIE spend, duration; flip `DESIGN_PIPELINE_VERSION=legacy_v2` for the A/B leg.
6. Fill section 8's PENDING fields; then STOP for operator review (spec section 75). No merge, no legacy deletion.

## 10. What would be deleted from legacy if SIMPLE wins

Exactly the spec's list: Reference Analysis, Visual Blueprint + trait obligations, canonical region authority, Implementation Contract stage, assembly LLM repair, Craft Preflight repair framework, realization repair, Fix Coordinator/Release Blocker Fix, their prompts, artifact kinds and tests — while preserving capture, KIE, truth/technical QA, release/approval/publication/rollback, Workflow durability. That cleanup happens only after operator approval.
