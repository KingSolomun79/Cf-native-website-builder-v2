# PRODUCTION ROLLOUT CHECKLIST — SIMPLE V2

Status: **BLOCKED / NOT AUTHORIZED** (as of the 2026-09-11 Coding Plan unification).

## Provider prerequisites (operator GO 2026-09-11: ZAI CODING PLAN UNIFICATION)

- All LLM inference routes through the Z.AI GLM Coding Plan only — see
  `v2-docs/MODEL-AND-PROVIDER-POLICY.md`. No Workers AI LLM binding is
  required in production; the previously noted "add Workers AI binding"
  prerequisite is **CANCELLED**.
- Production must carry: `ZAI_CODING_API_KEY` (Coding Plan secret),
  `ZAI_CODING_BASE_URL` (Coding endpoint), and PASSING exact-model canaries
  (text `glm-5.3`; the multimodal model verified live for Blueprint/Visual QA).

## HARD BLOCKER — image model configuration

- Current production `wrangler.jsonc`: **`KIE_MODEL: "z-image"`**.
- Canonical SIMPLE requirement: **`KIE_MODEL: "nano-banana-2-lite"`**.
- Therefore: **PRODUCTION DEPLOYMENT FROM THE CURRENT CONFIG IS FORBIDDEN.**
  Deploying SIMPLE with `z-image` would silently violate the accepted
  photographic-hero image contract (text-free imagery, provider ratios,
  screen-free heroes verified against Nano Banana 2 Lite).
- The fix is NOT part of the legacy cleanup. It happens only in the dedicated
  production-rollout change, verified in the sandbox first (`wrangler.exp.jsonc`
  already carries `nano-banana-2-lite`).

## Rollout sequence (when the GO is issued)

1. Merge `cleanup/remove-legacy-design-pipeline` after its final live
   verification gate passes ( SIMPLE_MAIN_VERIFIED equivalent on the cleaned
   branch).
2. Production-rollout commit: `wrangler.jsonc` `KIE_MODEL` -> `nano-banana-2-lite`
   (single reviewable change), plus removal of the inert
   `DESIGN_PIPELINE_VERSION` var if desired.
3. Pre-deploy verification from the exact commit SHA to be deployed:
   full suite, typecheck, `wrangler deploy --dry-run` (prod config), CSO.
4. Deploy production from a clean tree at an exact committed SHA; record the
   Cloudflare deployment/version identity.
5. Post-deploy smoke (sandbox driver points at production is FORBIDDEN — use
   a real operator-driven onboarding): one REFERENCE_BOUND Site Generation
   end to end; verify four pages, four photographic heroes, marker-gated
   preview, Technical/Truth/Visual QA, Release Ready; zero manual source edits.
6. Only after the post-production smoke succeeds: retire the benchmark driver
   route in its own small commit (operator decision 2).
