# CSO — cleanup→main final legacy-cleanup merge (GO MERGE_CLEANUP_TO_MAIN 2026-09-11)

- **Branch audited:** `cleanup/remove-legacy-design-pipeline` @ merge `7bce2c6` (`fix/simple-builder-dom-first` `81033cf` merged `--no-ff` into `5dcb619`)
- **Scope:** full merge delta (19 files, +980/−301): DOM-first Builder (`website-builder.ts`), text-only repair seam (`site-repair.ts`), corrected hidden-content gate (`bundle-qa.ts`), JSON-string normalizer + `AI_BOUNDARY_BUILD` (`ai-boundary.ts`), prompt contract v8, experiment benchmark driver A/B op, tests/docs.

## 1. What was audited

Merge delta against `5dcb619`, driver gating in the merged tree, config posture
(`wrangler.jsonc` production vs `wrangler.exp.jsonc` experiment), and the prior
CSO `docs/security/2026-09-11-v2-dom-first-builder-cso.md` (SECURITY OK FOR
CURRENT SCOPE, one accepted watch item).

## 2. Security scope

- Auth: driver route unchanged and intact post-merge — 404 unless
  `EXP_BENCHMARK_DRIVER === "1"` (verified: NOT set in production config, set
  only in `wrangler.exp.jsonc`), HMAC `X-Signature` over raw body before parse.
- Secrets: no new secrets/bindings/vars; hardcoded-secret scan of the merge
  delta clean; no secret values in logs/docs added by the delta.
- Model output trust: unchanged fail-closed posture. The new JSON-string
  wrapper decode fires only when the ENTIRE payload parses as exactly one JSON
  string, and its output still passes the same fence handling and
  deterministic validation — never heuristic surgery. Repair seam is now
  text-only (glm-5.3 rejects image parts on the Coding Plan); the visual
  context travels as textual QA findings — no new data-exfil surface.
- Gates: hidden-content gate remains blocking for hidden classes shipped in
  markup; only the contract-permitted JS-applied / `html.js`-scoped idioms are
  exempt (covered by new hardening tests).
- Production: no production surface touched; deployment NOT authorized in this
  GO.

## 3. Findings

None blocking. No new material finding.

## 4. Watch items (already accepted, carried)

- Caller-supplied `buildVersionId` inheritance on the HMAC-gated,
  experiment-only driver surface (prior CSO watch item — unchanged).
- Brand-new `*.workers.dev` preview subdomains can serve the placeholder to
  the Worker's own Browser Rendering capture while external clients see the
  real deployment (§17 GO watch item — marker-gated capture required before
  production release qualification).
- Blueprint provider variance (schema-invalid attempt converging within the
  existing bounded, fail-closed behavior) tracked as an operational watch item
  (§18 GO). No retry/normalization layer added — correct per GO.

## 5. §7 final sweep classification (GO MERGE_CLEANUP_TO_MAIN, pre-main)

Legacy design-path terms — `legacy_v2` (3: comments/negative assertions +
test config mirror), `VisualBlueprint` (1: comment documenting removed error
classes), `ImplementationContract` / `CraftPreflight` / `automated-repair` /
`assembly-repair` (0 hits), `realization-repair` (1: negative-assertion test),
`traitObligation` (1: negative-assertion test). **Zero executable legacy
design path.** The `DESIGN_PIPELINE_VERSION` var in wrangler.jsonc is dead
config — no code reads it (runtime constant `simple_blueprint_v1` is
provenance only; the "flip to legacy_v2" comment references removed behavior)
— flagged for removal in the later production-rollout cleanup, per GO §10/§19
pattern of deferring retirement, not silently ignored.

Non-Coding-Plan LLM provider paths — **zero ACTIVE paths.** Verified: every
active stage (design-blueprint v5, website-builder v8, visual-qa v2,
site-repair v1) routes through `src/lib/zai-coding-plan.ts` → Coding Plan
endpoint; Builder/Repair resolve glm-5.3, Blueprint/Visual-QA glm-5.3-flash.
Classified remnants (all DEAD or GATED, none in the generation path):
`generateWithGatewayDetailed`'s openrouter/ai-gateway legs — dead (its only
call site is the never-taken default of `runSchemaValidatedAiStage`; all
three stage callers always pass a defined Coding-Plan generate);
`generateVisionWithGateway` + `VISION_*`/`PRIMARY_PROVIDER`/`CF_AI_GATEWAY_ID`
config vars — dead (`createProductionQaVisionGenerate` has zero callers);
`ai-streaming.ts` (Z.AI General API + Workers AI canary transports) —
imported only by the HMAC+var-gated experiment benchmark driver (GO §10 keeps
it; retirement belongs to the later production-rollout cleanup); Workers AI
binding exists in wrangler.exp.jsonc only — production config has none. Kimi:
0 hits. No old Builder prompt version (v1–v7) is active.

## 6. Verdict

**SECURITY OK WITH WATCH ITEMS** — all watch items previously accepted in the
GO; none new. Proceed with cleanup→main merge. Production untouched.
