# CSO — Z.AI Coding Plan Unification (fix/zai-coding-plan-builder)

- **Date:** 2026-09-11
- **Scope:** working tree of `fix/zai-coding-plan-builder` (base `fix/simple-builder-file-realization` @ `1444d15`)
- **Operator GO:** "Z.AI CODING PLAN UNIFICATION" (2026-09-11)

## 1. What was audited

- `src/lib/zai-coding-plan.ts` (new): the ONE provider abstraction — Coding
  Plan base URL (configurable), Bearer auth, streaming + synchronous modes,
  usage/finish/request-id extraction, bounded transport retries, OUTPUT_
  EXHAUSTED fail-closed, `GET /models`.
- Builder seams (`website-builder.ts`): routed to `glm-5.3` via the Coding
  Plan; frozen shared chrome (§18) extraction/validation; per-file resume
  artifacts (§20); `workers-ai-file.ts` DELETED.
- `vision.ts` / `site-repair.ts`: Blueprint/Visual QA/Repair seams reworked to
  the Coding Plan (multimodal model via `ZAI_MULTIMODAL_MODEL`).
- Driver: `coding-plan-models` / `coding-plan-text-canary` /
  `coding-plan-vision-canary` / `coding-plan-css-qualification` ops; Workers
  AI canary/probe ops removed with the transport.
- Config/docs: `wrangler.exp.jsonc` (`SIMPLE_STREAMING_TRANSPORT` removed,
  `ZAI_CODING_BASE_URL` added), `MODEL-AND-PROVIDER-POLICY.md`,
  `PRODUCTION-ROLLOUT-CHECKLIST.md`, migration `0036` (per-file artifact
  kinds).

## 2. Security scope

Touched: outbound LLM transport + credential handling, experiment driver
surface, D1 artifact kinds (migration), generated-source trust path (chrome
gate added). NOT touched: production routes/authn, form security,
publication/approval, payments, image-provider (KIE) configuration.

## 3. Attack-surface summary

1. **Credential handling**: `ZAI_CODING_API_KEY` (with `ZHIPU_API_KEY` as the
   accepted sandbox legacy name) is read from Worker secrets only, sent
   exclusively as `Authorization: Bearer` to the configured Coding endpoint.
   It is never logged, never persisted to artifacts, never returned in driver
   responses, and never reaches generated-site code. The key VALUE is never
   recorded anywhere; only its presence is configurable.
2. **Endpoint pinning**: the base URL defaults to the Coding Plan endpoint;
   `ZAI_CODING_BASE_URL` is an environment-controlled value (not client
   input). No client-controlled string influences the destination host,
   model (allowlist/pinned constants in driver ops; stage constants in the
   pipeline), or request shape. The driver still cannot act as a generic
   model runner: canary models are allowlisted, qualification models are
   pinned to the routed Builder model.
3. **Response handling**: SSE/JSON parsing is bounded by the response stream;
   reasoning content is dropped, never persisted; error snippets in
   diagnostics are capped (≤300–400 chars) and carry provider/binding
   messages only.
4. **Driver route**: unchanged dual gate (`EXP_BENCHMARK_DRIVER=1` + HMAC).
   The vision canary accepts a caller-supplied base64 image for the
   multimodal probe (operator tooling, dual-gated, sandbox-only).
5. **Migration 0036**: extends the `build_stage_artifacts.kind` CHECK with six
   explicit `builder_file/*` literals via the established table-rebuild
   pattern; row data, immutability triggers and the unique constraint are
   preserved. Applies cleanly to the experiment D1; production applies it in
   the future release GO (no destructive risk — kind enumeration only
   widens).

## 4. Findings

No Critical or High findings.

**Low / hygiene (verified, accepted):**
1. `ZHIPU_API_KEY` fallback keeps the legacy secret name valid on the
   sandbox. Impact: an environment that intends to rotate credentials could
   keep serving on the old name. Mitigation: documented in the policy doc and
   the rollout checklist (production sets `ZAI_CODING_API_KEY`); the value is
   identical in nature (same Coding Plan credential).
2. The vision canary echoes up to 200 chars of model content in its response
   (operator diagnostic, dual-gated). Accepted.

**Watch items:** none new. Prior invariants (driver allowlist/pin, no
automatic model substitution, fail-closed exhaustion) are preserved and
re-tested (`tests/v2-zai-coding-plan.test.ts`, `v2-builder-file-realization.test.ts`).

## 5. Severity summary

- Critical: 0 / High: 0 / Medium: 0 / Low: 2 (accepted, operator-tooling scoped)

## 6. Required remediation

None for this scope.

## 7. Watch items

- On production rollout, verify `ZHIPU_API_KEY` is either removed or rotated
  to the canonical `ZAI_CODING_API_KEY` name so only ONE credential path
  remains.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

## 9. Next best action

Commit, deploy the sandbox, run the Coding Plan canaries (models, text,
multimodal), then the CSS-only qualification (GO §12/§21).
