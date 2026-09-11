# CSO Review — Blueprint Hero-Link Canonicalization (2026-09-10)

Branch: `cleanup/remove-legacy-design-pipeline` (base `4b9c1ab` + this patch)
Scope: removal of the Blueprint `mediaSlotId` referential lottery via deterministic canonicalization, per operator GO.

## 1. What was audited

- `src/simple-design/contracts.ts` — new pure function `canonicalizeBlueprintHeroMediaLinks` + typed canonicalization record.
- `src/simple-design/design-blueprint.ts` — pipeline order: schema validation → canonicalization → unchanged quality gate → immutable artifact; provenance attached; frozen-reuse path re-narrows stored provenance.
- `src/domain/ai-boundary.ts` — optional `heroMediaLinkCanonicalization` provenance field (structural, bounded).
- `src/simple-design/pipeline.ts` — workflow event detail records applied links (sliced to 300 chars).
- `v2-docs/prompts/simple/01-design-blueprint.md` (+ regenerated `prompt-bodies.ts`) — two-sentence truthfulness correction only; no enlargement.
- `tests/v2-simple-hero-canonicalization.test.ts` (11 tests) + vitest include list.

## 2. Security scope

No auth, authorization, routes, secrets, payment, webhook, or D1 schema/migration surface touched. No new external input path: canonicalization consumes ONLY the already schema-validated blueprint object. Trust boundary unchanged (model output → schema validation → deterministic code).

## 3. Attack-surface summary

The only "input" to the new code is the model's blueprint, which must pass `DesignBlueprintSchema` (including slot id pattern `^[a-z0-9][a-z0-9-]*$`, ≤80 chars) before canonicalization runs. The value written into `mediaSlotId` is always an existing, validated slot id from the same object's `imagery.imageSlots` — there is no path for external or injected content to enter the artifact through this change.

## 4. Findings

None blocking. Analysis notes:

- **Injection/data integrity (verified safe):** resolved link values originate from schema-validated slot ids; canonicalization runs strictly after `validateDesignBlueprint`; the canonical artifact re-validates in tests.
- **Evidence preservation (verified):** the raw accepted model output remains in the immutable ai-stage run artifact (`ai_stage_runs.artifact_r2_key`); the canonical blueprint is a separate immutable artifact; test 11 pins the distinguishability (raw: link missing; canonical: resolved). No diagnostic evidence is overwritten.
- **Fail-closed discipline (verified):** zero qualifying slots, ambiguity, cross-page slots, NORMAL priority and body slots are all declined; the unchanged quality gate then fails the build to `HUMAN_REVIEW_REQUIRED`. No retry loop, no re-roll, no second semantic generation was added (tests 4–8).
- **Artifact integrity (verified):** canonical artifact stored through the existing idempotent immutable store with checksum; provenance records `supplied → resolved` per link; the stored-provenance re-narrowing on the reuse path drops unknown entries rather than trusting them.
- **Prompt body edited under manifest version v4 (watch item):** the wording correction makes the prompt truthful (missing links are canonically resolvable, not auto-rejected). Version intentionally not bumped per the operator GO ("no prompt convergence v5 project"); the change removes a false claim rather than altering requirements.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 · Watch items: 1 (prompt body text change under v4 — accepted rationale above)

## 6. Required remediation

None.

## 7. Watch items

- If the blueprint body is edited again for behavior (not truthfulness), bump the manifest prompt version in the same change.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — no new attack surface, no gate relaxation, evidence and immutability preserved, fail-closed semantics strengthened (fewer false HUMAN_REVIEW_REQUIRED terminals for a deterministic referential defect).

## 9. Next best action

Commit as part of the cleanup branch, then run the single fresh controlled SIMPLE live pre-merge verification per the operator GO.
