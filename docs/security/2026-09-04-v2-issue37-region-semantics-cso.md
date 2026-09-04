# CSO Report — Issue #37: Canonical Region Segmentation Semantics

Date: 2026-09-04
Scope under audit: working-tree diff vs `77e3fb8`-lineage (`263f948` + issue-37 changes)
Reviewed by: morabeza-cso (evidence-based, diff-level)

## 1. What was audited

- `src/domain/visual-blueprint.ts` — new `sourceEvidenceRegionIds` provenance field, `validateBlueprintRegionProvenance`, `canonicalRegionComposition`, blueprint user prompt carrying the evidence region inventory.
- `src/domain/build-pipeline.ts` — canonical composition targets to generation; QA reference profile re-targeted to Blueprint canonical regions (legacy fallback for provenance-less blueprints); QA-A context gains canonical topology.
- `src/domain/qa-capture.ts` + `src/lib/browser-adapter.ts` — `data-region` extraction and canonical region collapsing.
- `src/domain/qa-stages.ts` — QA-A user prompt canonical-region authority block.
- `src/domain/site-generator.ts` — composition targets semantics (Blueprint = only binding topology).
- Prompt manifest bumps: `visual-blueprint-generator` v3→v4, `qa-a-visual-content` v3→v4 (+ body edits, regenerated transport).
- Tests (new `tests/v2-region-semantics.test.ts`, updated fixtures) and docs (CONTEXT.md, IMPLEMENTATION-PRD §27).

## 2. Security scope

Domains touched: none of auth / secrets / payments / webhooks / public endpoints / bindings / routes / D1 access patterns / model routing. This is pipeline-internal QA evidence semantics. V1 untouched (no V1 files in diff). LLM provenance remains `glm-5.3-flash` (`scripts/verify-llm-model-routing.mjs` passes as part of `npm test`).

## 3. Attack-surface summary

New data flows introduced:

1. `data-region` attribute values read from the generated PREVIEW page (browser extraction) → `GeometryProfile.regionOrder` → JSON-embedded in the QA-A LLM user prompt.
2. Blueprint-model-emitted `sourceEvidenceRegionIds` → deterministic validator → QA/generation aggregation.
3. Evidence region ids (platform-generated, from frozen evidence) → blueprint user prompt.

## 4. Findings

### F1 (Watch item, Low) — generated `data-region` values reach the QA-A prompt

- Path: generator LLM output → `<section data-region="...">` → `el.getAttribute("data-region")` → `regionsFromLayout` → `compareGeometry` metrics JSON → QA-A user prompt.
- Assessment: a hallucinating generator could place arbitrary text in a `data-region` attribute, making it visible to the QA-A judge (text-level LLM injection attempt). Marginal exposure is negligible and pre-existing in kind: the page's full rendered text and screenshots were always visible to QA-A. Deterministic containment is unchanged: QA-A output is schema-validated (booleans + bounded strings), and `validateAssembledSite` already requires every blueprint region id to be present in the home markup. No privilege, no spend, no publication authority flows through this path.
- Remediation (optional hardening, not for this issue): whitelist candidate region ids against the Implementation Contract inside `regionsFromLayout`, or cap/strip attribute values. Deferred as a watch item.

### F2 (No action) — provenance validator containment is sound

`sourceEvidenceRegionIds` is schema-bounded (string 1..120, array minItems 1) and `validateBlueprintRegionProvenance` hard-rejects any id not present in the frozen evidence inventory, double-claims, and provenance-less regions. Fabricated provenance cannot silently reshape QA aggregation; it fails the stage. Legacy blueprints without the field remain schema-valid and route to the documented legacy QA fallback.

### F3 (No action) — frozen-verdict integrity preserved

The `qa_report` frozen-verdict reuse path is untouched; a re-entered pipeline still reuses the immutable verdict rather than re-judging. The legacy QA fallback for provenance-less blueprints preserves reproducible evaluation for pre-#37 versions.

## 5. Severity summary

- Critical: 0. High: 0. Medium: 0. Low: 1 (F1, watch item).

## 6. Required remediation

None blocking.

## 7. Watch items

- F1 above; fold the `data-region` whitelist into any future hardening pass that touches QA capture.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

## 9. Next best action

Commit as the dedicated issue-37 defect commit, deploy the exact SHA to `cf-website-factory-v2`, then resume #30 with one new Revision Request.
