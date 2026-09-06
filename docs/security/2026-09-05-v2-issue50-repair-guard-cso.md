# CSO Security Sign-Off — Issue #50 (Measured Repair Directives + Preservation/Regression Guard)

**Date:** 2026-09-05
**Scope:** Working-tree diff for #50: `src/domain/repair-guard.ts` (new: preservation set, measured directives, regression/conflict evaluation), `src/domain/automated-repair.ts` (repairContext on both batch planners + constraint-conflict instruction), `src/domain/build-pipeline.ts` (context construction from frozen artifacts, guard between confirmation and resolution, rolling N+1-vs-N baseline), `vitest.config.ts` include, `tests/v2-repair-guard.test.ts`.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited

The deterministic repair-planning context (preservation set, measured deltas, mutation scope, crop evidence keys) and the post-repair regression guard that blocks promotion when a repair breaks a previously passing hard constraint or introduces a new P0/P1 domain.

## 2. Security scope

Internal pipeline services only. No routes, auth, secrets, payment or destructive-operation changes. Trust boundaries touched: prompt composition (deterministic text from frozen artifacts appended to planner prompts) and terminal-state control (the guard can override a RELEASE_READY confirmation to HUMAN_REVIEW_REQUIRED). No D1 schema changes; repair_batches logic untouched.

## 3. Attack-surface summary

- Model-planned Fix Plans now composed alongside a larger deterministic context block — no new injection surface (static text, no model-controlled interpolation into instructions).
- The guard reads only frozen stage artifacts (qa_report, craft_preflight) — no external input path.

## 4. Findings

### Verified properties (no finding)

- **Fail-closed direction.** The guard can only BLOCK promotion (regression → HUMAN_REVIEW_REQUIRED, no release record, automation stops); it can never create a release. A confirmation that would have released is overridden when a previously passing gate now fails or a new P0/P1 domain appears — pinned by pipeline-integration tests.
- **Budgets unchanged.** The guard consumes no repair budget: on regression it escalates before `resolveAfterConfirmation` runs, so no release record is assigned and no extra batch is planned (regression-pinned: exactly one fix_coordinator batch, zero release records).
- **Determinism and provenance.** The preservation set and measured directives derive exclusively from frozen evaluation artifacts and the measured geometry comparator; region crop keys come only from craft_preflight artifacts whose hashes/coordinates were provenance-bound in #49. A model cannot fabricate preservation constraints — it can only read them.
- **No score-gaming surface.** Composite scores are structurally absent from the regression comparison (the snapshot type carries no scores), so neither the planner nor the confirmation can be steered by score movements; the score-drop-still-releases behavior is regression-pinned.
- **Conflict escalation (F).** Old blockers remaining plus new regressions together classify as CONSTRAINT_CONFLICT and terminate automation — no whack-a-mole loop; the conflict reason is recorded in workflow events and the terminal reasons.

### Watch items

- **W1 (Low): gate-id comparison is set-based.** The guard compares QA-A/QA-B gate ids between evaluations; a future gate-id rename would silently drop that gate from guard coverage (absent on the confirmation side = not compared). Mitigation: gate ids are schema-enumerated literals in qa-stages.ts, so renames fail compilation elsewhere; acceptable.
- **W2 (Low): new-blocker detection is domain-granular.** A genuinely new defect in a domain that already had a previous blocker is treated as "old business", not a regression. This keeps the guard deterministic (no fuzzy description matching) at the cost of missing intra-domain new defects; the existing confirmation ACTIVE/RESOLVED contract still counts them as blockers for release.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 findings · Watch items: 2 (W1, W2).

## 6. Required remediation

None for this scope.

## 7. Watch items

W1/W2 above — no action required now.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Proceed to the dedicated #50 commit. Full suite 44 files / 331 tests green; `tsc --noEmit` clean; `wrangler deploy --dry-run` clean.
