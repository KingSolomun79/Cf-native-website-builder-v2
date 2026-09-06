# CSO Report — Issue #55: Explicit Workflow CPU Budget + Profiling

Date: 2026-09-06
Scope: `wrangler.jsonc` (top-level `limits.cpu_ms: 120000` + documented reasoning), `src/domain/reference-analysis.ts` (per-invocation memoization of vision-input preparation + `vision_input_prep` timing log), `src/domain/site-generator.ts` (`stage_cpu_timings` validation log), `tests/v2-cpu-budget.test.ts`, `tests/v2-vision-seam.test.ts` (memoization + log tests), `tests/v2-site-generator.test.ts` (timing-log test), `vitest.config.ts` (generated config transport), profiling harness `.tmp-run-post53/profile-cpu.ts` (local-only, uncommitted evidence).

## 1. What was audited

CPU-limit hardening after production build 91764d47 died repeatedly on the 30s default limit: profiling with real production artifacts, an explicit CPU budget, and profiling-driven removal of redundant hot-path work.

## 2. Security scope

- Secrets: none touched. Timing logs carry durations and byte counts only — asserted by test to exclude prompt/response payloads.
- Auth/routes: unchanged.
- Config: `limits.cpu_ms` applies to the V2 worker (`cf-website-factory-v2`) only. V1 worker and `website_factory_v1` untouched. Staging inherits the same limit (no override declared — asserted).
- Availability: the raised ceiling (120s, >4× the measured deterministic floor, under the 300s platform max) keeps genuinely runaway invocations failing fast into the #56 reconciliation path rather than hanging.

## 3. Findings

1. **Verified (mitigated): memory cost of memoization.** The prepared wire payload (~2–4MB per oversized reference) is retained per seam instance for the invocation's lifetime; instances are per pipeline-step invocation, so there is no cross-request growth. Isolate memory limits are unaffected at this scale.
2. **Watch item: cross-invocation preparation.** Blueprint/analyzer step retries construct fresh seam instances and re-pay preparation. The observed CPU deaths were in the generation step (~13 calls per invocation), which the memoization covers; if profiling logs (`vision_input_prep` lines in worker logs) show the analyzer stage also saturating CPU, a durable prepared-artifact cache can be considered in a follow-up.
3. **Verified: no sensitive data in logs.** `vision_input_prep` and `stage_cpu_timings` lines carry stage/build-id/ms/bytes/finding-count fields only.

## 4. Verdict

**SECURITY OK** for the audited scope.

## 5. Next best action

Commit #55, then implement #56 (workflow terminal failure → domain terminal state).
