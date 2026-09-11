# CSO — SIMPLE V2 production rollout branch (GO 2026-09-11)

- **Branch audited:** `release/v2-production-rollout` (from main `4127500`)
- **Scope:** production config canonicalization (`wrangler.jsonc`), routing/reachability
  gate extension (`scripts/verify-llm-model-routing.mjs`), dead-branch removal
  (`src/simple-design/pipeline.ts`), retired base-URL fallback removal
  (`src/lib/zai-coding-plan.ts`), config mirror regeneration, rollout hygiene
  (tracked `.tmp` file removal + `.gitignore`), rollout checklist update.

## 1. Security scope

- Secrets: NO secret values introduced, read, printed, or logged anywhere in
  the diff or this report. `ZAI_CODING_API_KEY` appears by NAME only, as the
  required production Worker secret. Production secret state verified via
  `wrangler secret list` (names only): `ZAI_CODING_API_KEY` is NOT configured
  (legacy `ZHIPU_API_KEY` present) — rollout therefore holds at
  HOLD_PRODUCTION_SECRET per GO §7; no deploy occurs on this branch state.
- Config: retired provider vars removed from the production artifact
  (`LLM_MODEL`, `PRIMARY_PROVIDER`, `ZHIPU_API_URL`, `ZHIPU_GATEWAY_PROVIDER`,
  `VISION_PRIMARY_PROVIDER`, `VISION_FALLBACK_PROVIDER`,
  `DESIGN_PIPELINE_VERSION`, `CF_AI_GATEWAY_ID`). Reachability proven before
  removal: `CF_AI_GATEWAY_ID` was referenced only by the dead gateway seam
  (zero live consumers); `ZHIPU_API_URL` fallback removed from the active
  Coding-Plan seam in the same change, so the var has zero runtime references.
  `VISION_REQUEST_TIMEOUT_MS`/`VISION_MAX_ATTEMPTS_PER_PROVIDER`/
  `VISION_RETRY_DELAY_MS`/`VISION_INPUT_MAX_*` retained — live consumers exist
  (`stage-execution.ts`, `vision-input.ts`) and they are outside the GO's
  removal list.
- Behavior: `pipeline.ts` change removes an UNREACHABLE catch branch
  (`VisionGatewayError` can never be thrown by the Coding-Plan blueprint
  stage); `throw error` preserves prior effective behavior. No architecture
  change.
- Attack surface: unchanged. No new routes, bindings, or capabilities.
  Benchmark driver remains var+HMAC gated and absent from production config.
  The extended routing gate is fail-closed: any reintroduction of a retired
  provider var, the z-image model, or a dead-seam import from generation code
  fails `npm test`.
- Deployment posture: this branch does NOT deploy. Production untouched;
  all verification local (dry-runs) or read-only (`secret list`, names only).

## 2. Findings

None blocking. No new material finding.

## 3. Watch items (carried, previously accepted)

- Preview-capture placeholder on brand-new `*.workers.dev` subdomains —
  marker-gated capture REQUIRED before Visual QA on any future smoke
  candidate (GO §18).
- Blueprint provider variance — bounded fail-closed behavior retained; no
  retry layer added (GO §18 of the cleanup GO).
- `ZHIPU_API_KEY` code-level fallback remains for sandbox tolerance; the
  production gate is the explicit `ZAI_CODING_API_KEY` secret-presence check.
  Deletion of the fallback belongs to the post-rollout retirement cleanup.

## 4. Verdict

**SECURITY OK WITH WATCH ITEMS** — all watch items previously accepted in the
GO. The branch is ready for the operator to configure `ZAI_CODING_API_KEY`;
deploy remains blocked until the §7/§16/§17 gates run with that credential.
