# CSO Security Sign-Off — Issue #16 (Deployment and Artifact Retention Lifecycle — enforcement wiring)

**Date:** 2026-09-15
**Scope:** Diff since `30da7f0`: `src/domain/retention.ts` (extended), `src/index.ts` (cron wiring), `tests/v2-retention.test.ts` (13 new scenarios).
**Baseline:** prior #16 implementation `a0d8128` (2026-09-01) whose CSO gated scheduled-trigger exposure as watch item **W8** — resolved by this diff.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited

Enforcement of the retention lifecycle: bounded cron sweep wiring (the prior W8 exposure precondition), per-item protection re-read before every destructive delete, per-item cleanup-failure isolation, open-publication-right protection, the bounded artifact-prune driver with canonical `benchmark_runs`-derived benchmark exemption, and removal of the dead `BENCHMARK_EVIDENCE_RETENTION_DAYS` constant (duration genuinely unspecified in canonical docs — reported as an operator decision, not invented here).

## 2. Security scope

High-risk by classification: destructive operations (Workers Scripts API deletion + R2 object deletion) now execute automatically on the `*/10 * * * *` cron. No new HTTP surface — cron triggers are internal by default; no route was added, satisfying W8's precondition (any future route form must carry the operator HMAC or a capability token).

## 3. Attack-surface summary

- D1 reads: `build_deployments`, `site_published_state`, `builds`, `build_versions`, `build_stage_artifacts`, `reference_evidence_packages`, `image_attempts`, `build_approvals`, `publications`, `site_generations`, `benchmark_runs`.
- Destructive: Worker deletion via the audited CF API path (`deleteWorker`, existing `CF_API_TOKEN` scope, unchanged); R2 object deletion **only** by exact keys selected from D1 indexes.
- No visitor input reaches any deletion path. Worker names and R2 keys are operator-side generated identifiers.
- D1 rows are never deleted; cleanup mutates only `build_deployments.status` and R2 objects. Compact Build Records, approvals, publications, provenance and cost ledgers survive by construction.

## 4. Findings

### Verified properties (no finding)

- **Deletion authorization:** cleanup has no HTTP surface; the cron trigger is internal. No token, cookie, or visitor-supplied identifier participates in any delete decision.
- **Current publication protection, defense in depth (3 layers):** (1) the candidate SQL never selects `role='published' AND status='active'` rows; (2) the sweep-start protected set covers every Site's current published version; (3) a fresh per-item re-read (`isVersionProtectedNow`) immediately before each destructive delete is the authoritative gate. Test-proven: protection gained between selection and delete causes SKIP, not deletion.
- **Rollback protection:** the in-window Rollback Version is protected in all three layers; only the single canonical `ROLLBACK_WINDOW_DAYS` timer is used (no parallel timer). Expired non-rollback deployments are the only published-role deletions, after the window lapses.
- **Cross-site safety:** the protection set is computed globally across all Sites; `buildIds` scope narrows candidates only, never protection (test-verified).
- **No broad deletion:** no prefix/list deletes — R2 pruning uses the exact per-version key list indexed in D1; Worker deletion is by exact name. All SQL uses bound parameters (`IN (...)` lists parameterized).
- **Failure isolation:** a transport failure records the item (log + report), leaves the row intact for a later sweep, and mutates no publication/Build lifecycle state (test-verified, including that a later sweep retries successfully). Log values are sanitized (quotes stripped, 300-char cap), matching the standing sweep convention.
- **Benchmark evidence:** exempt from routine evidence/AI/QA pruning via the canonical `benchmark_runs` join; conservative direction (protects more, deletes less). Compact `benchmark_runs` rows are append-only by trigger.
- **Bounded work:** per-run caps (25 worker deletions, 10 version prunes) + candidate LIMITs; the cron cannot become an unbounded sweep. Non-destructive scans do not consume the destructive cap.

### W16-1 — 404 "already absent" match tightened (Fixed during this CSO pass)

The original in-diff tolerance matched any error message containing `"404"`, so an unrelated transport error mentioning "404" could mark a row `deleted` while its Worker still served — an orphaned preview invisible to future sweeps. **Remediated in this diff:** only the exact provider signal (`Worker deletion failed: 404`) counts as already-absent; everything else is an isolated, retriable failure. Retention suite re-run green.

### W16-2 — Residual re-read→delete window (Watch item, Low)

The per-item re-read and the CF API DELETE are not atomic; a publication that lands *inside* the deletion call itself could theoretically delete a just-reprotected Worker. Cloudflare's Workers Scripts API offers no conditional delete, so the window cannot be fully closed at this boundary; the implemented re-read immediately before deletion is the mandated mitigation, and the failing-side timing (re-publish requires an open publication right; rollback requires an unexpired window) makes the path narrow. Accept as inherent; revisit only if Cloudflare ships conditional deletes.

### W16-3 — Benchmark evidence retention duration unspecified (Watch item, Medium — operator decision, not a code defect)

PRD 22.3 defines only the distinction ("Benchmark evidence may be retained longer for reproducibility"); no canonical duration exists (none in FINAL-DECISION-RECORD, CONTEXT.md, or the capability envelope), and the prior run's unused `BENCHMARK_EVIDENCE_RETENTION_DAYS = 365` constant was removed rather than silently ratified. Current behavior: benchmark evidence/AI/QA payloads are exempt from routine pruning (indefinite until an operator decision says otherwise); benchmark failure evidence is deliberately preserved ahead of benchmark tickets #18–#22. **Decision requested from the operator:** ratify indefinite-until-decided retention or set an explicit duration. No duration was invented.

## 5. Severity summary

Critical 0 · High 0 · Medium 1 (W16-3, decision request) · Low 1 (W16-2). W16-1 fixed in-diff.

## 6. Required remediation

None remaining before commit.

## 7. Watch items

W16-2, W16-3, plus standing items (M1–M3, L2–L3, W1–W9 as previously filed). M1 lifecycle-read exposure remains separately tracked as issue #47 (not mixed into #16).

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — issue #16 may advance to its dedicated commit.

## 9. Next best action

Commit issue #16 with the verification evidence, then proceed to #17 (five-site REFERENCE_BOUND benchmark harness) per the mandated sequence.
