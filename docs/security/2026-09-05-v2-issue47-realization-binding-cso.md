# CSO Security Sign-Off — Issue #47 (CSS/HTML Realization Binding)

**Date:** 2026-09-05
**Scope:** Working-tree diff for #47: `src/domain/implementation-planner.ts` (realization contract block), `src/domain/site-generator.ts` (rule-level `REGION_STYLE_MISSING`, classified `ORPHANED_CLASS`, CSS inventory injection, `regeneratePagesForRealization` entry point), `src/domain/image-pipeline.ts` + `src/lib/image-dimensions.ts` (orientation conformance gate), `src/lib/browser-adapter.ts` (layout extraction fields), `vitest.config.ts` (fixture transport), test scaffolding alignment, `tests/v2-realization-binding.test.ts`, `docs/architecture/v2-generation-ownership.md`.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited

The deterministic realization-binding seam: contract planning, assembly validation checks, the informed per-page regeneration entry point, and the image acceptance orientation gate.

## 2. Security scope

Internal domain services only. No public routes, no auth/authorization changes, no secrets or bindings changes, no payment flows, no D1 schema changes (the orientation rejection reuses the existing `image_attempts` `failed` status). Trust boundaries touched: (a) model-generated CSS/HTML strings → deterministic validators; (b) image-provider bytes → header sniffing → acceptance decision; (c) measured findings text → repair prompt composition.

## 3. Attack-surface summary

- AI-generated `site.css` / page HTML are parsed by new deterministic code (`parseCssRules`, `extractCssClassInventory`, `extractHtmlClasses`, `classifyGeneratedClass`).
- Image provider bytes (external KIE response) are header-sniffed (`sniffImageDimensions`) before an acceptance decision.
- `regeneratePagesForRealization` composes repair prompts from finding text and runs a schema-validated AI stage inside the same immutable Build Version.

## 4. Findings

### Verified properties (no finding)

- **No secrets, no new bindings, no routes.** The diff adds no env access, no `SECRET_*` usage, no fetch endpoints, no request handling.
- **Byte-sniffing is bounds-checked.** `sniffImageDimensions` guards every fixed-offset read (`bytes.length` >= 24 for PNG/WEBP headers, `>= 30` for WEBP chunks, bounded JPEG marker walk); malformed or truncated provider bytes return `null`, which the acceptance gate treats as "no rejection" — a failed build is impossible from hostile bytes, and no unchecked DataView read exists.
- **Validators are linear.** `parseCssRules` is a single-pass brace walk; `extractCssClassInventory`/`extractHtmlClasses` use linear regex scans. No catastrophic-backtracking regex on attacker-influenced content.
- **Immutability boundaries preserved.** The regeneration entry point only ever stores NEW artifact subkeys (`{page}.realization-repair-1`), reuses frozen artifacts verbatim on retry (the reuse-path bug found by the new test — `value.value.html` on a reused artifact — is fixed), and never touches `repair_batches` or `accepted_images`. Assembled output is re-validated by the same deterministic validator before anything flows downstream.
- **Rejected image bytes are audit-only.** An orientation-rejected attempt persists its bytes under the attempt's build-asset key for cost/audit provenance; the shipped candidate bundle is composed exclusively from `accepted_images` rows, so a rejected asset cannot reach a preview or release artifact.

### Watch items

- **W1 (Low): recursive `@media`/`@supports` nesting depth in `parseCssRules`.** A pathologically nested generated stylesheet recurses per nesting level; extreme depth would throw (stack) and fail the build stage. Content originates from our own schema-gated AI stage, so there is no external injection path; failure mode is a visible pipeline failure, not a breach. Acceptable; revisit only if a generator regression produces deep nesting.
- **W2 (Low): prompt-composition injection surface is unchanged by design.** `findingDirectives` text flows into a generation prompt as prior repair directives do; output remains bounded by the JSON schema validation and post-generation deterministic validation. Consistent with the #39–#46 architecture; no new capability granted to model content.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 findings · Watch items: 2 (W1, W2).

## 6. Required remediation

None for this scope.

## 7. Watch items

W1 and W2 above — no action required now; W1 is the only code-adjacent item and is acceptable for generated-plain-CSS inputs.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Proceed to the dedicated #47 commit. The 2 frozen RankForge fixtures, the gate suite (41 files / 306 tests green), `tsc --noEmit` and `wrangler deploy --dry-run` all pass on this tree.
