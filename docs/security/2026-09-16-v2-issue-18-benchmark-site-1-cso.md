# CSO — Issue #18: Benchmark Site 1 validation (bench-01-editorial-asymmetric)

Date: 2026-09-16 · Scope: commits `a8839a5`, `41346a5` + uncommitted evidence doc
· Verdict: **SECURITY OK WITH WATCH ITEMS** (0 blocking)

## 1. What was audited

The #18 diff against `2471d31` (#17): new operator benchmark-driver routes
(`src/routes/v2.benchmark-driver.ts`), a new `benchmark` operator-capability
action (`src/lib/operator-capability.ts`), offline minting support
(`scripts/mint-operator-capability.mjs`), route tests, and the operational
actions performed to execute the run (production deploy of committed SHA
`41346a5` → version `93ff94d2-9906-4f79-a2c4-0e87a25991ff`; remote D1
migrations 0038/0039 applied; one recorded provider-budget run
`e5e06c81-6ae0-4fb5-bf2b-3ac2fc35ce56`).

## 2. Security scope

Auth/authorization (new capability action + four gated endpoints), operator
tooling, cost-bearing operations (real provider budget), D1/R2 writes in the
production V2 environment, and secret handling in outputs/logs/docs.

## 3. Attack-surface summary

`/api/v2/operator/benchmarks/:caseId/{freeze,preflight,run,record}` and
`GET /api/v2/operator/benchmarks/runs/:runId` on the production Worker. Every
endpoint requires an offline-minted `benchmark` capability bound to the exact
`caseId`; there is no minting route (unchanged invariant). Without a token:
401 (fail-closed, verified live pre-authentication). With a wrong-action or
wrong-case token: 403. Verified denial order is identical to the existing
Approval/Publication/Rollback routes.

## 4. Findings

No Critical or High findings. Verified safe properties:

- **Capability binding:** canonical form `v2opcap/1:benchmark:<caseId>:<exp>`
  is HMAC-SHA256 over a distinct prefix/arity — a benchmark token cannot be
  replayed as approve/publish/rollback and vice versa. `caseId` is constrained
  to `BOUND_VALUE` (no `:` smuggling), expiry is checked with the existing
  60-minute ceiling, and verification fails closed when the secret is absent.
- **No secret exposure:** preflight returns presence booleans and non-secret
  configuration only (model IDs, base URLs, gate constants). No secret value
  is echoed, logged, or documented. The minted token was kept in a gitignored
  `.tmp-*` path and deleted; never committed.
- **Injection:** all D1 access is parameterized (`.bind`); `codeRevision` is
  strictly `^[0-9a-f]{40}$`; `caseId` is allow-listed to the five frozen cases
  before any write; arbitrary workflow-instance ids only reach the platform
  `get()` (failure → caught → durable Build-state fallback).
- **Blast radius of a leaked benchmark token (≤60 min):** freeze (idempotent,
  drift-refusing), one-or-more seeded runs (each ≤ USD 3 image gate + LLM
  spend), record of a terminal build, read-back of run rows (no secrets).
  Cannot approve, publish, roll back, or read client data.
- **Data integrity:** `benchmark_runs` remains append-only (no-delete trigger);
  the record endpoint can only translate states the pipeline itself set
  (terminal Build states; durable workflow output preferred). The executed run
  was recorded with zero manual source edits and the frozen definition hash
  pinned.
- **Production deploy hygiene:** deployed from a clean working tree at the
  exact committed SHA; deployment version recorded; migrations 0038/0039 are
  additive and belong to the V2 database only.

## 5–7. Severity summary, remediation, watch items

No required remediation. Watch items (none block #18):

- **W18-1 (Low):** `/run` has no per-case concurrency guard — repeated seeds
  by a token holder amplify provider spend. Mitigated by the 60-minute TTL,
  the USD 3 per-run image gate and operator discipline (W17-2). Revisit if
  tokens are ever shared beyond the operator.
- **W18-2 (Low):** `/run` and `/record` read unbounded JSON bodies before
  validation. Only reachable with a valid capability; a size cap would be
  cheap hardening for #19–#22.
- **W18-3 (Low):** QA capture PNGs (`…/evidence/qa/*.png`) are referenced in
  `qa_evidence_bundle.json` but not individually indexed by
  `indexBenchmarkEvidenceKeys` for the 180-day benchmark evidence class — a
  retention-coverage nuance to resolve with the #23 proof gate.
- **W18-4 (Info):** production now carries the capability-gated benchmark
  driver surface (supersedes #17's "no route" statement, which described #17's
  scope). Intentional and documented; keep it gated in all future deploys.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS.**

## 9. Next best action

Close #18 as a completed VALID FAIL (run `e5e06c81`); carry W18-1…W18-3 into
the #19–#22 operator procedure and the #23 proof-gate work.
