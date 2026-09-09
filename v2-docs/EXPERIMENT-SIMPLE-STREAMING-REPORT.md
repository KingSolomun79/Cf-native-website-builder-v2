# SIMPLE STREAMING TRANSPORT REPORT

Branch: `experiment/simplified-design-pipeline`
Starting SHA: `22999d1`
Transport implementation SHA: this commit (benchmark-only descendants of `22999d1`)
Primary transport: **CLOUDFLARE_WORKERS_AI_STREAM** (§16 fallback — see §5 outcome below)
Provider/model: Z.ai GLM-5.3-flash — same model release, hosted by Cloudflare Workers AI as `@cf/zai-org/glm-5.3-flash` (explicit §16 experiment-only provenance exception; documented, never silently applied to production)
Endpoint: `workers-ai:@cf/zai-org/glm-5.3-flash` via `env.AI.run(..., { stream: true })`
Canonical model changed: **NO** (glm-5.3-flash; no alternate model, no OpenRouter model fallback, no GPT, no GLM-5.3, no GLM-5-Turbo)
Hosting/provider policy exception: **YES** (§16 — Workers AI runtime hosting; branch-only `wrangler.exp.jsonc` binding + env var, never in production config)

---

## §5 — First choice (Z.AI General API) outcome

```text
GENERAL_API_AUTH: PASS
MODEL_AVAILABLE: FAIL
```

The existing `ZHIPU_API_KEY` authenticates against `https://api.z.ai/api/paas/v4/chat/completions` (HTTP 429 would have been the billing gate; the model-name shape was accepted), but the account holds **Coding-Plan entitlement only**: error `1113 "Insufficient balance or no resource package. Please recharge."` Two secondary findings recorded for the operator: (a) the General API **rejects `thinking: {type:"disabled"}`** for this model with error `1210` ("always engages in thinking; use low, high, or max") — relevant to any future General-API work; (b) per §5, nothing was purchased and the option was stopped.

## What was built (§6-§13, §26)

One reusable streaming boundary — `src/lib/ai-streaming.ts` — used by the SIMPLE default seams behind `SIMPLE_STREAMING_TRANSPORT` (set only in `wrangler.exp.jsonc`):

- `generateStreamingCompletion` (Z.AI General API, SSE) and `generateWorkersAiStreaming` (Workers AI, SSE), dispatched by `generateSimpleStreamingCompletion`. POST once; `delta.content` assembled in order; `[DONE]` handled; `reasoning_content` never accumulated (§8); request ID + usage + TTFB/stream-duration/chunks recorded; ONE final string returned — nothing partial ever reaches artifacts (§9); schema validation, deterministic gate and immutable persistence happen exactly as before, after the stream completes (§10).
- Health = "stream remains active" (90 s stall abort; 600 s absolute cap) instead of "whole completion inside 120 s" (§12). No client-facing SSE (§13). Bounded transport retries only (3 attempts, exponential backoff); a healthy-but-slow stream is never retried (§11).
- §26: the sanctioned TWO-CALL SINGLE-STAGE fallback now fires on `StreamingTransportExhaustedError` (terminal transport failure) in addition to schema failure — tested.
- Streaming unit tests: `tests/v2-simple-streaming-transport.test.ts` (8 tests — SSE assembly, reasoning suppression, length-truncation acceptance, fallback eligibility).

## §14 / §17 — Canary A (long text, zero business)

**PASS.** 140-item structured JSON via Workers AI streaming:

| Metric | Value |
|---|---|
| Output tokens | **14,739** (≥12K required) |
| Duration | 331 s (**crossed the old 120 s boundary with a healthy stream**) |
| Time to first chunk | 676 ms |
| Frames consumed / finish | 1,849 / `stop` (complete content, no truncation, no duplicate request) |
| JSON valid | yes (140/140 items) |
| Cost | 671.6 Neurons |

(An earlier 120-item run: 11,457 tokens / 259 s / 522 neurons — also past the old ceiling.)

## §15 / §17 — Canary B (multimodal long output)

**PASS.** Frozen Morabeza full-page screenshot (3.46 MB, 1024×5447) + small diagnostic instruction:

| Metric | Value |
|---|---|
| Vision accepted | yes (prompt_tokens 5,279 incl. image) |
| Output tokens | 8,148 in 182 s, TTFB 1.46 s |
| Structured completion | 17 sections, JSON valid |
| Cost | 442.4 Neurons |

With the final serving shape (`enable_thinking:false` + `response_format:json_object`) the same canary returns clean valid JSON in 89 s / 4,124 tokens / 259 neurons.

## §19-§22 — Real Morabeza Design Blueprint

**NOT YET COMPLETE — blocker moved from transport to model-output schema conformance.** Transport evidence: the streamed blueprint calls now reliably COMPLETE (multiple 270-440 s streams, ~10K tokens, clean JSON). Four full runs failed at the deterministic schema gate on small enumerable constraints, each run a different subset (e.g. `aspectRatio` enum invented despite the exact enum being spelled in the prompt; `maxWidthCh` < 20 on the display entry; one invented color key; over-long `borderRadius` string), and the spec's ONE schema correction did not converge (fixes some violations, introduces others).

Root causes found and FIXED along the way (all transport/serving-shape level):
1. Workers AI reasoning runs **before** content and shares the `max_tokens` budget — complex prompts ended as 1,541 reasoning-only frames → `[DONE]` with zero content (3×). Real control: `chat_template_kwargs: { enable_thinking: false }` (the z.ai `thinking` param is silently ignored — verified against `wrangler ai models schema`).
2. With reasoning off, the model prepends prose ("Let me study…") — fixed with schema-supported `response_format: { type: "json_object" }` (the issue-#30 json-mode rule, now applied on this host).
3. Non-transport amendments under §20's own mandate: blueprint prompt `simple-design-blueprint/v2` (size discipline 6-12K tokens; hard output constraints: exact aspect-ratio enum, exact color-key set, `maxWidthCh` 20-120 integers on reading entries only, single short `borderRadius` string, JSON-only reply).

Schema-invalid attempts persist nothing (verified: "no artifact was persisted") and never retried semantically beyond the boundary's one correction.

## Constraints honored

```text
Blueprint split into stages:            NO (design-blueprint/1 stays ONE artifact)
Finch 5-call diagnostic adopted:        NO (diagnostic code remains instrumentation only)
Website Builder run:                    NO (§19 — Phase 2 only)
Page-agent architecture:                NO
Alternate model:                        NO (same model release; host exception documented)
Legacy visual stages reintroduced:      NO
Legacy code deleted:                    NO
Production deployed:                    NO (experimental runtime only)
Retry attempts added:                   NO (bounded 3-attempt transport retry, unchanged semantics)
Existing evidence overwritten:          NO (22999d1 artifacts + .tmp-exp-phase1/ untouched; new evidence in .tmp-exp-transport/)
```

## Cost (§29 — separate from KIE)

- KIE: **USD 0** (no image generation).
- Workers AI: ~2,500 neurons total across canaries + blueprint attempts (≈ 4-6 USD-cent equivalent at standard neuron pricing — actual billing per the account's Workers AI plan; exact USD not metered per-call).
- Z.AI Coding Plan: blueprint/canary probes only (existing plan capacity; no new spend).
- General API: no successful billed call (entitlement absent; nothing purchased).

## Required report fields

```text
Canary A long text:            PASS (14,739 tokens, 331s, TTFB 676ms, crossed 120s, [DONE], no truncation)
Canary B multimodal:           PASS (8,148 tokens, 182s, 17 sections, JSON valid)
Morabeza Blueprint:            FAIL — schema-invalid after the 1 allowed correction, 4 runs,
                               different small constraint subsets each time (see above)
Blueprint model calls:         2 per run (initial + the ONE schema correction); transport always completed
Blueprint output tokens:       ~10K per streamed attempt (12,288 budget)
DESIGN-BLUEPRINT.md:           not produced yet
Blueprint human quality:       PENDING OPERATOR REVIEW
Finch diagnostic adopted:      NO
KIE:                           USD 0
Production resources touched:  NO
Main merged:                   NO
V1:                            UNCHANGED
```

## Recommendation

**CONTINUE_SIMPLE_BENCHMARK — conditional on ONE operator decision.** The old blocker (large-output LLM transport) is **fixed and proven**: streaming delivers 14.7K-token completions through the Worker with sub-second TTFB, crossing the 120 s boundary with healthy streams, and the real blueprint call now reliably returns parseable JSON. What remains is model-host schema conformance (small enum/integer violations that whack-a-mole across correction attempts) on the Workers AI host. Operator options, in order of preference:

1. **Approve a small Z.AI General API balance top-up** — unlocks the §3 primary transport where `thinking: disabled` + `response_format` are known-good from production evidence (issue #30) and the Coding Plan already proved blueprint-shaped reasoning. Highest-fidelity path; cost is likely single-digit USD for the whole benchmark.
2. **Keep Workers AI and accept a schema-tolerance iteration** — e.g. one more focused prompt/contract tightening, or a *decided* relaxation of 2-3 over-strict schema constraints (e.g. drop `maxWidthCh` min for display entries — typographically the model is right). Requires explicit operator sign-off since it touches the design-blueprint/1 contract.
3. **Test the Coding-Plan endpoint streaming canary** (§3's exception clause: "unless a separate canary proves that it is intentionally suitable") — `stream:true` on `api.z.ai/api/coding/paas/v4` with the existing entitlement; if the edge window applies to streamed responses too, this dies fast and cheap; if not, the canonical provenance is preserved at zero new cost.

Then STOP — awaiting operator decision. No merge, no production deploy, no legacy deletion, V1 unchanged.
