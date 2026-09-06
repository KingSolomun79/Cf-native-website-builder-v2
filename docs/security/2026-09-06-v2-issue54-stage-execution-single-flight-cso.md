# CSO Report — Issue #54: Single-Flight Execution for Immutable Provider-Backed Stages

Date: 2026-09-06
Scope: `migrations/0033_v2_stage_execution_claims.sql`, `src/domain/stage-execution.ts` (new), `src/domain/site-generator.ts` (runOrReuse + assembly-repath routing), `src/workflows/website-build-workflow.ts` (terminal-collision → NonRetryableError mapping), `tests/v2-stage-single-flight.test.ts` (new), `vitest.config.ts`, one assertion added to `tests/v2-site-generator.test.ts`.

## 1. What was audited

The #54 single-flight mechanism: an atomic D1 execution claim inserted before every provider call in the shared immutable stage-generation boundary, with lease-based stale-owner takeover, crash recovery, a collision safety net, and non-retryable mapping for terminal corruption at the workflow boundary.

## 2. Security scope

- Auth: no route or auth changes. No new endpoints; claims are written only by server-side generation code.
- Secrets: none touched; none stored. Claim rows carry opaque ids, sha256 fingerprints/checksums, ISO timestamps. Prompt content is never stored in claims (only its sha256).
- Input handling: no user-controlled input reaches the new SQL. Execution keys/fingerprints derive from server-side build identity and PAGE_IDS constants. All statements are parameterized (`?n` binds); no SQL interpolation of dynamic values.
- D1/data access: one new V2-only table (`stage_execution_claims`); migration 0033 is additive (`CREATE TABLE/INDEX IF NOT EXISTS`). `website_factory_v1` untouched.
- Spend/availability (the risk this change exists to close): duplicate LLM calls from overlapping workflow attempts.

## 3. Attack-surface summary

No new externally reachable surface. The change moves coordination state (previously implicit in artifact-store collisions) into an internal D1 table. The relevant "attacker" here is platform concurrency: overlapping workflow attempts racing the provider call. Those now serialize on a primary-key INSERT + conditional UPDATE.

## 4. Findings

1. **Verified (design, mitigated): unbounded claim-row growth.** Claim rows are never deleted; one row per (Build Version, artifact kind, subkey) ≈ same cardinality as `build_stage_artifacts` (~13 rows per build version observed). No FK/cascade cleanup exists. Not a blocker at this volume; belongs in the V2 retention pass (`src/domain/retention.ts`).
2. **Verified (fail-closed): migration-missing behavior.** If `stage_execution_claims` were absent, the claim INSERT throws and the stage fails loudly — the system never degrades to unprotected provider calls. Correct posture.
3. **Verified (bounded): stuck-claim availability.** A live IN_PROGRESS claim blocks a slot at most one lease (660s = 2 × the gateway's 300s per-attempt provider bound + overhead), after which an atomic conditional-UPDATE takeover admits exactly one contender. No busy-wait loops are introduced; waiting rides the existing bounded workflow retry policy (8 attempts, exponential).
4. **Watch item: clock skew on lease comparison.** Lease expiry compares ISO strings produced on different isolates. Cloudflare clocks are NTP-synced and the lease carries ~60s headroom; residual skew can only lengthen a dead owner's exclusivity by seconds-to-minutes within an already bounded window.
5. **Verified: no plaintext promotion.** Error messages and claim metadata expose build ids, artifact slot names, and truncated fingerprints only — consistent with existing `build_stage_artifacts` provenance visibility.

## 5. Severity summary

- Critical: none
- High: none
- Medium: none
- Low: 1 (claim-row retention — deferred to retention pass, tracked as watch item)

## 6. Required remediation

None blocking.

## 7. Watch items

- Add `stage_execution_claims` cleanup to the V2 retention sweep when retention next touched.
- Observe lease-expiry takeover latency in the next production experiment (expected: single takeover, zero duplicate provider calls).

## 8. Final security verdict

**SECURITY OK** for the audited scope.

## 9. Next best action

Commit #54 with its gates (45 files / 357 tests, typecheck, dry-run — all green), then proceed to #55 (explicit CPU budget + profiling).
