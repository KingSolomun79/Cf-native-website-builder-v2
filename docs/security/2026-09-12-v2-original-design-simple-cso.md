# CSO Review — ORIGINAL_DESIGN Site Generation (issue #24)

Date: 2026-09-12
Branch: `feature/original-design-simple` (base `main @ e8c7849`)
Scope: full diff vs `e8c7849` — creative-direction onboarding input, two new canonical prompts (`simple-original-design-blueprint/v1`, `simple-original-design-visual-qa/v1`), mode-conditional SIMPLE pipeline routing, ORIGINAL_DESIGN deferred-mode lock removal.
Gates at review time: `npm test` 479/479 (41 files, incl. LLM model-routing hygiene gate + resource-isolation gate), `npm run typecheck` PASS, prod dry-run PASS, exp dry-run PASS.

## 1. What was audited

- Onboarding intake surface: `lifecycle-schema.ts` payload schema + per-mode validation, `lifecycle.ts` freeze/checksum, `v2.onboarding-submit.ts` (unchanged).
- Revision path: `revision.ts` lock removal, `v2.revision-request.ts` status map.
- Pipeline trust boundaries: `simple-design/pipeline.ts`, `design-blueprint.ts`, `visual-qa.ts`, `site-repair.ts`, `qa-package.ts`, `contracts.ts`.
- New prompt bodies + `prompt-contract.ts` manifest (prompt provenance).
- Provenance recording (`original_design_intake` workflow event, `ai_stage_runs` prompt ids).
- Tests: new `tests/v2-original-design.test.ts` (17 tests) + updated suites.

## 2. Security scope

Touched sensitive domains: webhook-authenticated intake input handling (payload shape grew), LLM prompt composition with a new attacker-influenced input (creative direction), spend-bearing pipeline enablement (KIE image budget), feature-gate removal (lock). Not touched: auth mechanisms, capability tokens, publication/rollback authz, form service, secrets, D1 access patterns, R2 key construction.

## 3. Attack-surface summary

- `/api/v2/onboarding-submissions` (HMAC-gated, unchanged) now accepts `creativeDirection` for `buildMode=ORIGINAL_DESIGN`. Fields are capped (direction ≤4000 chars; each auxiliary field ≤1000–2000) and validated with `additionalProperties: false`.
- Creative-direction text flows into the ORIGINAL_DESIGN blueprint prompt; Business Facts already flowed (≤5000 chars) into builder/repair prompts at the same trust level.
- ORIGINAL_DESIGN builds spend LLM + KIE budget exactly like REFERENCE_BOUND builds; bounded by the same hard USD 3.00/Site KIE gate (TERMINAL_INVARIANT) and the ONE-repair ceiling.

## 4. Findings

**F1 (Verified, Low) — Creative direction is operator-controlled LLM prompt content.**
Exploit path: an authenticated intake caller supplies creative-direction text attempting to steer the blueprint into fabricated trust content (testimonials, statistics, client names).
Impact: a fabricated-claim blueprint could reach the builder.
Bounded by: (a) the prompt's trust-section constraint (trust sections require explicit Business Facts, and the blueprint receives NO business content — only a provenance pointer); (b) the deterministic truth lint in bundle QA (zero-tolerance, blocker); (c) release gates fail closed on any truth blocker. Residual risk is a wasted generation, not a shipped fabrication. No code change required; monitored via existing truth gates.

**F2 (Verified, Low) — Lock removal is a feature enablement, not an authz change.**
The deterministic lock gated a product mode for every caller equally; it was never an authentication or authorization control. Enabling ORIGINAL_DESIGN grants nothing to callers who could not already create REFERENCE_BOUND generations via the same HMAC secret. Publication/Approval remain capability-gated (`OPERATOR_CAPABILITY_SECRET`) and mode-agnostic. No remediation.

**F3 (Verified, Info) — No fallback/mode leakage.**
ORIGINAL_DESIGN rejects supplied Reference input at validation (never behaves as Reference-bound); REFERENCE_BOUND rejects creativeDirection; reference visual inputs remain mandatory for the REFERENCE_BOUND blueprint/visual-QA stages (test-enforced). The REFERENCE_BOUND prompt path is byte-identical to pre-change main (same `simple-design-blueprint/v5` body, same composition). The original stages run under distinct prompt ids recorded in `ai_stage_runs`.

**F4 (Verified, Info) — Provenance hygiene.**
The workflow provenance event records `creativeDirectionSha256` (a digest of operator-supplied text), the onboarding submission id, and `referenceEvidence=NOT_APPLICABLE`. No secret values, no fake reference identities; `qa_package.referenceScreenshotKeys` is `null` (not fabricated) for ORIGINAL_DESIGN.

**F5 (Verified, Info) — Secrets and configs.**
No new env vars, bindings, or secret names. The model-routing hygiene gate passes (no legacy model/provider names in the new prompts). No generated asset may hold credentials (unchanged architecture).

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 1 (F1, bounded, monitored) · Info: 3.

## 6. Required remediation

None blocking. F1 requires no code change; the existing truth lint + zero-tolerance release gates are the correct and sufficient controls.

## 7. Watch items

- **W1:** KIE/LLM spend abuse via ORIGINAL_DESIGN submissions is bounded per-site (USD 3.00 hard gate) but a caller with the intake HMAC could create many sites. This exposure is identical to the existing REFERENCE_BOUND surface and is a platform quota concern, not introduced by this issue.
- **W2:** If creative-direction text is ever surfaced in an external UI/artifact view, remember it is human input — treat it as untrusted content in any future HTML rendering context (it is currently only stored JSON + workflow event text).
- **W3:** The sandbox qualification will run REAL ORIGINAL_DESIGN generations; verify no trust-section fabrication appears in practice (the truth gate is the automated backstop).

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Commit issue #24 on the branch, then run the sandbox-only qualification (three diverse ORIGINAL_DESIGN businesses) with W3 explicitly checked, before any merge recommendation. Production remains untouched during qualification.
