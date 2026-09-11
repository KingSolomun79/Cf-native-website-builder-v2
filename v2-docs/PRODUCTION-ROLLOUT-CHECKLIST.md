# PRODUCTION ROLLOUT CHECKLIST — SIMPLE V2

Status: **ROLLOUT BRANCH PREPARED — DEPLOY GATED ON PRODUCTION SECRET** (as of
the 2026-09-11 production-rollout GO from main `4127500`).

## Canonical production configuration (verified by scripts/verify-llm-model-routing.mjs)

### LLM — Z.AI Coding Plan ONLY

- `ZAI_CODING_BASE_URL = https://api.z.ai/api/coding/paas/v4` (config var).
- `ZAI_CODING_MODEL = glm-5.3` — Website Builder (all six DOM-first calls) and
  Site Repair.
- `ZAI_MULTIMODAL_MODEL = glm-5.3-flash` — Design Blueprint (design-blueprint/2)
  and Visual QA.
- Credential: the Worker SECRET `ZAI_CODING_API_KEY` — never a config var,
  never committed. The legacy `ZHIPU_API_KEY` name is tolerated in code for
  older sandbox environments ONLY; a production deployment is not ready unless
  `ZAI_CODING_API_KEY` is explicitly configured (verify with
  `npx wrangler secret list --name cf-website-factory-v2`, names only).
- NO automatic fallback, Workers AI, AI Gateway, OpenRouter, Z.AI General API,
  or Kimi. The retired multi-provider config vars (`LLM_MODEL`,
  `PRIMARY_PROVIDER`, `ZHIPU_API_URL`, `ZHIPU_GATEWAY_PROVIDER`,
  `VISION_PRIMARY_PROVIDER`, `VISION_FALLBACK_PROVIDER`, `DESIGN_PIPELINE_VERSION`,
  `CF_AI_GATEWAY_ID`) are REMOVED from the production artifact.

### Images — Nano Banana 2 Lite

- `KIE_MODEL = "nano-banana-2-lite"` via the KIE durable lifecycle
  (`KIE_API_URL` unchanged, poll cadence and USD 3.00/site hard gate unchanged).
- The routing hygiene gate fails any production artifact still carrying
  `z-image`.

### Bindings

- No Workers AI binding (`"ai"`) in the production config — not a prerequisite.
- Benchmark driver: `EXP_BENCHMARK_DRIVER` absent → route 404s in production.

### Builder

- DOM-first/CSS-last, prompt `simple-website-builder/v8`, order
  home → about → services → contact → site.css (against the real four-page
  DOM) → site.js.

### Release gates

- Visual overall ≥ 90; every critical visual category ≥ 85.
- ONE durable Repair maximum per Build Version; then `HUMAN_REVIEW_REQUIRED`.
- Marker-gated capture required before Visual QA on any smoke candidate
  (brand-new `*.workers.dev` previews can serve the placeholder to the
  Worker's own Browser Rendering while external clients see the deployment).

## Pre-deploy gate order (all from the exact release SHA)

1. Full suite (includes `verify-llm-model-routing.mjs` + reachability gate),
   typecheck, production + experiment `wrangler deploy --dry-run`.
2. `/morabeza-cso` — SECURITY OK or accepted watch items only.
3. `ZAI_CODING_API_KEY` configured on production (secret list, names only).
4. Coding Plan canaries with the production credential, BEFORE deploy:
   text `glm-5.3` (exact model echo, usable content) and multimodal
   `glm-5.3-flash` (image input accepted, usable visual response). No
   fallback. Failure → STOP.
5. KIE canary: smallest safe `nano-banana-2-lite` task accepted and succeeded.
   Failure → STOP.
6. Merge rollout → main `--no-ff`, re-run gates on merged main, deploy from
   the exact merged SHA with a clean tree; record Worker deployment/version
   identity AND the previous production version for infrastructure rollback.
7. Platform smoke (Worker/D1/R2/Workflow/Browser/Images/Email, benchmark route
   unavailable), pending forward-only D1 migrations applied, then exactly ONE
   real operator-flow `REFERENCE_BOUND` Site Generation to Release Ready.
   No auto-publication.

## Post-rollout cleanup (separate task — never in the deploy commit)

Retire the experiment benchmark driver, delete the dead `ai-gateway.ts` /
`ai-streaming.ts` provider seams, drop legacy `Env` fields, remove remaining
experimental transport code.
