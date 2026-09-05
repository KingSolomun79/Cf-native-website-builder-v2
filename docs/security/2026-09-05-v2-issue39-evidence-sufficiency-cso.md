# CSO — Issue #39: Reference Evidence Sufficiency Guard

**Date:** 2026-09-05
**Scope:** `fix(v2)` fail-closed evidence-sufficiency guard for REFERENCE_BOUND intake (issue #39).
**Verdict:** SECURITY OK FOR CURRENT SCOPE

## 1. What was audited

- `src/domain/reference-sufficiency.ts` (new): deterministic, versioned sufficiency evaluation (`SUFFICIENT | PARTIAL | INSUFFICIENT`) over frozen `ReferenceEvidence`.
- `migrations/0031_v2_reference_evidence_sufficiency.sql` (new): nullable `evidence_sufficiency` (CHECK-constrained enum mirror) + `evidence_sufficiency_verdict_json` columns on the append-only `reference_evidence_packages` table.
- `src/domain/reference-intake.ts`: verdict computed pre-freeze, persisted with the immutable package, exposed on both read paths; legacy (pre-#39) rows evaluated lazily on read without rewriting frozen evidence.
- `src/domain/build-pipeline.ts`: `INSUFFICIENT` → `HUMAN_REVIEW_REQUIRED` terminal with root-cause classification; `capture` dep seam (pass-through, production default unchanged).
- Test harness: measured reference-capture fixture; pipeline fixtures migrated from dimensions-only SCREENSHOT_ONLY to SCREENSHOT_AND_URL (the valid mode post-#41).

## 2. Security scope

No auth, authorization, secrets, payments, webhooks, or public endpoints touched. No new routes. D1 schema extended additively (nullable columns only); R2 object layout unchanged. Trust boundaries crossed: none new — the only new operator-influenced input is the existing `AdaptationContract` now also consulted for `evidence_missing:<dimension>` declarations.

## 3. Attack-surface summary

The pipeline terminal surface changes in one direction only: previously-proceeding information-free references now terminate at `HUMAN_REVIEW_REQUIRED`. No path that was blocked becomes reachable. The guard closes a failure mode where blind generation could reach Release Ready (documented RankForge incident); there is no new externally reachable surface.

## 4. Findings

None Critical/High/Medium.

Watch items:

1. **Operator-authoritative PARTIAL declarations (Low, by design).** A submitted Adaptation Contract declaring `evidence_missing:region_structure` / `evidence_missing:measured_elements` downgrades INSUFFICIENT → PARTIAL and lets the build proceed. This mirrors the existing Adaptation Contract trust model (human-authoritative, fixed before generation) and the verdict JSON persists exactly which dimensions were declared missing. Requirement downstream: the Blueprint coverage contract (#42) must treat declared-missing dimensions as uncovered, and generator/QA prompts must never convert `evidence_missing:*` tokens into content. No action required in #39 beyond the persisted verdict; enforced by review in #42.
2. **Legacy-row lazy evaluation is read-only (Low, verified safe).** Pre-#39 packages get their verdict computed on read; no write-back path exists, and the `no_update`/`no_delete` triggers remain the enforcement backstop. Frozen evidence bytes are never modified (regression-tested).

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 · Watch items 2 (both low, one requiring downstream follow-through in #42).

## 6. Required remediation

None for this scope.

## 7. Watch items

See findings 1–2. Carry finding 1 into #42 acceptance criteria (declared-missing dimensions must surface in coverage validation).

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE.**

## 9. Next best action

Land #39, proceed to #40 (production capture wiring — `launch(undefined)` remains the highest-risk open defect until fixed).
