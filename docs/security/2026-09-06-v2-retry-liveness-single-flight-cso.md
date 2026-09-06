# CSO — Single-Flight Retry-Liveness (directive on top of #54–#56)

Date: 2026-09-06
Scope: retry-policy change only — `src/workflows/website-build-workflow.ts` (dynamic retry delay + explicit per-attempt timeout), `src/domain/stage-execution.ts` (`stageInProgressRetryAfterMs`, clamp, margin constant), `tests/v2-workflow-retry-liveness.test.ts` (new), `vitest.config.ts` (suite registration).

## 1. What was audited

The workflow step retry policy that carries the #54 `STAGE_EXECUTION_IN_PROGRESS` yield: delay-function-based wait until lease expiry, repo-owned exponential fallback, explicit `timeout: "10 minutes"`, and the new message-parse helper. No auth, secrets, endpoints, payment, or data-deletion surfaces touched.

## 2. Attack-surface summary

No new externally reachable surface. The only new input-processing path parses a timestamp out of an internal error message (the `StageExecutionInProgressError` message may arrive rehydrated as a plain `Error`). That message originates from our own claim row (execution key = sha256, ISO lease timestamp) — not from visitor or provider content.

## 3. Findings

### F1 (Low, fixed in this change) — unbounded wait from a corrupt "until" timestamp
`stageInProgressRetryAfterMs` originally returned the raw computed wait. A hostile/corrupt error message carrying a far-future timestamp could have stretched one stage step's retry wait indefinitely (per-build pipeline stall). **Remediation applied:** the computed wait is clamped to `[0, STAGE_EXECUTION_LEASE_MS + STAGE_EXECUTION_RETRY_MARGIN_MS]` — exactly the legitimate horizon of a fresh full lease. Verified by the expired-lease/stale unit tests.

### F2 (Informational) — retry waits are long by design
The IN_PROGRESS wait is up to ~675s. This is the required liveness behavior (one wait per overlap, then takeover), not churn: a contender consumes one retry slot per full-lease wait and the platform's step-retry cap (10,000) is nowhere near exhaustion. No error-storm path exists.

### F3 (Watch item, pre-existing) — unauthenticated build record endpoint still exposes truncated platform failure strings
Unchanged from the #56 CSO verdict. This change does not alter its exposure (it adds no new fields to any HTTP response).

### F4 (Informational) — test-only lease backdating
The simulated engine rewrites `stage_execution_claims.lease_expires_at` to simulate wall-clock progression. Strictly scoped to the test's own `build_id`, inside the test isolate's D1. No production path can backdate a lease (takeover remains the conditional-UPDATE CAS).

## 4. Severity summary

- Critical: 0 · High: 0 · Medium: 0 · Low: 1 (fixed in-change) · Watch items: 1 (pre-existing, unchanged)

## 5. Final security verdict

**SECURITY OK** — the change is internal retry scheduling; the one realistic weakness found (F1) is fixed and regression-tested in the same commit.
