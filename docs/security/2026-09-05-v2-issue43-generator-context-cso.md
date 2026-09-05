# CSO — Issue #43: Generator Visual-Reference Context

**Date:** 2026-09-05
**Scope:** reference visual context attached to every visual-output generation step; reference content-isolation clause; CSS identity-field regression fix.
**Verdict:** SECURITY OK FOR CURRENT SCOPE

## 1. What was audited

- `src/domain/site-generator.ts`: `GenerateCompleteSiteInput` gains `visualInputs` + `visionGenerate`; every generation step (shared CSS, shared JS, four pages) routes through the multimodal seam and carries the reference context block: attached-package metadata, DO-NOT-COPY isolation (copy, business names, logos, testimonials, factual claims, contact info, images/assets), and reference-fidelity-over-generic-convention authority. Provenance records visual artifact ids. CSS prompt now includes `signatureTraits`, `homepageRegions`, `visualThesis`, `homepageFirstViewport` (previously omitted identity fields).
- `src/domain/build-pipeline.ts`: `visionGenerate` dep seam threaded to the analyzer and generation steps (production default: real vision adapter).

## 2. Security scope

Same trust boundary as #42: normalized reference imagery flows to the configured LLM provider under existing gateway credentials. No new endpoints, secrets, or auth changes. The reference-content isolation restatement reduces the (already guarded) risk of reference content leaking into customer sites.

## 3. Attack-surface summary

No new inputs from untrusted sources: visual inputs are hash-bound frozen artifacts read from private R2. Prompt content is assembled from frozen evidence + business facts only. The isolation clause is defense-in-depth on top of the existing Business-Fact/fabrication gates and deterministic assembly validation.

## 4. Findings

None Critical/High/Medium.

Watch items:

1. **Multimodal token cost scales with generation steps (Low, operational).** Up to ~7 additional image-bearing calls per Build. Acceptance for this issue explicitly prioritizes quality over cost ("do not optimize cost by making the system blind again"); usage is provenance-tracked per call in ai_stage_runs.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 · Watch items 1 (operational).

## 6. Required remediation

None for this scope.

## 7. Watch items

Monitor vision-call cost in the #46 production retest evidence.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE.**

## 9. Next best action

Proceed to #44 (independent direct reference fidelity QA gate).
