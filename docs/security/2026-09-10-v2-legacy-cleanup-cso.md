# CSO — Legacy design-pipeline cleanup (C1–C10, branch `cleanup/remove-legacy-design-pipeline`)

Date: 2026-09-10 · Scope: commits `1093342..HEAD` from `f2e79d9` (deletion-only refactor + deterministic ORIGINAL_DESIGN lock).

## 1. What was audited

- Removal of 10 legacy design modules, the benchmark/proof-gate cluster, legacy QA-A/QA-B LLM stages, 12 legacy prompt bodies, legacy tests/fixtures, and the runtime pipeline selector.
- The NEW deterministic `ORIGINAL_DESIGN_NOT_ENABLED` lock (`src/domain/original-design-lock.ts`) and its integration points: `lifecycle.createInitialBuild` (throws), `revision.createRevisionBuild` (`RevisionError ORIGINAL_DESIGN_NOT_ENABLED` → HTTP 423), `build-pipeline` (terminal `HUMAN_REVIEW_REQUIRED`), `stage-failure` (`TERMINAL_INVARIANT` — no retry burn on a deterministic refusal).
- Shared extractions (`fact-lint.ts`, `site-contracts.ts`), prompt-transport consistency (manifest pruned, `requireBody` throws on dangling entries), test-config flip (`simple_blueprint_v1` / `nano-banana-2-lite`).

## 2. Security scope

No auth, secrets, payment, webhook, or public-endpoint code was added or altered. `src/routes/` diff vs `f2e79d9`: ONE line in `v2.revision-request.ts` (error-code map key rename `ORIGINAL_DESIGN_LOCKED` → `ORIGINAL_DESIGN_NOT_ENABLED`, same 423 status). `lib/operator-capability.ts`, `lib/crypto.ts`, `wrangler.jsonc` (production), all secret bindings: untouched. The benchmark driver route is byte-unchanged and remains double-gated (`EXP_BENCHMARK_DRIVER !== "1"` → 404; HMAC `X-Signature`).

## 3. Attack-surface summary

- **Surface reduced**: the legacy design chain, its prompt bodies (−433 KB of embedded prompt text), the benchmark harness, and the A/B selector are gone — fewer code paths, fewer prompt-injection payloads embedded in the Worker bundle, no executable legacy path.
- **ORIGINAL_DESIGN handling is strictly more secure than before**: the retired proof gate was a dynamic-import benchmark check; the replacement is a pure deterministic throw, classified `TERMINAL_INVARIANT` so a locked-mode Build fails fast (single NonRetryableError, reconciliation applies the terminal once) instead of burning retries. No fallback to REFERENCE_BOUND, no silent mode conversion (tested).
- **Form/security contract untouched**: the SIMPLE builder/site-repair prompts (the only remaining stage prompts) keep the central Form Service rules; truth lint (fabrication protection) moved verbatim to `fact-lint.ts` and is enforced on every candidate by bundle QA (tested).

## 4. Findings

None new. Verified non-issues: (a) empty `siteId` placeholder in the locked-mode terminal outcome is never consumed downstream (workflow reads only buildId/terminal/reasons); (b) `CoordinateSpace`/legacy kind strings remaining in schemas/migrations are provenance/history compatibility, not executable paths; (c) the retained `runImageWave` sync implementation is test/reference-only, reachable by no route.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 new. Prior watch items stand unchanged (driver KIE-spend sandbox-only; blueprint→builder prompt-injection bounded by deterministic gates; `.tmp-nb` operator tooling untracked).

## 6. Required remediation

None.

## 7. Watch items

1. Benchmark driver retention (operator decision 2): keep sandbox-only until after first production smoke, then remove in its own commit.
2. Production config still `KIE_MODEL: "z-image"` — deployment blocker documented (`v2-docs/PRODUCTION-ROLLOUT-CHECKLIST.md`); the model fix belongs to the production-rollout GO.
3. Workers AI 8005 / Z.AI General 1210 transport resilience — tracked in `v2-docs/FOLLOW-UP-TRANSPORT-RESILIENCE.md`.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** (all three pre-existing/accepted; none introduced by this cleanup).

## 9. Next best action

Final pre-merge LIVE verification on the cleaned branch from the sandbox; merge only on pass.
