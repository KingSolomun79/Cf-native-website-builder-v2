# #19 CSO — Benchmark Site 2 canonical run (bench-02-hospitality-image-heavy)

Date: 2026-09-16 · Scope: #19 execution — canonical benchmark run through the
production operator benchmark-driver; **no source-code changes** (docs-only
issue). Companion evidence: `docs/benchmarks/2026-09-16-issue-19-bench-02-hospitality-image-heavy-run.md`.

## 1. What was audited

The #19 execution end-to-end: pre-run verification, capability minting and
use, the freeze/preflight/run/record driver phases against the production
`cf-website-factory-v2` deployment, read-only D1/R2 evidence collection, and
the documentation to be committed.

## 2. Security scope

- Auth: offline-minted, action- and case-bound operator capability tokens on the benchmark-driver route.
- Secrets: `OPERATOR_CAPABILITY_SECRET` handling during minting; no other secret approached.
- Provider spend: KIE image budget under the USD 3.00 hard gate.
- Production state: pipeline-created rows/objects only; no manual D1/R2/Worker mutations.
- No new code paths, routes, schemas, bindings or prompts — nothing to attack was added.

## 3. Attack-surface summary

The only surface exercised was `/api/v2/operator/benchmarks/bench-02-hospitality-image-heavy/{freeze,preflight,run,record}` and `/runs/:runId` on the production deployment. The route fails closed: this session's two malformed-token requests (multi-line mint output pasted into the Authorization header) were both rejected **401 CAPABILITY_REQUIRED** before any capability check succeeded, and the route rejected the very first no-auth probe with 401. Valid tokens were single-case-bound (`v2opcap/1:benchmark:bench-02-hospitality-image-heavy:{exp}`), ≤ 60-minute TTL, incapable of approve/publish/rollback by construction.

## 4. Findings

No Critical, High or Medium findings. Two Low/watch-grade observations:

- **W19-1 (Low, documentation-grade): multi-line mint output is an operator trap.** `scripts/mint-operator-capability.mjs` prints human-readable lines before the token; piping full stdout into a header yields an invalid token and a 401. Impact: fail-closed (safe direction), but during an incident a silent secret mismatch and this cosmetic failure are indistinguishable from the caller's side. Suggested future hardening: `--quiet` flag printing only the token (this would be a code change — out of #19's docs-only scope; recorded for a future infra ticket, not #23).
- **W19-2 (Watch item, pre-existing): production-signing secret has a plaintext local copy.** The production `OPERATOR_CAPABILITY_SECRET` equals the value in the gitignored `.dev.vars` of the trusted local checkout (pre-existing condition, documented in the #48 rollout runbook). #19 neither widened nor relied on this beyond the documented operator model; rotation guidance remains as recorded in the #48 CSO.

Verified-good behaviors observed live: driver fail-closed 401s (three distinct unauthorized probes); capability binding held on every phase; zero secret values printed, logged or committed (only names, presence booleans and hash/prefix material); token scratch files deleted after use; provider spend ledgered at $0.70 ≤ $3.00 with no budget-path bypass; all production writes were pipeline-authored and retention-tracked (run evidence on the 180-day `benchmark-run-evidence` class).

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 1 (W19-1, documentation-grade) · Watch items 1 (W19-2, pre-existing).

## 6. Required remediation

None for this issue.

## 7. Watch items

W19-1 and W19-2 above; carry forward the #18 note that per-version QA capture
PNGs are referenced inside `qa_evidence_bundle.json` but not individually
indexed by the retention sweep (`indexBenchmarkEvidenceKeys`) — relevant again
for this run's 9 captures under the 180-day class (#23 scope).

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — no blocking findings; the benchmark driver's
auth posture was positively verified in production during this run.

## 9. Next best action

Record #19 PASS evidence, close #19, and proceed to #20 (Benchmark Site 3)
under the same frozen harness and per-ticket gates.
