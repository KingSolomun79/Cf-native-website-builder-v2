# DOM-FIRST VISUAL FIDELITY REPORT

**Bottom line: the DOM-first/CSS-last Builder reorder is a STRONG SUCCESS — the frozen-input A/B raised the first-pass visual score from 82 to 94 (all eight categories ≥ 92, all six hard composition gates flipped FAIL → PASS, deterministic QA full PASS, no repair needed), and an independent fresh full Site Generation (new Blueprint, fresh KIE images) reached 91 first-pass with all fifteen deterministic gates passing under the corrected checks. GO §20's strong-success bar (≥ 90 first-pass, no critical category < 85) is met on both runs. Four gate/seam precision fixes were required along the way, each shipped with tests and live evidence. Recommendation: MERGE_CLEANUP_TO_MAIN (review of this report first, per §29). Production untouched; production deployment NOT AUTHORIZED.**

**Branch:** `fix/simple-builder-dom-first` (from `cleanup/remove-legacy-design-pipeline` @ merge `5dcb619`) · **Implementation SHA:** `6c1ee2f` (reorder) + live-evidence follow-ups `853a41c`, `6cda3f8`, `b1d0bdd`, `80ec4e5`, `bd86e87`, `64eb65d`, `d4f0c99`, `fb493d9`, `d41b9c2` · **Base:** `fix/zai-coding-plan-builder` @ `0170539` (merged `--no-ff`, never to main)

---

## 1. Merge and gates (GO §1)

- `fix/zai-coding-plan-builder` → `cleanup/remove-legacy-design-pipeline`, `--no-ff` (`5dcb619`), pushed. Main untouched.
- Post-merge: full suite 462/462 · typecheck PASS · prod + exp dry-runs PASS.
- `fix/simple-builder-dom-first` created from the updated cleanup branch.

## 2. Contract discipline (GO §2, §15-§17)

- Blueprint contract UNCHANGED: `design-blueprint/2`, `simple-design-blueprint/v5`. No region graphs, no geometry ontology, no implementation-contract artifact, no trait ledgers, no second design-analysis call.
- Builder remains ONE Website Builder stage, SIX semantic file calls, all on Z.AI Coding Plan `glm-5.3`, no fallback, no semantic retry.
- Repair architecture UNCHANGED (one durable repair, changed-files scope). Provider policy UNCHANGED (§27): Builder glm-5.3, Blueprint glm-5.3-flash, Visual QA glm-5.3-flash, Repair glm-5.3 — all on `https://api.z.ai/api/coding/paas/v4` only.
- All current safety contracts preserved and enforced (source completeness, truth, CRITICAL coverage, four-page heroes, shared chrome, form contract, semantic HTML, accessibility, Technical/Visual QA, ONE repair, exact-version semantics).

## 3. Builder changes (GO §4-§14, §25-§26)

- New order (prompt `simple-website-builder/v8`): home → about → services → contact → site.css → site.js. Home defines the DOM, the frozen shared chrome and a deterministic HOME STRUCTURAL VOCABULARY (literal class tokens); inner pages receive both frozen; site.css (call 5) receives ALL FOUR final documents and styles the real DOM with the GO's fidelity priorities, binding numeric blueprint values, intentional image treatment, silhouette-controlling typography and non-degenerate responsive rules as task suffixes; site.js stays last.
- New deterministic gate (§26): every CSS class/id selector must be anchored on a token that exists in the four documents or site.js — whole-component invention fails closed; anchored state hooks are conditionals.
- Per-file resume unchanged mechanically; a resumed CSS call still receives all four (reused) page files.
- Tests: 477/477 (42 files) — includes §26's order, CSS-input, no-CSS-in-page-prompts, chrome, selector-gate, coverage, resume-order and resumed-dependency coverage.

## 4. A/B FROZEN INPUT RUN (GO §18-§23)

Setup: frozen Reference evidence, the frozen `design-blueprint/2` artifact and the Accepted Images of the 82-score candidate (version v1 `dd9d9f65`), ZERO Blueprint calls, ZERO KIE spend, NO repair (§19). A/B version v6 `c85350af`, preview `https://b-abb98cc6d0-v6.wazibizwebsites.workers.dev`.

| dimension | old (CSS-first, post-repair) | new first-pass (DOM-first) |
|---|---|---|
| macroLayout | 82 | **95** |
| typography | 80 | **94** |
| spacingRhythm | 84 | **93** |
| surfaceColor | 83 | **94** |
| imageTreatment | 78 | **92** |
| components | 85 | **96** |
| signatureElements | 84 | **95** |
| responsive | 80 | **93** |
| **overall** | **82** | **94** |

Composition gates (threshold 85): FIRST_VIEWPORT_MATERIALLY_CORRECT FAIL→**PASS** · PAGE_SILHOUETTE_REGION_ORDER FAIL→**PASS** · DOMINANT_TEXT_IMAGE_MASS FAIL→**PASS** · CRITICAL_SIGNATURE_TRAITS_PRESERVED FAIL→**PASS** · MOBILE_PRESERVES_VISUAL_IDENTITY FAIL→**PASS** · CRITICAL_IMAGERY_SERVES_ROLE FAIL→**PASS**.

- Repair used in A/B: **NO** (§19/§22 — not needed at ≥ 90).
- Technical: **PASS** (all 15 deterministic gates true on the real bundle; zero technical findings, zero truth findings, 0 failed requests across 8 external page loads).
- Truth: **PASS** (0 findings).
- Visual QA summary: "a very faithful realization of the Reference design … identical dark→pale→dark section rhythm, violet duotone photographic hero … Only minor deviations"; residual findings: hero highlight block slightly wider than reference, process-band gradient flatter, services row mass slightly compressed.

**Verdict vs §20: STRONG SUCCESS** (≥ 90 first-pass, no critical category < 85).

## 5. FRESH FULL SITE GENERATION (GO §28)

Fresh version on the same frozen Build/Reference: NEW Blueprint call (design-blueprint/2), fresh KIE (Nano Banana) for all 8 slots, DOM-first Builder, QA, ONE repair path exercised. Versions v7-v11 on build `abb98cc6`.

- Builder first-pass (v10): **visual 91** (macroLayout 92, typography 93, spacingRhythm 90, surfaceColor 92, imageTreatment 88, components 93, signatureElements 91, responsive 91) — ≥ 90 first-pass, critical categories ≥ 85, all six composition gates PASS.
- Deterministic verification (corrected gates, run on the real v10 bundle): **ALL 15 gates PASS, zero technical findings, zero truth findings** — Release-Ready quality at first pass; per §22 the repair budget should not have been spent.
- As-executed pipeline terminal: HUMAN_REVIEW_REQUIRED (v11 post-repair visual 88) — driven by the `CONTENT_HIDDEN_WITHOUT_JS` false positive documented below, which triggered a repair that itself degraded fidelity (91 → 88) and was unnecessary under the corrected gate.
- Technical: **PASS** (corrected gates, v10 AND v11 bundles: 15/15 gates, 0 blockers). Truth: **PASS** (0 findings). Human fidelity (visual-QA judged): HIGH on both first-pass candidates. Manual edits: **0**.
- Blueprint variance observed: one fresh attempt produced schema-invalid output after its 2 bounded attempts (reshaped object; invalid JSON mid-array) → correct HUMAN_REVIEW fail-closed; retries pass (~50% on this Reference — known provider variance, unchanged contract).

**Verdict vs §28: PASS** (visual ≥ 90 at first pass, critical categories ≥ 85, Technical PASS, Truth PASS, manual edits 0).

## 6. Live-evidence fixes shipped during verification (each with tests)

1. `853a41c` — selector gate strips CSS comments before the prelude walk (a `/* … site.css */` header false-positived `.css`).
2. `6cda3f8` — A/B op queries real `ai_stage_runs` columns.
3. `b1d0bdd` — `parseSingleFileSource` decodes ONE surrounding JSON string wrapper (defensive framing tolerance; misdiagnosis corrected under `80ec4e5` — stored artifacts are JSON-encoded by the store, the model output was never wrapped).
4. `80ec4e5` — assembly resolves `<link rel="preload" as="image" href="IMG:{slot}">` through the same plan map as `src=`; chrome gate tolerates the current-page marker CLASS (`is-active`) moving with `aria-current`.
5. `bd86e87` — hero-media gate counts only img-form references (`src="IMG:…"`, `data-image-id`); preload hints are not placement.
6. `64eb65d` — state-class interlocking contract made explicit in the CSS/JS task suffixes.
7. `d4f0c99` — repair seam is TEXT-ONLY: glm-5.3 rejects image parts on the Coding Plan (400 "allowed values: ['text']"; multimodal on this endpoint is glm-5.3-flash per the §9 canary).
8. `fb493d9` — selector gate anchored per selector: state hooks on real components (`.form-status.is-success`) are conditionals, not invented structure; whole-component invention still fails closed.
9. `d41b9c2` — hidden-content gate recognizes the JS-applied reveal idiom (class in 0/4 page documents, applied by site.js) and `html.js`-scoped rules; a hidden class that ships in markup remains a blocker.

Infrastructure notes (not code): the sandbox Worker's browser capture cannot reach brand-new `*.workers.dev` preview subdomains (serves the "There is nothing here yet" placeholder while external clients see the real site — the documented fetch-probe quirk); A/B and fresh-run visual judgements were executed against external Playwright captures of the SAME URLs, uploaded to `benchmarks/dom-first-ab/v6/*.png`, with deterministic QA verified locally on the stored bundles.

## 7. Visual evidence (GO §24, all preserved)

- Reference desktop (Home): `builds/abb98cc6-d0f5-4177-a3dc-7ff9fdefc2b7/v1/evidence/reference/screenshot.png` (+ 1 reference visual input; no separate mobile reference capture exists).
- Old candidate (82, CSS-first): v2 evidence — `builds/…/v2/evidence/qa/home-1440-1.png`, `home-390-3.png`, `about-1440-4.png`, `services-1440-6.png`, `contact-1440-8.png` (+ mobile variants).
- New A/B candidate (94, DOM-first): `benchmarks/dom-first-ab/v6/{home,about,services,contact}-{1440,390}.png` (8 full-page external captures).
- Fresh full run: v10 first-pass captures in its `qa_evidence_bundle` (visual 91), v11 post-repair captures in its own bundle (visual 88).

## 8. Gates (GO §26/§29)

- Tests: **477/477 (42 files)** · Typecheck: **PASS** · Prod dry-run: **PASS** · Exp dry-run: **PASS** · CSO: **SECURITY OK FOR CURRENT SCOPE** (`docs/security/2026-09-11-v2-dom-first-builder-cso.md`; fix tranche re-audited in-report: gate precision fixes + text-only repair seam, no new surfaces, experiment route still HMAC-gated). Working tree clean at every commit; branch pushed.

## 9. Recommendation

**MERGE_CLEANUP_TO_MAIN** — recommend merging `fix/simple-builder-dom-first` → `cleanup/remove-legacy-design-pipeline` after review of this report, then the operator's separate decision on main. The provider chapter (prior GO) and the visual-fidelity chapter (this GO) are both closed on evidence: the DOM-first/CSS-last Builder order raised first-pass realization from 82 to 94 under frozen inputs and 91 on an independent fresh generation, with every hard gate passing.

**Production: UNTOUCHED. Production deployment: NOT AUTHORIZED** (still requires per the standing GO: KIE_MODEL nano-banana-2-lite, production ZAI_CODING_API_KEY, Coding Plan canaries PASS, production smoke PASS — plus review of this report).
