# CSO — Website Builder V7: File-Sized Realization Calls (fix/simple-builder-file-realization)

- **Date:** 2026-09-11
- **Scope:** working tree of `fix/simple-builder-file-realization` (base `cleanup/remove-legacy-design-pipeline` @ `86ad265`)
- **Operator GO:** "WEBSITE BUILDER V7 — ONE SHARED BUILDER STAGE, FILE-SIZED REALIZATION CALLS" (2026-09-11)
- **Predecessor audits:** `2026-09-10-v2-builder-glm53-model-routing-cso.md` (its hardening — the driver `model` allowlist/pin — is carried forward verbatim)

## 1. What was audited

- `src/lib/workers-ai-file.ts` (new): raw single-file Workers AI transport — stream=false, NO response_format, `chat_template_kwargs.enable_thinking=false`, `max_completion_tokens`; bounded 3-attempt transport policy; OUTPUT_EXHAUSTED fail-closed.
- `src/domain/ai-boundary.ts`: `runAiFileStage` (one semantic generation per file call, deterministic per-file validation, ai_stage_runs + immutable R2 run artifact persistence), `parseSingleFileSource` normalization, `reasoningControl` provenance.
- `src/simple-design/builder-file-realization.ts` (new): deterministic per-file structural validation + meta/reasoning-debris marker scan.
- `src/simple-design/website-builder.ts`: rewrite to `SIX_CALL_FILE_REALIZATION` on `WEBSITE_BUILDER_MODEL = @cf/zai-org/glm-5.3`; the former ONE_CALL/TWO_CALL strategies and transport diagnostic deleted.
- `src/routes/v2.exp-benchmark-driver.ts`: `structured-canary`/`structured-qualification`/`builder-diagnostic` replaced by `file-canary`/`file-qualification` plus the experiment-only `file-css-probe` diagnostic (added after the qualification exhaustion to measure the model's natural css output size; never a pipeline path).
- Prompt `simple-website-builder/v7` (contract, body, PROMPT-MANIFEST, regenerated bodies); pipeline/repair/visual-QA ripples; test/helper adaptations.

## 2. Security scope

Sensitive domains touched: experiment admin tooling (benchmark driver route), AI provider invocation (Workers AI binding), R2 artifact persistence, cost telemetry. NOT touched: authn/authz of production routes, form-security rules, payments, publication/approval semantics, secrets handling, D1 access patterns outside the existing `ai_stage_runs` insert.

## 3. Attack-surface summary

1. **`POST /api/v2/exp/benchmark-driver`** (sandbox-only; `EXP_BENCHMARK_DRIVER !== "1"` 404s; HMAC `X-Signature` over the raw body required — both unchanged this round). New ops:
   - `file-canary` — caller-supplied `model` is accepted **only** from the allowlist `["@cf/zai-org/glm-5.3-flash", "@cf/zai-org/glm-5.3"]`; `maxCompletionTokens` is a caller-supplied number passed as the provider output bound (bounded by the constant budgets in the Builder; the canary probes provider acceptance only, one call).
   - `file-qualification` — caller-supplied `model` is accepted **only** if it equals the routed Builder constant; anything else returns `FAILED` without invoking the provider. Six Builder calls max per invocation, each output-bounded by the per-file `max_completion_tokens` constants.
   - The driver still cannot act as a generic model runner: every reachable `env.AI.run` model argument is a compile-time constant or an allowlist member.
2. **Workers AI invocation** (`env.AI.run`): body carries system/user prompts (internal pipeline content, not client input), `stream:false`, token bound, reasoning switch. No secrets, no client-controlled fields. `console.info` logs label/duration/finish-reason/token counts/char counts only — never prompt or file content; error snippets are transport error messages capped at 300 chars.
3. **Artifact persistence**: per-call run artifacts (raw realized file + provenance) persist to the existing immutable `builds/{buildId}/v{n}/ai/` R2 layout via the same helper the schema boundary uses; invalid realizations persist a run row with `outcome='invalid'`, `artifact_r2_key=null`, and an error summary — no partial file is ever stored as a stage value.
4. **Generated-code trust model**: unchanged. Realized files flow through the same assembly, Technical Preflight, truth/technical QA, Visual QA, and ONE-repair gates as before. The new validation gate strictly reduces the chance that non-source output reaches those gates.

## 4. Findings

No Critical or High findings.

**Medium: none.**

**Low / hygiene (verified, accepted for current scope):**
1. `file-canary` accepts an unvalidated `maxCompletionTokens` number from the (HMAC-authenticated) operator and forwards it as the provider's output bound on a single canary call. Impact: a canary call could generate up to that provider-max output once. Mitigation: the op is dual-gated (env var + HMAC) and sandbox-only; the Builder pipeline itself always uses compile-time constants. Accepted as operator tooling.
2. Error snippets from transport failures (≤300 chars) can surface binding error text in driver responses and D1 `error_summary`. These are provider/binding messages, not prompt content or secrets. Accepted.

**Watch items:** none new. The prior round's invariants (driver model allowlist/pin; no automatic model substitution; fail-closed exhaustion) are preserved and re-tested (`tests/v2-builder-file-realization.test.ts` §3–§12, §21).

## 5. Severity summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 2 (accepted, operator-tooling scoped)

## 6. Required remediation

None required for this scope.

## 7. Watch items

- Keep the `file-canary`/`file-qualification` ops sandbox-only; they must never appear in production config (`EXP_BENCHMARK_DRIVER` absent from `wrangler.jsonc`/`wrangler.test.jsonc` — verified this audit).

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

## 9. Next best action

Commit the tranche, deploy the sandbox from the committed SHA, and run the raw canary + six-call qualification against the FINCH_V2 fixture.
