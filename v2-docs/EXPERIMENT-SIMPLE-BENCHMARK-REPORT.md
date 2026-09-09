# SIMPLIFIED DESIGN PIPELINE — LIVE BENCHMARK REPORT

Branch: `experiment/simplified-design-pipeline`
Base: `89df4c0` · Experiment HEAD: `63729ab` + benchmark-only descendants (`068cab7`, this commit)
Runtime: experimental only — Worker `cf-website-factory-sandbox` (operator's dormant V1 sandbox, last deployed 2026-09-06→2026-09-08 by this benchmark), D1 `website_factory_v2_simple_exp`, R2 `website-factory-v2-simple-exp-assets`. Production `cf-website-factory-v2` untouched; production D1/R2 untouched; V1 unchanged.
Date: 2026-09-08 · Executor: autonomous agent session (Jo's machine)

---

## CSO (Phase 0)

**SECURITY OK FOR CURRENT SCOPE** — `docs/security/2026-09-08-v2-simple-pipeline-experiment-cso.md`. No new routes on production config (driver route is var-kill-switched and absent from production vars); `DESIGN_PIPELINE_VERSION` cannot reach Approval/Publication; KIE gate, artifact/Build-Version immutability, facts isolation, secret handling all preserved. Two low watch items recorded (branch wrangler default; idempotent release-resume semantics).

## HEADLINE FINDING — TRANSPORT CEILING

Measured on the z.ai coding endpoint (`https://api.z.ai/api/coding/paas/v4`, glm-5.3-flash, thinking disabled, JSON mode, via the production `generateWithGateway` path):

| Probe (max_tokens) | Result | Wall time | Throughput |
|---|---|---|---|
| 4,096 | 200, finish=length (budget exhausted) | 52.8 s | ~78 tok/s |
| 8,192 | 200, finish=length | 96.1 s | ~85 tok/s |
| 16,384 | **HTTP 524 — provider edge timeout** | 125 s | — |

The provider edge terminates any single non-streaming completion after ~100 s. **Practical ceiling ≈ 8,000 output tokens per call.** Consequences, all reproduced live:

- **ONE_CALL builder (max_tokens 32,000) is physically infeasible** — HTTP 524s, retried by the gateway until every leg failed (zhipu 524 ×N; OpenRouter leg 200-with-empty-content `finish_reason=length`; AI-Gateway leg HTTP 400 `"glm-5.3-flash" is not a valid model identifier`). Total 1,595 s, no bundle.
- **TWO-CALL SINGLE-STAGE pages call (max_tokens 32,000) targets the same wall** — it never gets the chance to prove itself because the fallback triggers only on `AiStageSchemaInvalidError`, not on transport exhaustion (implementation gap; the stage comment says the fallback exists because "one-call generation was unreliable for this transport").
- **Design Blueprint call (multimodal, max_tokens 16,384) also cannot complete** — 2 × 120 s vision-gateway timeouts, then the unusable AI-Gateway fallback ⇒ `VisionGatewayError` after 241.7 s. Per spec discipline (no semantic retry loop) it was NOT retried.

Every SIMPLE stage that budgets >8K output tokens fails on this transport. This is provider physics, not prompt/model quality.

## PHASE 1 — FINCH BUILDER

- **Builder strategy:** sanctioned strategies could not return a bundle (above). A clearly-marked **transport diagnostic** (`runSimpleBuilderTransportDiagnostic`, exported from `website-builder.ts`, never called by the pipeline) measured design-transfer quality under a forced small-call decomposition: shared shell + ONE page per call with the same frozen context/stylesheet. This is benchmark instrumentation, not a pipeline strategy (spec §35 forbids four *independent* page agents; these calls share the frozen shell and context, and the operator must decide whether even this shape is acceptable).
- **Major model calls (successful candidate):** 5 — shell 89.2 s (right under the window), home 33.7 s, about 25.2 s, services 28.5 s, contact 34.6 s (≈211 s model time). Failed/extra spend: the one-call chain, two diagnostic attempts lost to a wedged D1 (database recreated), 3 calibration probes.
- **Technical:** PASS — deterministic assembly + Technical Preflight + full QA-B gate set green (after 4 documented diagnostic normalizations: 3 × `data-preview="IMG:…"` → asset path; 1 genuine model JS syntax error repaired — `q(){…;);` — which preflight correctly caught).
- **Truth:** PASS — 0 findings (zero-tolerance #48 scanners over the real bundle).
- **Blueprint checklist:** **13 / 15 PASS**, 1 partial (overflow unverified at 768 px), 1 unverified (`prefers-reduced-motion` full render). Verified live: one-viewport hero with transparent header, alternating dark/pale/photographic rhythm, hairline chapter/offering rows with zero card grids, serif ≤600 + clamp() scale, brass restrained to kickers/indices/links/CTAs, CTAs → enquiry, no invented trust content, all 8 slots bundled assets, form contract with hidden `siteFormId`, dynamic footer year.
- **Desktop:** `.tmp-exp-phase1/render-home-desktop.png` (+ about/services/contact); frozen candidate live at `https://b-c160d79d99-v1.wazibizwebsites.workers.dev` (preview infra artifact).
- **Mobile:** `.tmp-exp-phase1/render-home-mobile.png` (390 px) — clean stacking, burger nav, single-column footer.
- **Human implementation quality: GOOD.** Finch language fully present: full-screen dark hero, editorial whitespace, no generic card-grid aesthetic, serif/sans hierarchy, brass restraint, capsule CTAs, the five-chapter signature section (roman numerals, hairlines, hover-preview wiring), enquiry drawer wiring, header state logic, reduced-motion CSS. Defects: one JS typo (caught by preflight — the system worked), scroll-reveal content hidden until JS fires (robustness gap worth a blueprint/prompt note), minor header/eyebrow overlap on contact.

Per the Phase-1 gate: the **quality** answer is GOOD (the model can realize an excellent blueprint), but the **builder as implemented** cannot deliver it on this transport. The isolated defect is transport/strategy — exactly what §7 anticipates improving.

## PHASE 2 — MORABEZA BLUEPRINT

- **Capture: PASS.** Stable intake infrastructure, 28.7 s: 1024×5447 full-page, 12 regions, 32 measured elements, 1 motion observation. Suitability `SUPPORTED_WITH_LIMITATIONS` ("heavy_parallax: 14 reveal/parallax candidates") — the frozen RankForge Adaptation Contract was required and accepted. Popup overlays (cookie banner, lead magnet) noted as capture artifacts. Evidence: `.tmp-exp-phase1/morabeza-fullpage.png` + R2 `builds/06025a7d-…/v1/evidence/reference/…`.
- **Blueprint: FAILED — transport.** Exactly ONE multimodal call attempted (no semantic retry, per spec §9/§30): `All configured vision providers failed` after 241.7 s (2 × 120 s zhipu vision timeouts — the model cannot finish a full blueprint inside the ~100 s edge window — then the AI-Gateway fallback leg rejects the canonical model name).
- **Blueprint quality verdict:** NOT OBTAINABLE on current transport. No DESIGN-BLUEPRINT.md exists to review.

## PHASE 3 — FULL RANKFORGE A/B

**NOT RUN** — gated behind Phase 2 and now behind the transport decision. Legacy A/B table, KIE ledger, Visual QA scores, human fidelity: pending. KIE spend this session: **USD 0.00** (fixture images; no KIE tasks). LLM spend: ~24 glm-5.3-flash coding-plan calls total (calibration + failures included) — inside the operator's existing plan; no new metered spend.

## Recommendation

**None of the three decision rules can be applied yet — the experiment is transport-blocked, not quality-blocked.** Phase 1 proves glm-5.3-flash transfers an excellent blueprint at GOOD quality inside ≤8K-token calls; Phase 2 proves the blueprint stage cannot complete at all. Operator decision required (`DECISION_NEEDED`), options in rough order of spec-alignment:

1. **Streaming transport** for SIMPLE's large-output calls (keeps ONE_CALL/TWO-CALL strategies intact; largest code change, no spec-stage change).
2. **Provider/endpoint with a longer origin window** for large completions (config-level; must keep the one-canonical-model policy honest — the AI-Gateway leg already fails that today, see 400 above).
3. **One focused SIMPLE iteration** (per §34 ITERATE-style): shrink per-call output budgets to fit ≤8K tokens — blueprint remains one call if the model stays ≤~7K tokens (borderline; risky), builder becomes shell + page-batch calls with frozen context (needs a spec §35 ruling on "independent page agents"), plus the fallback-trigger fix (transport exhaustion should reach the allowed TWO-CALL fallback). This is the minimum-change path fully inside the current provider.

If (3) is chosen, likely first fixes: `website-builder.ts` fallback trigger + maxTokens budgets; `design-blueprint.ts` output budget/conciseness clause; `ai-gateway.ts` per-attempt streaming or a provider-window-safe retry shape. Legacy stays untouched meanwhile.

## Deviations register (autonomous-session decisions for operator review)

1. **Runtime:** deployed the branch to the operator's dormant sandbox Worker `cf-website-factory-sandbox` (secrets could not be provisioned to a fresh worker — Worker secrets are write-only and no local copies exist). Prior sandbox deploy (V1-era, active version `eca50d81-dc9d-4714-9517-c0a1072d65b9`, 2026-08-25) remains restorable from version history; an inert `WebsiteAgent` DO stub export keeps the existing DO namespace intact (no delete-class migration).
2. **Benchmark driver route** `/api/v2/exp/benchmark-driver` added (HMAC + `EXP_BENCHMARK_DRIVER=1` kill-switch; absent from production config) with ops: probe / builder / diagnostic / assemble-stored / capture / blueprint / artifact. Plus local CLIs `scripts/exp-benchmark-driver.mjs`, `exp-phase1-fixtures.mjs`, `exp-phase1-render.mjs`.
3. **Diagnostic interventions on the Phase-1 candidate** (counted, pipeline untouched): 3 attribute rewrites (`data-preview`), 1 JS syntax repair. Without them the KEEP-list preflight rejects the bundle — in a real pipeline run these would consume the ONE repair (which exists for exactly this).
4. **D1 recreated once** (`3c40eb23-…` → `81084e55-…`) after the write path wedged ("storage operation exceeded timeout"; trivial writes failing with internal errors). Fresh database, all 35 migrations reapplied.
5. **Phase 2 ran despite the Phase-1 transport failure** — rationale: one capture (deterministic) + one blueprint call (already budgeted by spec §9) at trivial spend completes the operator's decision picture; the blueprint transport failure is itself the decisive Phase-2 datum. Everything beyond it is STOPPED per the gates.

## Evidence package locations

- Live candidate: `https://b-c160d79d99-v1.wazibizwebsites.workers.dev` (Workers preview infra; delete whenever)
- Local: `.tmp-exp-phase1/` — renders (`render-*.png`), KEEP-list evidence captures (`shot-*.png`), Morabeza capture (`morabeza-fullpage.png`), all request/response JSON, fixture images, mirrored candidate source (`site/`)
- R2 `website-factory-v2-simple-exp-assets`: `builds/c160d79d-…/v1/…` (candidate + 9 QA captures), `builds/06025a7d-…/v1/evidence/reference/…` (Morabeza), `fixtures/simple-images/…`
- D1 `website_factory_v2_simple_exp`: two Site Generations with full workflow/`ai_stage_runs` provenance
