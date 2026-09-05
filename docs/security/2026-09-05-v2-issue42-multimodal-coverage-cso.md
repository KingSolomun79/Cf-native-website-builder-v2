# CSO — Issue #42: Multimodal Reference Analysis + Blueprint Coverage Contract

**Date:** 2026-09-05
**Scope:** vision-path wiring for the Reference Analyzer, visual-input provenance, blueprint coverage gate with BLUEPRINT_REVIEW_REQUIRED escalation.
**Verdict:** SECURITY OK FOR CURRENT SCOPE

## 1. What was audited

- `src/domain/reference-analysis.ts`: multimodal seam — when the frozen evidence carries normalized visual inputs, the analyzer routes through `createProductionVisionGenerate` (reads the primary visual input from build-scoped R2, base64-encodes, calls `generateVisionWithGateway`; canonical model policy — glm-5.3-flash via the configured provider chain, no separate vision model). Provenance records visual input artifact ids. Missing visual artifact → typed `VISION_INPUT_UNAVAILABLE` (refuses to run blind rather than silently degrading). Text-only `generate` seam remains only for evidence without visual inputs.
- `src/domain/visual-blueprint.ts`: `evaluateBlueprintCoverage` (deterministic) — identity-defining traits, major measured masses (≥0.35 viewport), and extraction image-mass bands must map to canonical regions/traits or explicit Adaptation Contract tokens (`mass:<id>`). Prompt assembly fixed (un-interpolated template literal) and extended with the coverage mandate.
- `src/domain/build-pipeline.ts`: coverage GAPS → `BLUEPRINT_REVIEW_REQUIRED` event → `HUMAN_REVIEW_REQUIRED` terminal before Implementation Contract production. `ORIGINAL_DESIGN` untouched.

## 2. Security scope

R2 reads of build-scoped visual artifacts; outbound vision-model calls (images leave the isolate to the configured LLM provider — pre-existing data flow class for all AI stages, now including reference images). No auth/secrets/payments/endpoints. Visual inputs remain private; only what the configured provider already receives for generation is now also seen by the analyzer — same trust boundary.

## 3. Attack-surface summary

New outbound data: normalized reference screenshots to the vision provider under the existing gateway credentials and timeout/retry bounds. The adapter encodes only artifacts recorded in the frozen evidence (hash-bound); no user-controlled URLs reach the vision request. Coverage gate is deterministic — no prompt-injection-sensitive logic (it reads measured evidence and blueprint structure, not model prose).

## 4. Findings

None Critical/High/Medium.

Watch items:

1. **Reference imagery leaves the tenant boundary to the LLM provider (Low, accepted product decision).** Multimodal analysis requires it; the imagery is a customer-supplied design reference (not secrets), the provider is the platform's configured gateway account, and tokens/cost are provenance-tracked. Consistent with the existing generation path that already sends business content to the same provider.
2. **Coverage thresholds are heuristics (Low).** `MAJOR_MASS_RATIO = 0.35` and image-mass overlap checks are deterministic but tunable; false positives escalate to human review (fail-closed direction) rather than leaking bad builds.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 · Watch items 2 (low).

## 6. Required remediation

None for this scope.

## 7. Watch items

Track glm-5.3-flash vision usage via ai_stage_runs provenance (token/cost columns) as #43/#44 add more multimodal calls.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE.**

## 9. Next best action

Proceed to #43 (generator visual-reference context).
