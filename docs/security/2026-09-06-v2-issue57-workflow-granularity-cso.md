# CSO — Issue #57: Remove the Monolithic Outer Pipeline Step

Date: 2026-09-06
Scope: `src/workflows/website-build-workflow.ts`, `tests/v2-workflow-granularity.test.ts`, `vitest.config.ts`
Classification: ORCHESTRATION ONLY — no new routes, secrets, inputs, or data access.

## 1. What was audited

The removal of the enclosing `step.do("2.0 run REFERENCE_BOUND pipeline to terminal state", …)`
envelope. `run()` now orchestrates `runBuildPipeline` directly; each pipeline
stage remains an individual durable step with the same per-stage retry policy
(`STAGE_STEP_RETRIES`, limit 8, repo-owned backoff + IN_PROGRESS lease wait)
and per-attempt timeout ("10 minutes"), and the same `toWorkflowStepError`
NonRetryable mapping. The #56 terminal-failure try/catch and step 1.0 are
unchanged.

## 2. Attack-surface view

- Workflow entry: unchanged — instances are created only by the existing
  authenticated onboarding/revision routes. No new externally reachable path.
- Secrets: none touched (KIE/AI gateway bindings untouched).
- Input handling: none changed.
- D1 access: same parameterized queries; replayed orchestration re-runs only
  idempotent writes (`ON CONFLICT DO NOTHING` / `INSERT OR IGNORE` paths that
  already ran under outer-step retries pre-#57).

## 3. Findings

No new findings. Notes:

- **Replay exposure unchanged (verified):** non-step orchestration code
  (intake, repair-state reconstruction, artifact inheritance) re-executes on
  every engine wake-up exactly as it did under outer-step retries; all writes
  on those paths are idempotent by design (issues #34/#54 evidence).
- **Denial-of-wallet posture improved:** a slow image provider can no longer
  invalidate and re-drive the whole pipeline (the failure that killed three
  production generations); step-level retry bounds are retained per stage.
- **DoS:** no unbounded loops introduced; stage steps keep explicit timeouts.

## 4. Verdict

SECURITY OK FOR CURRENT SCOPE.
