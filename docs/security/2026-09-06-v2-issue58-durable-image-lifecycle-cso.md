# CSO — Issue #58: Durable KIE Image Job Lifecycle

Date: 2026-09-06
Scope: `src/domain/image-orchestration.ts` (new), `src/domain/image-pipeline.ts`,
`src/lib/kie-v2.ts`, `src/domain/build-pipeline.ts`,
`src/workflows/website-build-workflow.ts`, `src/env.d.ts`, `wrangler.jsonc`,
`tests/v2-image-orchestration.test.ts`.
Classification: ORCHESTRATION ONLY — image spend, acceptance and immutability
semantics are preserved; no new routes, secrets or externally reachable inputs.

## 1. Security scope

- KIE submission is an external side effect with real cost. The change
  replaces an in-step busy-poll with a durable submit → sleep → poll state
  machine. Secrets handling is unchanged (KIE_API_KEY stays a Worker secret,
  read only inside the retained adapter).

## 2. Attack-surface view

- No new endpoints. The existing `/api/internal/kie-callback` receiver is
  untouched and remains ack-only.
- New D1 writes go to the existing `image_attempts` and
  `stage_execution_claims` tables via parameterized queries only.
- New env vars (`KIE_POLL_INTERVAL_MS`, `KIE_ATTEMPT_TIMEOUT_MS`) are
  non-secret operational configuration with safe defaults and parse guards.

## 3. Findings

- **Spend safety improved (verified):** the deterministic estimate
  (`estimateCost`) lets the hard USD 3.00 gate reject BEFORE a remote task is
  created — previously a rejected task was still created remotely and
  orphaned. Overlapping executions cannot co-submit: the #54 execution-claim
  mechanics serialize submitters per deterministic
  (build version, slot, attempt, prompt hash, parameters) identity, and the
  overlapped loser yields transiently (tested).
- **Bounded residual window (accepted):** an engine kill between the remote
  createTask response and the local task-id persist can orphan one remote
  task that a replay cannot discover (KIE has no idempotency key). Exposure
  is one HTTP round-trip wide, the claim lease serializes it, and the hard
  gate bounds cumulative spend. Documented in the module header.
- **Provider payloads:** temporary provider URLs remain audit-only columns;
  they never ship and are not logged beyond the existing charge log.
- **Replay safety:** every acceptance write is guarded by the attempt's
  'pending' status or `ON CONFLICT DO NOTHING`; accepted-image immutability
  triggers are untouched.

## 4. Verdict

SECURITY OK FOR CURRENT SCOPE.
