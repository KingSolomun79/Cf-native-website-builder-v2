# LEGACY CLEANUP INVENTORY — obsolete COMPLEX V2 design pipeline

Date: 2026-09-09 · Branch for execution: `cleanup/remove-legacy-design-pipeline` (created from verified main `7b63c54`, NOT implemented)
Baseline: SIMPLE main verified (`simple_blueprint_v1` default; prod `wrangler.jsonc:130`, exp `wrangler.exp.jsonc:91`).
Method: full import-graph extraction over `src/`, `tests/`, `scripts/` with type-only vs value-import verification (value imports put modules in the esbuild/Worker bundle; `import type` is erased), plus routes/workflows/prompts/tests classification. Nothing classified by filename alone.

## 0. Dispatch topology (why deletion is order-sensitive)

`WebsiteBuildWorkflow` → `runBuildPipeline` (`src/domain/build-pipeline.ts:374`) branches on `resolveDesignPipelineVersion(env)`; SIMPLE goes to `src/simple-design/pipeline.ts`, everything below ~line 394 in build-pipeline.ts is the legacy_v2 chain. **No route is legacy-design-only** — both pipelines share the same routes/workflow. The legacy chain is reachable only when the var is flipped; today only `wrangler.test.jsonc:40` still pins `legacy_v2`.

## 1. Files that SOUND legacy but are in the SIMPLE runtime bundle (do NOT delete before the named seam is cut)

| File | Leak path into SIMPLE bundle | Seam to cut first |
|---|---|---|
| `src/domain/visual-blueprint.ts` (803) | `stage-failure.ts:44` value-imports `VisualBlueprintError`; stage-failure is imported by SIMPLE pipeline | stop classifying/exporting that error |
| `src/domain/reference-geometry.ts` (484) | `visual-blueprint.ts:27` value-imports `resolveReferenceGeometry` | falls out with visual-blueprint |
| `src/domain/site-generator.ts` (1809) | `stage-failure.ts:43` value-imports `SiteGenerationValidationError`; **`src/simple-design/bundle-qa.ts:10` value-imports `factVocabulary`, `lintTrustContexts`, `UNSUPPORTED_FACT_PATTERNS`** (the zero-tolerance truth lint — genuinely shared); `contracts.ts:26` type-imports `ImageSlot` | extract truth-lint helpers + `ImageSlot`/`PageId` into a shared module (e.g. `src/domain/fact-lint.ts`), re-point SIMPLE imports, then delete the legacy half |
| `src/domain/reference-analysis.ts` (349) | `site-generator.ts:29` value-imports `createProductionVisionGenerate` (used only inside legacy `generateCompleteSite`) | move/invoke the vision seam from a non-legacy path |
| `src/domain/assembly-repair.ts` (212) | value-imported by site-generator (legacy realization-repair) | falls out with site-generator split |
| `src/domain/content-fingerprint.ts` (292) | value-imported by site-generator | falls out with site-generator split |

## 2. Clean DELETE candidates (no SIMPLE/shared importer — verified)

| Path | LOC | Evidence |
|---|---|---|
| `src/domain/automated-repair.ts` | 534 | Fix Coordinator + Release Blocker Fix; imported only by legacy build-pipeline branch + 3 legacy tests. SIMPLE's ONE repair lives in `simple-design/pipeline.ts` |
| `src/domain/craft-preflight.ts` | 515 | Craft Preflight framework; legacy-only (plus `CraftCapture` type in qa-capture:18 to remove) |
| `src/domain/benchmark-runner.ts` | 358 | drives legacy stage chain; tests-only |
| `src/domain/implementation-planner.ts` | 343 | separate Implementation Contract LLM stage; zero value imports from SIMPLE closure |
| `src/domain/repair-guard.ts` | 217 | Fix Coordinator prompt guard; legacy-only |
| `src/lib/kie.ts` | 79 | superseded by `lib/kie-v2.ts`; zero importers anywhere |
| `src/lib/image-provider.ts` | 4 | zero importers |
| `src/lib/html.ts` | 78 | zero importers (V1 relic) |
| `src/lib/seo.ts` | 156 | zero importers (V1 relic) |
| `src/lib/slug.ts` | 17 | zero importers (V1 relic) |
| `tests/helpers/blueprint-fixtures.ts` | 111 | dead: imports nonexistent `src/lib/blueprint-schema-v2` |
| Empty V1 dirs: `src/agents/`, `src/builders/`, `src/email-router/`, `src/qa/checks/`, `src/render/icons/`, `src/render/primitives/` | 0 | empty, no importers |

Subtotal clean src DELETE: ≈2,116 LOC (excluding the UNCERTAIN cluster in §4).

## 3. Partial-file deletions (module is shared; the legacy half goes)

| Path | Remove | Keep |
|---|---|---|
| `src/domain/build-pipeline.ts` (1659) | legacy branch ≈1,265 LOC (lines ~394–1659, incl. legacy Fix Coordinator wiring) | the SIMPLE dispatch at :374 + shared stage plumbing |
| `src/domain/site-generator.ts` (1809) | legacy half ≈850 LOC (`generateCompleteSite`, realization-repair, prompt builders) | truth-lint helpers (moved out per §1) — or move them and delete the file |
| `src/domain/qa-stages.ts` (416) | legacy `runQaAStage`/`runQaBStage` + prompt builders ≈165 LOC | `evaluateQaARelease`/`evaluateQaBRelease`, gate-ID constants, `QaAReport`/`QaBReport` — SIMPLE release verdict depends on them |
| `src/domain/qa-evidence.ts` (397) | `compareGeometry`/`evaluateReferenceMacroFidelity` if unreferenced after refactor | `buildStandardEvidenceBundle`, `geometryFromRegions` (used by qa-capture) |
| `src/domain/qa-capture.ts` | `createCraftCapture` export | `createProductionQaCapture` (SIMPLE QA captures) |
| `src/domain/prompt-contract.ts` (189) | 12 legacy `PromptStageKey` entries + manifest rows | 4 SIMPLE stages + shared stages |
| `src/domain/stage-artifacts.ts` | — narrow kind union ONLY with a new D1 rebuild migration | kind union must stay a superset of applied `build_stage_artifacts` CHECK until then |

## 4. UNCERTAIN — operator decision required (NOT part of the COMPLEX-chain deletion by default)

| Cluster | Why uncertain |
|---|---|
| `src/domain/original-design.ts` (162) + prompts `03-original-design-blueprint-generator-v2.md` + `v2-original-design.test.ts` | ORIGINAL_DESIGN is a distinct V2 Build Mode (issue #24), currently production-unreachable (router returns HUMAN_REVIEW_REQUIRED) and built ON the legacy blueprint machinery. Deleting it is a product decision, not a legacy-hygiene step |
| `src/domain/benchmark.ts` (498) + `src/domain/proof-gate.ts` (153) + `src/lib/png.ts` (60) + migrations 0028/0029 tables | `proof-gate` is dynamically imported by `lifecycle.ts:299` and `revision.ts:291` — live code path gating ORIGINAL_DESIGN builds. Delete only together with the ORIGINAL_DESIGN-mode decision |
| `src/routes/v2.exp-benchmark-driver.ts` (1480) | SIMPLE-only (imports zero legacy modules) but EXP-gated benchmark tooling; candidate for removal after benchmarking formally ends — separate decision |
| `wrangler.test.jsonc:40` `legacy_v2` pin + mixed workflow tests (`v2-final-verification`, `v2-workflow-granularity/retry-liveness`, `v2-do-reset-resilience`, `v2-cross-issue-regression`, `v2-deterministic-stage-failures`, `v2-region-semantics`, `v2-coordinate-space`) | must be re-pointed/re-scoped to SIMPLE in the same change as the deletions, not silently flipped |

## 5. Prompts (legacy-only ≈95% of embedded bodies)

- `v2-docs/prompts/01..12*.md` (12 files, 401,356 bytes) — legacy stage bodies → DELETE, then regenerate `src/domain/generated/prompt-bodies.ts` via `scripts/generate-prompt-bodies.mjs` (NEVER hand-edit the generated file) and prune `PROMPT_MANIFEST`/`PromptStageKey` (`requireBody` throws on dangling manifest entries at runtime).
- KEEP: `00-domain-contract-v1.md` (5,682 B, prepended to every stage) + `simple/01..04` (18.6 KB, the SIMPLE pipeline).
- `05-kie-image-prompt-generator-v1.md` is legacy-only at runtime (SIMPLE always supplies `promptRecords`, skipping that LLM stage).
- `10-qa-b-confirmation-v2.md` is legacy-only despite its name (only `automated-repair.ts:383`).
- Update `v2-docs/prompts/PROMPT-MANIFEST.md` (still labels SIMPLE "Experiment branch only" — doc drift).

## 6. Tests/fixtures (legacy-only ≈12,071 test LOC, ≈962 helper LOC, ≈420 KB fixtures)

DELETE (legacy-only, verified importers): `v2-site-generator` (796), `v2-realization-binding` (682), `v2-automated-repair` (610), `v2-content-guard` (565), `v2-craft-preflight` (508), `v2-blueprint-stages` (492), `v2-release-qa` (468 — verify qa-stages pruning keeps shared parts covered elsewhere), `v2-build-pipeline-retry` (456), `v2-blueprint-repair-convergence` (456), `v2-workflow-retry-liveness` (783), `v2-trait-obligations` (373), `v2-reference-geometry` (387), `v2-coordinate-space` (371), `v2-repair-guard` (379), `v2-assembly-repair-guard` (369), `v2-blueprint-coverage` (363), `v2-qa-sweep` (362), `v2-region-semantics` (257), `v2-effective-candidate` (254), `v2-deterministic-stage-failures` (310), `v2-do-reset-resilience` (216), `v2-build-pipeline` (196), `v2-cross-issue-regression` (185), `v2-workflow-granularity` (201), `v2-benchmark-harness` (187), `v2-benchmark-site-1..5` (748), `v2-macro-fidelity` (162), `v2-vision-seam` (170), `v2-generator-visual-context` (122), `v2-final-verification` (254), `v2-original-design` (389, per §4 decision), `v2-proof-gate` (166, per §4 decision).
Helpers: `pipeline-scripts.ts` (442), `benchmark-golden.ts` (400), `effective-candidate-helpers.ts` (9), `blueprint-fixtures.ts` (111, already dead).
Generated stubs + fixtures: `_generated-{craft-repair,realization,rankforge-frozen,fresh-capture,assembly-regression}-*` and `tests/fixtures/{craft-repair-2026-09-07, blueprint-convergence-2026-09-06, assembly-regression-2026-09-07, fresh-capture-2026-09-07, realization-negative-rankforge-v3, rankforge-frozen-*}` (keep `tests/fixtures/simple/`).
KEEP (shared): `v2-truth-lint`, `v2-retention`, `v2-release-qa` (partial), all SIMPLE tests (9 files), all shared-infra tests (form-service, operator-capability, lifecycle, revision, publication, retention, single-flight, reconciliation, static-deploy, image-pipeline/orchestration, assembly-preview, reference-intake/capture/sufficiency, rankforge-regression, visual-evidence, llm-model-routing, cpu-budget, prompt-contract (pruned), vision-input, browser-*, preview-readiness).

## 7. Migrations — KEEP MIGRATION HISTORY (nothing deleted, nothing rewritten)

Applied migrations stay. Couplings to note: 0021/0032/0034/0035 `build_stage_artifacts` kind CHECK embeds legacy kinds (code union must stay a superset until a NEW rebuild migration); 0026 `repair_batches` written by legacy repair but read by shared `retention.ts:354` (dead read after cleanup — harmless, note it); 0016 `candidate_validation_runs`, 0028 `benchmark_*`, 0029 `proof_gate_evaluations` legacy-writers only; 0003 `prompt_versions` and 0010 `blueprints` have zero src references (history-only).

## 8. KEEP — shared production systems (verified load-bearing for SIMPLE runtime; not exhaustive per AGENTS.md keep-list)

Business Facts/revision lifecycle, truth lint (moving to shared home), Reference Capture/intake/sufficiency, browser capture stack, D1/R2/Workflows/single-flight/retry containment/DO-reset resilience, KIE durable lifecycle + `lib/kie-v2.ts` (Nano Banana) + `lib/aspect-ratio.ts`, Accepted Images, technical preflight, QA evidence/capture/release gates, form service + email, operator capability + approval/publication/rollback/retention, preview deploy (`lib/publish.ts`), workflow reconciliation, prompt transport (`ai-boundary`/`ai-gateway`/`ai-streaming`), `src/exp-compat-website-agent.ts` (inert DO stub — Cloudflare rejects deploys dropping the class export, error 10064).

## 9. Estimated removable total (if §4 decided affirmatively)

src ≈5,200 LOC (2,116 clean + ~1,265 build-pipeline branch + ~850 site-generator half + ~800 visual-blueprint/reference-geometry + ~250 shared-module pruning + ~150 misc) · prompts ≈443.5 KB (95%) · tests ≈12,071 LOC + helpers 962 LOC + fixtures ≈420 KB. Post-cleanup design path reads exactly: Reference Capture → Design Blueprint → Images → Website Builder → Technical/Truth/Visual QA → ONE Repair → Release Ready → Approval → Publish.

## 10. Required execution order (for the cleanup branch, when separately authorized)

1. Cleanly orphaned files (§2) · 2. Cut `stage-failure.ts` error seams · 3. Extract truth-lint/`ImageSlot` to shared module; re-point `bundle-qa`/`contracts` · 4. Delete visual-blueprint/reference-geometry/assembly-repair/content-fingerprint + site-generator legacy half · 5. Shrink build-pipeline to the SIMPLE dispatch · 6. Delete legacy prompts + regenerate prompt-bodies + prune manifest · 7. Prune qa-stages/qa-evidence/qa-capture legacy exports · 8. Delete legacy tests/helpers/fixtures; re-point wrangler.test.jsonc + mixed tests · 9. Update PRD/README/PROMPT-MANIFEST/FINAL-DECISION-RECORD (record SIMPLE-canonical decision) · 10. Dead-code sweep. Full gate suite after each destructive step (focused SIMPLE → full suite → typecheck → dry-run).
