# CSO — V2 main reconciliation merge (local SIMPLE main + remote doc-only commits)

Date: 2026-09-09
Scope: merge commit `4112e3b` on `main` — `git merge --no-ff origin/main` (42da846) into local SIMPLE main (f98bf97).
Prior baseline: `docs/security/CSO-2026-09-09-four-page-hero-nano-banana.md` — SECURITY OK WITH WATCH ITEMS.

## 1. What was audited

- Remote-only commits merged: `42da846`, `5d68a16`, `75ba670`, `b451b15` — all classified DOCS_ONLY (each touches `AGENTS.md` only; verified via `git show --stat`).
- Reconciled tree vs the previously CSO-reviewed SIMPLE state: diff of `4112e3b` vs `f98bf97` is `AGENTS.md` only (1 file, +171/−4). No `src/`, `migrations/`, wrangler config, package, test, or secret-handling file changed.
- Ancestry proven: `42da846` and `f98bf97` are both ancestors of `4112e3b` (`merge-base --is-ancestor` OK both ways).

## 2. Exposure re-verification on the reconciled tree

| Claim | Evidence | Status |
|---|---|---|
| `EXP_BENCHMARK_DRIVER` absent from production config | `grep EXP_BENCHMARK_DRIVER wrangler.jsonc` → no match; present only in `wrangler.exp.jsonc` (sandbox) | PASS |
| Benchmark driver route double-gated | `src/routes/v2.exp-benchmark-driver.ts:131` 404s unless var === "1"; HMAC `X-Signature` verified at :137 (`EXP_BENCHMARK_SECRET` → `WEBHOOK_SECRET` fallback) | PASS |
| No secret values in wrangler configs | grep for secret/token/password/api_key in `wrangler.jsonc`/`wrangler.exp.jsonc` → none | PASS |
| SIMPLE default pipeline | `wrangler.jsonc:130` + `wrangler.exp.jsonc:91` pin `DESIGN_PIPELINE_VERSION=simple_blueprint_v1`; code default `simple_blueprint_v1` (`src/simple-design/pipeline.ts:57`) | PASS |
| Full suite on reconciled main | 615/615 (69 files), typecheck PASS, `wrangler deploy --dry-run` PASS both configs | PASS |

## 3. Watch item re-affirmation (unchanged by this merge)

1. **Driver KIE spend / version creation** — sandbox-only by config + route guard; the merge did not change either. Stands as before.
2. **Model-generated blueprint → builder/QA prompt-injection surface** — pre-existing; deterministic gates (hero media, truth lint, slot conformance) unchanged. Stands as before.
3. **`.tmp-nb` client `sql-probe` detail interpolation** — operator-only, HMAC-gated, gitignored; untouched. Stands as before.

## 4. Verdict

**SECURITY OK WITH WATCH ITEMS** — identical posture to the accepted SIMPLE baseline. The reconciliation merge adds documentation only; no new security surface; production remains untouched (no deploy run in this phase).
