# CSO — SIMPLE Design Pipeline Experiment Branch

- **Date:** 2026-09-08
- **Scope:** `experiment/simplified-design-pipeline` (HEAD `63729ab`, base `89df4c0`)
- **Trigger:** Pre-benchmark security gate (experiment spec Phase 0) — required before any live model/provider execution.
- **Method:** Full-diff review (`git diff 89df4c0..63729ab`, 38 files, +4,661/−13) with targeted verification of each gate in the experiment spec Phase 0 checklist.

## 1. What was audited

The SIMPLE design pipeline implementation: new `src/simple-design/` modules (11 files), the fork in `src/domain/build-pipeline.ts`, shared-infrastructure modifications (`image-orchestration.ts`, `image-pipeline.ts`, `site-generator.ts`, `stage-artifacts.ts`, `prompt-contract.ts`), branch migration `0035`, wrangler config changes, prompt manifest additions, and tests.

## 2. Security scope

Touched domains: D1 data access (artifact writes), AI provider invocation (text + multimodal + KIE images), durable workflow orchestration, artifact storage (R2). **Not touched:** authentication, operator authorization, HTTP routes, Approval/Publication/Rollback routes, form service, secrets bindings.

## 3. Attack-surface summary

The SIMPLE pipeline is internal orchestration only — it adds **no new HTTP endpoints, no new public surface, and no new secret handling**. Its entire attack surface is the existing Build Workflow entry, which is unchanged. Provider calls flow through the same schema-validated AI boundary and vision gateway as the legacy chain.

## 4. Findings

### Phase 0 checklist verification

| Gate | Evidence | Result |
| --- | --- | --- |
| Authentication | No auth files in diff; no new routes. | PRESERVED |
| Operator authorization | `src/routes/v2.approval-create.ts`, `v2.publication-create.ts` untouched; pipeline cannot reach them. | PRESERVED |
| Business Facts isolation | Blueprint receives only `businessFactsRef` string + minimal replacement business (name/type/description) (`pipeline.ts:229-255`); full facts only via `getEffectiveBusinessFacts` to builder/truth lint. No fact writes in `src/simple-design/`. | PRESERVED |
| Unsupported-fact prevention | `bundle-qa.ts` reuses the exact exported `UNSUPPORTED_FACT_PATTERNS` + `factVocabulary` from `site-generator.ts` (diff is export-only; one copy, zero tolerance). | PRESERVED |
| Provider secret handling | Grep of `src/simple-design/` for `fetch(`/key/secret/bearer/authorization: **zero matches**. All provider access via shared gateways (`KieV2ImageProvider(env)`, vision gateway); tests use injected seams. `wrangler.jsonc` adds only a non-secret enum var. | PRESERVED |
| KIE budget | USD 3.00 hard gate lives in `src/lib/kie-v2.ts` / `image-pipeline.ts` — untouched by the diff. Only change: pre-derived `promptRecords` may replace the prompt-LLM stage with mandatory full slot coverage (throws on gaps). Repair copies Accepted Images via SQL (`reuseAcceptedImages`) — zero additional spend. | PRESERVED |
| Artifact immutability | Migration 0035 rebuilds `build_stage_artifacts` but recreates `build_stage_artifacts_no_update` / `_no_delete` triggers verbatim; writes go through `storeBuildStageArtifactIdempotent`. Sentinel index prevents false migration-skip. | PRESERVED |
| Build Version immutability | Repair creates a NEW version via `createNextBuildVersion`; resume path reuses an existing latest version instead of re-creating. No UPDATE path on versions. | PRESERVED |
| Approval | RELEASE_READY is assigned via reused `assignReleaseReady` (pre-approval state). Approval remains a separate operator-authenticated route, unchanged. | PRESERVED |
| Publication | `v2.publication-create.ts` untouched; no publication code in `src/simple-design/`. | PRESERVED |
| Rollback | Untouched. | PRESERVED |
| `DESIGN_PIPELINE_VERSION` vs Human Approval | The var is read in exactly one place (`resolveDesignPipelineVersion`, used only at the `runBuildPipeline` fork). It selects the design chain only; there is no code path from it to Approval/Publication. Verified by repo-wide grep. | NO BYPASS |

### Findings list

**W-1 (Watch item, Low) — Branch default flips the production design chain if deployed.** `wrangler.jsonc` on this branch sets `DESIGN_PIPELINE_VERSION: "simple_blueprint_v1"` as the *default* (`pipeline.ts:57` also defaults to SIMPLE when the var is absent). Deploying this branch to the production Worker would switch every new Build to the experimental pipeline. Mitigations already in place: explicit never-deploy comment in `wrangler.jsonc`, experiment spec §74-75, test config pins `legacy_v2`. Required control: this branch must never be deployed to production; any merge decision must explicitly decide the var/default (fail-safe would be inverting the default at merge time).

**W-2 (Watch item, Low) — `RELEASE_ALREADY_ASSIGNED` maps to `releaseReady: true`** (`qa-package.ts:103-105`). This is idempotent-resume semantics: the release was already assigned for that Build Version in a prior engine entry. Release assignment is monotonic per Build Version, so no downgrade path exists. Acceptable; noting for the record.

No Critical, High, or Medium findings.

## 5. Severity summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 0 (2 watch items)

## 6. Required remediation

None for the current experimental scope. Before any production merge: explicitly decide the `DESIGN_PIPELINE_VERSION` default and remove the experiment-only wrangler var default (or invert it to `legacy_v2`).

## 7. Watch items

W-1 and W-2 above.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

The SIMPLE pipeline does not weaken authentication, operator authorization, Business Facts isolation, unsupported-fact prevention, provider secret handling, the KIE budget gate, artifact/Build Version immutability, Approval, Publication, or Rollback. `DESIGN_PIPELINE_VERSION=simple_blueprint_v1` cannot bypass Human Approval before Publication. Live benchmark spend within the experiment's authorized scope may proceed on the experimental runtime.

## 9. Next best action

Proceed to Phase 1 (Finch known-good builder test) with fixture images (zero KIE spend) and live builder LLM calls only.
