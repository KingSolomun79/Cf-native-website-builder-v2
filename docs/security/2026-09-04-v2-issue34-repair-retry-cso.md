# CSO Report — Issue #34: Repair-loop state across Cloudflare Workflow retries

Date: 2026-09-04
Scope: defect fix only (no #30 runbook items)
Change surface:
- `src/domain/build-pipeline.ts` — repair-state reconstruction from D1 truth, artifact inheritance (design stages added, per-row ids), frozen `qa_report` reuse on re-entry, D1-derived ceiling guard, `REPAIR_BUDGET_EXHAUSTED` backstop mapped to `HUMAN_REVIEW_REQUIRED`
- `src/domain/automated-repair.ts` — budget pre-check before `createNextBuildVersion` (prevents orphan versions); UNIQUE index unchanged as race backstop
- `tests/v2-build-pipeline-retry.test.ts` (new, 4 regression tests), `tests/helpers/pipeline-scripts.ts` (script options), `vitest.config.ts` (suite registered)

Gates at time of review: 31 files / 213 tests passing (incl. 4 new retry tests), `tsc --noEmit` clean, `wrangler deploy --dry-run` pass.

## 1. What was audited

Full diff of the four files above, plus the interaction of the changed pipeline seams with the existing release/publication/rollback boundaries (`release.ts`, `stage-artifacts.ts`, capability-gated routes).

## 2. Security scope

- Auth/authorization: not touched (no routes changed; pipeline is internally invoked by the capability-gated workflow path).
- Secrets: none added, none moved.
- D1/R2 data access: changed (new reads/copies of internal rows).
- Public endpoints / visitor data: not touched.
- Payment flows: none.

## 3. Attack-surface summary

No new externally reachable surface. All new code executes inside the build pipeline's trusted context with platform-controlled inputs (D1 rows written only by pipeline/domain code; R2 objects written only through `putImmutableObject*`). All new SQL is parameterized.

## 4. Findings

**F1 (Verified, acceptable): frozen `qa_report` reuse trusts an internally-written artifact.**
The re-entry path reuses the stored combined QA report instead of re-judging with fresh LLM runs. The artifact is only writable by `assignReleaseReady` inside the pipeline itself (no route writes stage artifacts), R2 writes are immutable, and the record-pinning re-assign re-submits the exact frozen verdicts (identical checksum → idempotent store). A `NOT_RELEASE_READY` verdict can never upgrade itself: `releaseReady` derives from the frozen `verdict` field and only `RELEASE_READY` triggers the pinning call. No new trust boundary.

**F2 (Verified, acceptable): `REPAIR_BUDGET_EXHAUSTED` now maps to `HUMAN_REVIEW_REQUIRED` at the orchestration seam.**
This converts an automation-stop into the domain-correct terminal instead of `FAILED`. Automation is not extended: the hard ceiling remains the append-only `repair_batches` UNIQUE (build_id, kind) plus no-update/no-delete triggers, and the loop's D1-derived guard stops before spending further LLM calls. The event trail records the terminal with explicit reasons.

**F3 (Verified, fixed by this change): artifact-inheritance statement bound a single generated id for all copied rows.**
`generateId()` was evaluated once, so every copied row shared one primary key and `INSERT OR IGNORE` silently copied only the first row. This was a correctness defect (repairs regenerated validated pages fresh), not an injection vector — the statement is parameterized and now computes ids per row via `lower(hex(randomblob(16)))`.

**F4 (Verified, fixed by this change): budget pre-check now precedes `createNextBuildVersion`.**
Previously a budget-rejected batch still burned an immutable Build Version (orphan with no artifacts). The pre-check rejects before version creation; the UNIQUE index remains as the concurrent-race backstop.

## 5. Severity summary

- Critical: none
- High: none
- Medium: none
- Low: none open (F3/F4 were correctness defects fixed in this change; F1/F2 reviewed and accepted)

## 6. Required remediation

None for release.

## 7. Watch items

- **Legacy orphan versions:** Builds that ran `applyRepairBatch` before this fix may carry an orphan Build Version (created before the budget insert). They are inert (no artifacts, no release record). A manual pipeline re-trigger against such an old build would adopt the orphan as the current version. New builds are protected by the pre-check; no migration needed for #30 (a fresh revision Build is used).
- **`repairApplied` outcome semantics on re-entry:** when a re-entered pipeline releases the repaired version through the full QA path, the outcome reports `repairApplied: false` for that invocation while the batch remains in D1. Informational only; evidence queries should rely on `repair_batches`/`build_release_records`, not the outcome flag.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

### Addendum (same day, image-step re-entry fix)

Live runbook execution surfaced a second #34-class re-entry defect: `runImageWave` restarted `attemptNumber` at 1 on every pass, so any engine re-entry for a slot with persisted attempt rows collided with `UNIQUE (build_version_id, slot_id, attempt_number)` on an un-guarded INSERT and crash-looped the durable step (observed live on Revision Build 09c9f1ab: repeated wave events, no new attempts, no forward progress).

Fix: attempt numbering resumes from the persisted attempt rows; a slot that already burned its bounded attempts is skipped as failed so the wave completes and assembly's asset-routing/preflight decides. Security review of the delta: parameterized COUNT query only, no new surfaces, no secrets, no domain-scope change (the per-slot bounded ceiling of 2 attempts is now enforced ACROSS passes, which is strictly tighter than before — re-entries previously re-spent KIE or crashed). Regression test added to the retry suite (exhausted-slot skip + resume-at-2 acceptance).

Verdict unchanged: **SECURITY OK FOR CURRENT SCOPE**.

### Addendum 2 (same day, issue #35 — repair application)

Live runbook attempt 2 exposed a deeper defect: the repaired Build Version inherited the failed version's realization verbatim, so confirmation QA re-judged identical content and the recorded blockers (incl. `GATE_PREVIOUS_BLOCKERS_RESOLVED`) were structurally unresolvable — bounded repair could never clear anything.

Fix (issue #35): the repaired version is GENERATED WITH its batch's Fix Plan directives. The directives are loaded from D1 truth (`repair_batches.plan_json` keyed by `created_build_version_id`), so engine re-entries reapply the same plan deterministically; design-origin artifacts (analysis/blueprint/contract/image plan) remain inherited and frozen; Accepted Images remain reused; ceilings, gates and immutability are unchanged. Boundary guard `assertRepairPlanWithinBounds` re-validates the persisted plan on every load. Security review of the delta: no new surfaces, no secrets, parameterized SQL only, the repair boundary check is now applied MORE often (on every re-entry load), and the realization change is confined to the existing `repairDirectives` prompt seam of `generateCompleteSite`.

Verdict unchanged: **SECURITY OK FOR CURRENT SCOPE**.

### Addendum 3 (same day, rejected-manifest re-freeze)

Live attempt 3 exposed one more #34-class seam: the preflight-REJECTED assembly wrote its diagnostic manifest with non-tolerant `putImmutableObject`, poisoning `v{n}/manifest.json` — every retried assemble then crashed on "Immutable R2 artifact already exists" instead of surfacing the preflight rejection. Fix (commit 79cfd57): the diagnostic write uses `putImmutableObjectTolerant` (same seam as the passing path). No scope/security change; regression assertion added to the assembly suite (a retried rejection must surface `AssemblyPreflightError` again).

### Addendum 4 (same day, issue #36 — boundary-heuristic false positive)

Live attempts 1 and 3 died because the plan-text mutation heuristic tripped on legitimate realization wording (design-origin nouns used as reference points) and the pipeline classified the build FAILED. Fix (issue #36): the planner gets exactly ONE bounded re-word with the violation shown; a persistent violator routes the pipeline to HUMAN_REVIEW_REQUIRED (no batch consumed, no version created) instead of FAILED. The heuristic itself is unchanged and is now applied to the re-worded plan too; the true structural boundary (frozen design-origin inheritance + revalidation of persisted plans) is untouched. Regression tests: tripping-then-compliant plan applies; persistent violator stops at the bounded terminal. Verdict: **SECURITY OK FOR CURRENT SCOPE**.

## 9. Next best action

Commit the defect fix as a dedicated commit, deploy that exact SHA, then resume issue #30 from the second-publication requirement (Revision Request → Release Ready → Approval → second Publication → Rollback capability + execution + stale-capability rejection → final gates).
