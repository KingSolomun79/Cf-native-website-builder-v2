# CSO Security Sign-Off — Issue #48 (Fabrication Defenses)

**Date:** 2026-09-05
**Scope:** Working-tree diff for #48: `src/domain/site-generator.ts` (deterministic trust-context Business-truth lint, `FABRICATED_TRUST_ENTITY`), `src/domain/qa-stages.ts` (fabrication verdict becomes a tracked P1 business-truth blocker; QA-A prompt business-truth clause), `src/domain/automated-repair.ts` (confirmation resolution contract restates that business-truth findings are never visually resolved), `src/domain/image-pipeline.ts` (binding identity prohibition in every KIE prompt), `vitest.config.ts` include entry, `tests/v2-truth-lint.test.ts`.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited

The deterministic Business-truth layer for trust/identity contexts: context-scoped label linting at assembly, the release-evaluation treatment of fabrication, the confirmation seam's restated business-truth rule, and the generation-side prompt prohibition against baked-in identities in imagery.

## 2. Security scope

Internal domain services only. No routes, no auth changes, no secrets, no D1 schema changes, no destructive operations. Trust boundaries touched: (a) model-generated HTML attributes/headings/labels → deterministic lint (in-process, no external input path); (b) release-evaluation semantics (intentionally fail-closed); (c) static prompt text additions.

## 3. Attack-surface summary

- Assembly-time scanning of generated page HTML (`lintTrustContexts`): regex alternation with word boundaries and a single-pass container stack — no nested quantifiers, linear in page size.
- `evaluateQaARelease` blocker synthesis from `report.fabrication`.
- Confirmation prompt composition (previous blockers now include the synthesized business-truth blocker).

## 4. Findings

### Verified properties (no finding)

- **Fail-closed direction.** Every change makes release STRICTER: fabricated trust entities block assembly; a fabrication verdict becomes a tracked P1 blocker the confirmation must explicitly mark RESOLVED with evidence; the resolution contract forbids "visual" resolution of business-truth defects. No relaxation of any existing gate.
- **No ReDoS / no unbounded scanning.** The lint's patterns are linear alternations; the container scanner walks the document once with a depth-corrected stack.
- **Facts are the only allowlist source.** `factVocabulary` derives permitted words exclusively from the Business Facts plus a closed generic/category/function word list — no dynamic or model-controlled allowlist; a model cannot launder a fabricated name by emitting it twice.
- **Prompt additions are static text.** The QA-A business-truth clause, confirmation restatement, and KIE identity prohibition add no injection surface (no interpolation of model-controlled content into instructions).

### Watch items

- **W1 (Low): operational false-positive risk, not a security risk.** A legitimate design that places capitalized short labels inside a trust-signaling context (e.g. a client band with descriptor words outside the facts vocabulary) will fail assembly and burn the one informed assembly-repair round. Mitigations already in place: the context trigger requires a dominating trust phrase (a business name containing "Partners" as H1 does NOT trigger), long prose is exempt, sentence-case/acronym/first-cap labels are exempt, and imagery descriptor words are safe-listed. Remaining residual risk is availability-only; the failure is loud, classified, and repairable by regenerating the page without the fabricated-looking labels.
- **W2 (Low): pixel-baked identity is not deterministically detectable.** The frozen v3 fixture's fabricated logos live in image pixels; the deterministic defenses for that mode are the #47 orientation gate (rejects the exact frozen asset) plus the new KIE prompt prohibition and the QA-A vision business-truth rule. OCR-grade deterministic pixel verification does not exist in the stack and is intentionally not added here.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 findings · Watch items: 2 (W1 operational, W2 detection boundary).

## 6. Required remediation

None for this scope.

## 7. Watch items

W1/W2 above — no action required now. If production shows recurrent W1 false positives, the closed generic vocabulary is the single tuning point (documented in the lint).

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Proceed to the dedicated #48 commit. Full suite 42 files / 316 tests green, `tsc --noEmit` clean, `wrangler deploy --dry-run` clean on this tree.
