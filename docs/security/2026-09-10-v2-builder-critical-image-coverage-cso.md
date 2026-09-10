# CSO Review — Website Builder CRITICAL Image Coverage Contract (2026-09-10)

Branch: `cleanup/remove-legacy-design-pipeline` (base `dbddaa8` + this patch)
Scope: CRITICAL image coverage becomes an explicit Website Builder contract per operator GO — deterministic mandatory-placement ledger in the Builder context, shared coverage validator reused by Builder validation and Assembly Preflight, ONE_CALL coverage failure eligible for the sanctioned TWO_CALL fallback, fail-closed after the fallback, prompt `simple-website-builder/v3`.

## 1. What was audited

- `src/simple-design/critical-image-coverage.ts` (new) — pure validator: `requiredCriticalImageSlots`, `validateCriticalImageCoverage(pages, slots, form)` → `MISSING_CRITICAL_IMAGE` / `WRONG_PAGE_CRITICAL_IMAGE`; reference forms `placeholder` (raw bundle, `src="IMG:{slotId}"`) and `bundled` (assembled candidate, `src="assets/images/{slotId}.webp"`), mapped 1:1 onto what the deterministic assembly resolves.
- `src/simple-design/website-builder.ts` — `AcceptedImageDescriptor` gains `priority` + `required`; deterministic ledger (flat + per-page grouping) and the CRITICAL invariant / truth-safe guidance in the frozen shared context; coverage validated BEFORE `storeBuildStageArtifactIdempotent`; ONE_CALL schema-valid-but-uncovered → sanctioned TWO_CALL fallback; TWO_CALL still uncovered → `SimpleWebsiteBuilderError("CRITICAL_IMAGE_COVERAGE")`, nothing persisted.
- `src/simple-design/contracts.ts` — `MaterializedAcceptedImageDescriptor` carries `priority` and `required` (= priority === CRITICAL); materialization logic and Accepted Image persistence unchanged.
- `src/domain/technical-preflight.ts` / `src/domain/assembly.ts` — preflight context is now page-aware (`criticalSlots`) and delegates to the shared validator in `bundled` form (one definition, final defense retained; strictly stricter than before: wrong-page placement is now a blocker; a bare `data-image-id` or a temp URL `src` is NOT coverage).
- `src/simple-design/pipeline.ts` — the build step catches the coverage error in-step and returns the terminal-result marker → workflow event + `HUMAN_REVIEW_REQUIRED`; no assembly, no preview, no repair, no engine retry.
- `src/domain/stage-failure.ts` — backstop: `SimpleWebsiteBuilderError` classifies `DETERMINISTIC_REVIEW_REQUIRED` (→ `NonRetryableError` at the engine boundary), so no stray path can turn the failure into a third Builder attempt.
- Prompt: `v2-docs/prompts/simple/02-website-builder.md` (new hard requirement 5), manifest `simple-website-builder/v3`, `src/domain/prompt-contract.ts`, regenerated transport. Blueprint prompt v5 / schema design-blueprint/2 untouched.
- Tests: new `tests/v2-builder-critical-image-coverage.test.ts` (16 tests: §1-§15 + primary-seam pipeline fail-closed); `tests/helpers/simple-scripts.ts` option `builderOmitsAboutHero`; three existing tests updated for the new preflight context shape, the v3 version, and coverage-valid fixtures.

## 2. Security scope

No auth, routes, secrets, payments, webhooks, Form Service, D1 schema/migration, R2 access pattern, or deployment configuration touched. Production `wrangler.jsonc` and `KIE_MODEL` untouched. Trust boundary unchanged: model output → TypeBox schema → deterministic code; this change ADDS a deterministic gate between the model's bundle and the frozen artifact.

## 3. Attack-surface summary

- **Model-controlled inputs to the new validator:** page HTML (model output) and slot ids. Slot ids are either system constants (`${page}-hero`) or schema-constrained supporting ids (`^[a-z0-9][a-z0-9-]*$`, ≤80 chars). Every id is regex-escaped before pattern construction; patterns are literal (no quantifier nesting) — no ReDoS. Work is O(CRITICAL slots × 4 pages) with ≤16 slots — no amplification.
- **Prompt content:** the ledger embeds `slotId`, `page`, `section` (blueprint text, schema-bounded ≤120 chars) and `priority`. All of these already reached the model inside the serialized blueprint JSON; no new data class enters the prompt and no secret/config value is exposed to the model.
- **Persisted text:** the fallback bundle `notes` (bounded to ≤600 chars of coverage summary, under the schema's 4000 cap) and the workflow event detail (sliced to 400) carry slot ids/page/section only.
- **Retry semantics:** the fail-closed error is reached only after BOTH sanctioned strategies completed and were deterministically validated; classifying it non-retryable cannot swallow a transient fault (transients throw before validation and keep their existing classification).

## 4. Findings

None blocking. Analysis notes:

- **Fail-closed integrity (verified by tests):** the coverage-violating bundle is never written as `site_bundle`; the pipeline terminates `HUMAN_REVIEW_REQUIRED` with one Build Version, no `assembled_manifest`, no `qa_package`, and an audit event on stage `simple_website_build`. Exactly three model calls in the worst case (ONE_CALL + shell + pages); no third attempt.
- **Single definition (verified):** Builder validation and Assembly Preflight call the same function; the only difference is the syntactic reference form, chosen to match the assembly's resolution regex exactly, so a Builder-passing bundle cannot fail the preflight on coverage alone and the preflight remains the strictly-stronger final defense.
- **Preflight strengthened, not weakened (verified by the retained assembly regression test):** a temp-URL `src` with a leftover `data-image-id` still fails `MISSING_CRITICAL_IMAGE`.
- **Truth zero-tolerance preserved (verified):** the truth-safe guidance instructs preserving photography without inventing facts; the trust lint still fails a fabricated testimonial author in a testimonial container while the CRITICAL image ships.
- **No scope creep into protected areas (verified by diff):** blueprint schema/prompt, hero materialization, KIE/Nano Banana, Visual QA, Repair architecture, truth lint, transport fallback and production configuration are unchanged.
- **Cross-layer import (accepted):** `domain/stage-failure.ts` and `domain/technical-preflight.ts` now import from `simple-design/` — a pattern already present (`domain/build-pipeline.ts`), with no import cycle (the builder's import graph never reaches `stage-failure`).

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0

## 6. Required remediation

None.

## 7. Watch items

- The Builder check requires the exact `src="IMG:{slotId}"` idiom the prompt mandates. If a future prompt legitimately allows another shipping idiom (e.g. `<source srcset>`), the assembly resolver, this validator's `placeholder` form and the preflight's `bundled` form must be extended together — never one of them alone.
- `WRONG_PAGE_CRITICAL_IMAGE` is a new preflight blocker id; the changed-files repair's failed-file attribution treats it as unattributable (whole-bundle scope). Acceptable: the Builder contract now prevents that state before repair; the preflight is the backstop.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

## 9. Next best action

Commit as the dedicated Builder-contract change, then run the single controlled live SIMPLE Site Generation from the cleaned branch (no blueprint reroll, no second generation) and evaluate the merge bar.
