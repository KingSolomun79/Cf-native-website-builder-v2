# CSO Report — Issue #56: Workflow Terminal Failure → Domain Terminal State

Date: 2026-09-06
Scope: `src/domain/workflow-reconciliation.ts` (new — `failBuildForWorkflowTermination`, `reconcileWorkflowTerminations`), `src/index.ts` (scheduled sweep integration), `src/workflows/website-build-workflow.ts` (catchable-failure domain recording), `tests/v2-workflow-reconciliation.test.ts` (8 tests), `vitest.config.ts`.

## 1. What was audited

The reconciliation path that closes the silent-wedge gap: a Build whose workflow instance the platform reports errored/terminated is failed exactly once (state `FAILED`, reason `WORKFLOW_EXECUTION_EXHAUSTED`/`WORKFLOW_TERMINATED`, audit event with instance id and bounded cause), both via an in-workflow catch for catchable failures and via the existing cron sweep for resource-killed invocations.

## 2. Security scope

- Auth/routes: no route changes; no new endpoints. The sweep mutates state only from platform-attested workflow status (binding API), never from user input.
- D1: conditional `UPDATE builds … WHERE state = <observed>` is the exactly-once point; concurrent reconcilers race and only the winner audits. Terminal states (`RELEASE_READY`, `APPROVED`, `PUBLISHED`, `DEGRADED`, `FAILED`, `HUMAN_REVIEW_REQUIRED`) are excluded from selection — a successful build can never be flipped (tested).
- Secrets: none touched. Event details carry instance ids, reason codes, and truncated platform error strings — no credentials, no provider payloads.
- Operational: sweep is bounded (≤50 builds/run), per-row error isolation, shares the existing cron with the email sweep under independent try/catch so neither can break the other.

## 3. Findings

1. **Watch item (low, pre-existing class): failure detail on the public build record.** `GET /api/v2/builds/:id` is unauthenticated and serves workflow events; failure details now include truncated platform/provider error strings. This matches the existing exposure class (pipeline terminal events already carry vision-seam attempt details), and content is operator-diagnostic rather than sensitive — but a sanitized public view should be considered if provider diagnostics ever grow richer.
2. **Verified: no V1 impact.** All changes are V2 modules/bindings only.
3. **Verified: no unbounded mutation.** The sweep cannot create transitions loops — once FAILED, builds are excluded from selection; idempotency is tested.

## 4. Verdict

**SECURITY OK WITH WATCH ITEMS** (1 low watch item, above).

## 5. Next best action

Commit #56, then produce the WORKFLOW EXECUTION HARDENING REPORT and stop before deployment per the directive.
