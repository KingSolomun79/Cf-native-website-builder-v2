# MODEL AND PROVIDER POLICY — CANONICAL (2026-09-11)

Operator GO 2026-09-11: **Z.AI CODING PLAN UNIFICATION**. This document is the
canonical provider/model policy for V2 and supersedes every earlier transport
or provider note for the ACTIVE LLM path.

## LLM provider

- **Z.AI GLM Coding Plan** — the ONE provider for every V2 language-model
  operation: Design Blueprint, Website Builder, Visual QA, Site Repair,
  schema/structural AI correction, and any future semantic LLM stage.
- **Coding endpoint** (OpenAI-compatible): `https://api.z.ai/api/coding/paas/v4`.
- The base URL is configurable (`ZAI_CODING_BASE_URL`) so a Morabeza-owned
  proxy can front the same Coding Plan semantics transparently.
- **NEVER**: the Z.AI General API (`/api/paas/v4`), Workers AI inference,
  Kimi, OpenRouter, Cloudflare AI Gateway, or automatic provider fallback.
- The one provider abstraction is `src/lib/zai-coding-plan.ts`; stage code
  never handles provider credentials or routing.

## Models (stage-specific, Coding Plan only)

| Stage | Model |
|---|---|
| Website Builder (all six file-realization calls) | `glm-5.3` |
| Site Repair | `glm-5.3` |
| General / coding / repair default | `glm-5.3` |
| Blueprint + Visual QA (multimodal) | the Coding Plan GLM model verified by the live multimodal canary (GO §9); preferred candidate `glm-5.3-flash`, overridable via `ZAI_MULTIMODAL_MODEL` |

Multimodal support is never inferred from a model name: it requires the model
to be listed/allowed by the Coding Plan endpoint, to accept image input, and
to pass the live multimodal canary. If no Coding Plan model qualifies, the
policy returns `CODING_PLAN_MULTIMODAL_MODEL_UNAVAILABLE` — no fallback.

## Configuration

```
ZAI_CODING_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_CODING_API_KEY=<Coding Plan secret>
ZAI_CODING_MODEL=glm-5.3            # optional pin
ZAI_MULTIMODAL_MODEL=<verified>     # optional pin
```

The credential is `ZAI_CODING_API_KEY` on EVERY environment — the legacy
`ZHIPU_API_KEY` alias was removed from source and from both Workers after
canonical-secret canaries passed (final secret hygiene, 2026-09-12).

## Transport rules

- Streaming (OpenAI-compatible SSE) and synchronous completion are BOTH
  transport choices inside the Coding Plan — never a provider switch.
- Streaming accumulates `delta.content`, requires a valid terminal
  (`[DONE]` + finish reason), and rejects partial output.
- `finish_reason=length` (or the token ceiling) classifies `OUTPUT_EXHAUSTED`:
  fail closed, never retried, never budget-raised.
- Reasoning output (`reasoning_content`, think-template blocks) never enters
  generated artifacts; `thinking: { type: "disabled" }` is sent on every call.

## Retired (historical evidence only)

Workers AI transports (`@cf/zai-org/*` model ids, `workers-ai-file`,
`SIMPLE_STREAMING_TRANSPORT=workers_ai_stream`), the Z.AI General API
streaming experiments, and all single/dual-call whole-site output envelopes
are retired from the canonical path. Their experiment reports remain in the
repository (v2-docs/EXPERIMENT-*.md, FOLLOW-UP-TRANSPORT-RESILIENCE.md); the
research branches themselves were deleted from origin after the final secret
hygiene (2026-09-12) — their commits remain reachable through main's merge
history where merged. The Kimi branch was never created and must not be.

**Physical retirement (2026-09-12):** the legacy seams themselves were deleted from
the repository — `src/lib/ai-gateway.ts` (Cloudflare AI Gateway / OpenRouter /
provider chain), `src/lib/ai-streaming.ts` (Z.AI General API + Workers AI streaming
transports), the benchmark driver route/script, and their env/secret surfaces. The
Coding Plan is not merely preferred; NO alternate provider path exists in source.
`scripts/verify-llm-model-routing.mjs` fails the build if any of them reappear.

## Production prerequisites (supersedes the Workers AI binding prerequisite)

1. `KIE_MODEL`: `nano-banana-2-lite` (image model — unchanged policy).
2. `ZAI_CODING_API_KEY` secret configured.
3. Coding endpoint verified through the sandbox canaries.
4. Exact-model canaries PASS (text `glm-5.3`; multimodal verified model).
5. **No Workers AI binding required for LLM inference.**
6. Staging smoke PASS.

Then a separate production deployment GO.
