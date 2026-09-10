# CSO Review — design-blueprint/2 Structural Page Heroes (2026-09-10)

Branch: `cleanup/remove-legacy-design-pipeline` (base `dc642f6` + this patch)
Scope: design-blueprint/2 contract per operator GO — required per-page hero specs + required page-hero image briefs, deterministic materialization, prompt v5.

## 1. What was audited

- `src/simple-design/contracts.ts` — v2 schemas (hero spec / hero image brief / page shape), gate v2, reserved hero ids, materialization (slots/prompt records/builder descriptors), version dispatch, `storedBlueprintToV2` compat adapter.
- `src/simple-design/design-blueprint.ts` — v2 stage (native v2 schema, no canonicalization) + read-only v1 frozen-artifact compat path.
- `src/simple-design/pipeline.ts` — materialized plan feeds images/builder/assemble/QA/repair; repair inheritance stores with the produced schema version.
- `src/simple-design/bundle-qa.ts` — hero-media check receives the deterministic reserved slot id.
- `src/simple-design/website-builder.ts`, `visual-qa.ts`, `site-repair.ts` — input type v2; builder receives code-assembled hero→slot descriptors (no relationship reconstruction).
- `src/routes/v2.exp-benchmark-driver.ts` — driver ops normalize stored/requested blueprints to v2; version-dispatched gate on the copy path.
- Prompt body shortened (8131 → 7305 bytes), manifest v5, regenerated transport; tests converted; new `tests/v2-simple-blueprint-v2.test.ts` (§19-21 coverage).

## 2. Security scope

No auth, routes, secrets, payments, webhooks, or D1 schema/migration surface touched. `schema_version` verified free-form TEXT in the `build_stage_artifacts` CHECK-bearing table — no migration required (GO §18 verified, not assumed). Trust boundary unchanged: model output → native JSON Schema → deterministic code.

## 3. Attack-surface summary

The v2 schema REDUCES the model-controlled surface: heroes no longer carry model-generated identity fields (id/page/section/priority/mediaSlotId). Every model-supplied string flows through the same TypeBox validation as v1. Materialized slot ids are system constants (`${page}-hero`) — they cannot be influenced by model output. Supporting-slot ids remain schema-constrained (`^[a-z0-9][a-z0-9-]*$`) and reserved-id collisions fail the gate deterministically.

## 4. Findings

None blocking. Analysis notes:

- **Injection (verified safe):** materialized values are compile-time constants; brief strings are schema-bounded and consumed only by the existing KIE/builder prompt paths (same as v1).
- **Immutability (verified):** stored v1 artifacts are never rewritten; the compat path adapts read-only at resume and refuses loudly (`QUALITY_GATE_FAILED`) on a v1 artifact without a valid hero link — no silent content invention.
- **Fail-closed (verified):** a schema-valid v2 artifact structurally CANNOT omit a page hero or hero brief (required properties + native structured output); gate adds materialization belt checks incl. reserved-id collision and CRITICAL priority.
- **No canonicalization in v2 (verified by test):** the v1 canonicalizer is retained purely for historical artifact reading; the v2 stage reports no canonicalization provenance.
- **Prompt v5 body change under a genuine version bump (accepted):** manifest version bumped v4 → v5 in the same change per GO §16; prompt NET SHORTER (8131 → 7305 bytes).
- **Driver tooling (verified):** benchmark ops normalize either artifact generation before use; no driver op writes to production resources.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0

## 6. Required remediation

None.

## 7. Watch items

- The v1 contract/gate/canonicalizer and the v1 Finch fixture are retained solely for historical artifact reading; they must be retired together with the benchmark driver in the production-rollout GO when v1 artifacts are no longer needed as evidence.

## 8. Final security verdict

**SECURITY OK** — the change strictly reduces model-controlled artifact surface, preserves immutability and fail-closed semantics, and requires no infrastructure or secret changes.

## 9. Next best action

Commit, deploy the sandbox, and run the single fresh live merge verification per GO §24-25.
