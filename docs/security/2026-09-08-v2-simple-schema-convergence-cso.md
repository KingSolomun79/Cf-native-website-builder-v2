# CSO — SIMPLE Blueprint Schema-Convergence Iteration (experiment branch)

Date: 2026-09-08 · Branch: `experiment/simplified-design-pipeline` · Base: `04511c6`
Scope: native Workers AI `json_schema` structured output for the SIMPLE Design Blueprint stage; design-blueprint/1 constraint reclassification (STRUCTURAL / SAFETY-AUTHORITY hard; DESIGN PREFERENCE relaxed); prompt `simple-design-blueprint` v3; `schema-canary` op in the experiment benchmark driver.

## 1. What was audited

- `src/lib/ai-streaming.ts` — `StreamingJsonSchema` request option (both transports), request-defect fail-fast classification for the Workers AI dispatcher.
- `src/domain/ai-boundary.ts` — `nativeJsonSchema` flag suppressing the prose output-contract suffix.
- `src/simple-design/contracts.ts` — color-role typed array, composition/generation ratio separation, role-aware measure floors, `DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA` export.
- `src/simple-design/design-blueprint.ts`, `vision.ts`, `render-blueprint.ts`, `pipeline.ts` — wiring/renderer/bridge updates.
- `src/routes/v2.exp-benchmark-driver.ts` — new `schema-canary` op.
- Prompt body v3 + manifest bump; test/fixture updates.

## 2. Security scope

No auth flows, no payments, no form-service changes, no new public endpoints, no secret handling changes, no D1 schema changes, no production config changes. One new operation added to an already-gated operator route on the sandbox experimental Worker.

## 3. Attack-surface summary

- `POST /api/v2/exp/benchmark-driver` (`schema-canary` op): gated by `EXP_BENCHMARK_DRIVER === "1"` (set only in `wrangler.exp.jsonc`, sandbox Worker) AND HMAC `X-Signature` over the raw body — unchanged trust model, one more op inside the existing gate. The op triggers ONE bounded Workers AI completion (max_tokens 16,384; transport retries ≤ 3, fail-fast on request defects); no artifact writes, no D1 writes.
- Workers AI request payload now carries `response_format.json_schema` built from the static module-constant TypeBox schema (`DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA`). No user input flows into the schema payload; it is fully deterministic.

## 4. Findings

1. **Verified — no new unauthenticated surface.** The `schema-canary` case sits inside `expBenchmarkDriver` after both the feature flag and the HMAC verification (re-read post-change). Cost exposure equals the existing `stream-canary-*` ops.
2. **Verified — no secret material in the new payload path.** `json_schema` contains only the artifact contract; request bodies are never persisted to R2/D1 by the canary op.
3. **Verified — authority semantics not weakened.** `businessFactsRef` remains the only facts pointer; the amended schema still rejects unknown top-level properties (`additionalProperties: false`), so a model-injected `businessFactSheet`/`facts` key is structurally impossible (covered by new tests). Relaxed constraints are strictly design-preference class (ratio spelling, color role names, narrow display measures).
4. **Verified — repair bounds unchanged.** ONE targeted structural repair (boundary loop ≤ 2 attempts), transport retries bounded and now fail fast on deterministic request defects — no new unbounded loop.
5. **Watch item — fail-fast regex breadth.** `/response_format|json_schema|unsupported|not supported/i` classifies a transient provider error mentioning "unsupported" as non-retryable. Availability impact only (terminal stage error → operator review), not a security exposure. Acceptable for the experiment.
6. **Watch item — pre-existing.** The sandbox Worker runs with `EXP_BENCHMARK_DRIVER=1` on a public URL; HMAC-gated and branch-only by design (documented in prior CSO: 2026-09-08-v2-simple-pipeline-experiment-cso.md). Unchanged by this iteration.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 1 (watch item 5) · Watch: 1 (pre-existing, item 6).

## 6. Required remediation

None for this scope.

## 7. Watch items

- If the Workers AI path reaches production provider policy decisions, replace the fail-fast regex with structured error codes rather than message matching.
- The legacy V1 invocation of these stages is unaffected; final V2 release must still remove superseded paths per the brownfield rule.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — proceed with the §16 schema canary and the ONE real Morabeza blueprint on the experimental runtime. No production deployment in this scope.

## 9. Next best action

Deploy the experimental Worker config, run the schema canary, then the single real blueprint against the frozen Morabeza capture; report and STOP for operator review.
