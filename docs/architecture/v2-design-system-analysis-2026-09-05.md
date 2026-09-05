# WAZIBIZ V2 — External Design-System Analysis and Revised Realization Plan

**Status:** ANALYSIS / PLANNING — no production behavior changed
**Date:** 2026-09-05
**Inputs:** Anthropic `frontend-design` skill (claude-code plugin), Impeccable (pbakaus/impeccable, Apache-2.0), the frozen RankForge v3 negative fixture (build 2c8e73ec), and the current V2 pipeline code.
**Verdict (section 15):** REPLACE the old #47/#48 plan with a refined four-issue breakdown. The old plan's root causes were correct; the external systems sharpen the architecture and add three concepts WAZIBIZ lacks.

---

## 1. What the two systems actually are

**Anthropic `frontend-design`** is a single guidance skill for agentic UI work: subject-grounded design direction, typography as the personality carrier, five named "AI-generic look" clusters to calibrate against, a plan → review-against-brief → build → screenshot-critique loop, and copywriting discipline. It contains no tooling — every check is a modeled judgment.

**Impeccable** is a full design-operation system for coding agents: a command family (shape / new-work / typeset / layout / animate / adapt / audit / critique / polish / live), durable context artifacts (PRODUCT.md = product truth, DESIGN.md = durable visual world, per-surface briefs), a craft floor (mechanical quality minimums), a **deterministic antipattern detector** (contrast, side-stripe accents, gradient text, eyebrow chips, purple-on-heading palettes, glow halos, identical card grids, bounce easing, layout-property transitions — implemented as pure CSS/DOM rule functions, runnable headless or in-browser), a two-assessment critique protocol (isolated design-review agent + detector evidence, synthesized, never anchored), a bounded polish flow (triage order, preserve-the-world semantics), and a live variant mode with coarse composition knobs (density, scale).

The single most important shared principle for WAZIBIZ: **"the brief wins."** Both systems state that a pinned direction — the client's brand, an explicit brief, and by extension a Reference — overrides every anti-generic calibration. Impeccable: "Honor pinned aesthetics … even when they conflict with a saturated-pattern warning. Redirecting a clear brief toward your taste is failure." Anthropic: "the brief's own words always win."

## 2. Anthropic frontend-design — concept extraction and classification

| Concept | Mode fit | WAZIBIZ today | Disposition |
|---|---|---|---|
| Subject-grounded distinctive direction; open with the most characteristic thing in the subject's world (hero thesis) | ORIGINAL_DESIGN; REFERENCE_BOUND already has its own "subject" (the Reference) | Blueprint visualThesis + first-viewport summary exist; generator treats them as prose | Partial. Adopt as ORIGINAL_DESIGN direction-stage guidance later (PRD gates ORIGINAL_DESIGN behind 3/5 Benchmark Pass). |
| Typography discipline: deliberate faces, real scale, headline as active element, measure ≤ ~75ch | BOTH (in REFERENCE_BOUND the Reference's typography roles win) | Blueprint `typographyRoles` are rich and measured; nothing enforces them in the output | Missing enforcement. The v3 candidate shipped a UA-default 32px h1 where the Blueprint demanded 60px Figtree. → realized-type check in the craft preflight (issue #49). |
| Anti-generic calibration clusters (cream+serif+terracotta, dark+neon, broadsheet, SaaS-card kit, template chrome incl. tracked ALL-CAPS eyebrows, "A · B · C" meta, "→" on links) | ORIGINAL_DESIGN only | Absent | Missing. Adopt natively as deterministic detectors + guidance for ORIGINAL_DESIGN. **Must never fire against a Reference-mandated pattern** — Morabeza's pill eyebrows, violet accents and circular icon tiles are exactly these "tells", and reproducing them is correct (see 12). |
| Plan → review-against-brief → build → screenshot-critique | BOTH as process shape | Blueprint ≈ plan; QA ≈ critique but late and expensive | Partial. The missing piece is a cheap **between build and QA** checkpoint → craft preflight (issue #49). |
| Copy discipline (content capacity awareness, copy adapting to design) | BOTH | One prompt line added in the paused WIP ("fit copy to measured region capacities") | Partial. Keep as prompt guidance; enforce outcomes deterministically (clipping/overflow checks), not by inventing text budgets. |
| "Remove one accessory before leaving" self-critique on screenshots | BOTH | None between assembly and QA | Partial → the precheck capture IS that screenshot; make it deterministic-first. |

## 3. Impeccable — concept extraction and classification

| Concept | Mode fit | WAZIBIZ today | Disposition |
|---|---|---|---|
| Durable visual-world artifacts (DESIGN.md) with "refinement preserves; redesign replaces" semantics | BOTH (maps to: Blueprint/Contract are the world; Automated Repair may never redesign) | Already present and stricter: frozen immutable Blueprint + Build Versions; repair is realization-only | Already present. Impeccable validates the existing domain split; adopt only the *wording* discipline for repair prompts ("preservation is the default; departure requires explicit authority"). |
| Craft floor (contrast, spacing rhythm, type floors, overflow ban, motion floor, states) | BOTH | QA-B checks a11y/overflow after full QA; nothing checks before | Partial. Move the mechanical subset into the deterministic preflight (issue #49); QA-B remains the deep check. |
| Deterministic antipattern detectors (pure rule functions over DOM/computed CSS; headless or injected) | ORIGINAL_DESIGN enforcement; REFERENCE_BOUND informational-only | Nothing equivalent | Missing. This is the highest-value import. Implement a WAZIBIZ-native detector module over data the pipeline already extracts (EXTRACT_LAYOUT sections/typography/images + generated CSS text). Never a CLI/binary dependency. |
| Two-assessment critique (isolated model review + deterministic evidence, synthesized; model never anchored by detector output) | BOTH (QA-A already separate from the deterministic comparator) | Already structurally present: geometry comparator → evidence; QA-A → judgment; REFERENCE_MACRO_FIDELITY → deterministic gate | Already present (validated design). Keep; do not add a second model critic. |
| Bounded polish with triage order and preserve-the-world semantics | BOTH | Bounded repair exists but is whole-site and unmeasured (v1 74 → v2 71 → v3 62) | Partial. Issues #49/#50: targeted informed repair + preservation + regression guard. |
| Live variant mode, composition knobs (density/scale), comp-led quality (QUALITY BAR cards: a comp sets *finish*, never composition) | Not portable as-is (no human in the loop) | N/A | Concept-only: the Reference Screenshot is WAZIBIZ's "comp" — but unlike Impeccable's comps it DOES govern composition (that is what REFERENCE_BOUND means). Region crops (section 7) are the faithful adaptation. |
| concept-seed / direction tournaments | ORIGINAL_DESIGN | N/A | Defer with ORIGINAL_DESIGN work (PRD Phase 10 gate). |

## 4. Mapping onto the existing pipeline (stage by stage)

| WAZIBIZ stage | Anthropic concept | Impeccable concept | Gap verdict |
|---|---|---|---|
| Reference Capture / Visual Package / Evidence | — | comp = the rendered reference; measurement culture | Already present; evidence is measured and frozen. |
| Reference Analysis / Visual Blueprint | plan + token system; hero thesis | direction contract (THESIS / OWN-WORLD / STORY / FIRST VIEWPORT blocks) | Already present and richer (coverage contract, anti-fallback rules). |
| Implementation Contract | — | "commit the world" as a contract before code | **Weakest stage.** Home regions carry `realization: "section"` — no selectors, no grid topology, no media mode, no mustPreserve. This is where the failed v3 lost the Blueprint (see 5). |
| Website Generator | typography discipline; copy discipline; CSS-specificity warning ("classes cancelling each other out") | commit-every-atom; author assets not chrome | **Fatal seam found in v3:** CSS and pages are separate AI calls with NO shared class vocabulary. 28/59 HTML classes had no CSS rule; 58/87 CSS classes were never used. The Blueprint-faithful 4-up grid, full-bleed hero and display-type rules existed in site.css and never applied. |
| Assembly + Technical Preflight | — | craft floor mechanical checks | Preflight checks structure only; no realization/craft checks. |
| Realization checks | screenshot self-critique | deterministic detector | **Missing stage entirely.** QA is the first renderer judgment, and it is expensive. |
| QA-A / comparator / macro gate | — | two-assessment critique; heuristic honesty (scores n/a-able, no false precision) | Already present and truthful (74/71/62 + macro FAIL matched the human verdict). |
| Fix Coordinator / RBF / Confirmation | — | bounded polish, preserve-the-world, triage order | Present but unmeasured and whole-site; no regression guard; confirmation is model-only (no deterministic re-measure between rounds). |
| ORIGINAL_DESIGN (future) | direction, anti-generic calibration, distinctiveness | shape/new-work, craft, critique, polish | Deferred per PRD sequencing; concepts banked (section 10). |

## 5. Revisiting the proposed #47 — is a VISUAL REALIZATION CONTRACT justified?

**Yes — but minimal, relational, and measured.** The failed v3 proves the loss is not "the model is creative" but "the contract between Blueprint and generator does not exist": the planner emits `realization: "section"` per home region, the CSS call owns a vocabulary nobody hands to the page calls, and measured targets ride along as optional prompt prose that is all-or-nothing.

The forensic trace fixes responsibility precisely:

1. Blueprint: correct (full-bleed ~1.07-viewport hero; 4-up grid; 60px display type; anti-fallback rules).
2. Implementation Contract: first loss — no executable per-region content.
3. Generation: second, fatal loss — two calls, two class vocabularies, zero machine-enforced binding.
4. Validation: blind — no CSS↔HTML correspondence check.
5. QA: truthful but too late, and repairs re-rolled the dice (whole-site regeneration, new random vocabularies each round: v1 flat purple hero → v2 short inset card → v3 clipped-flex hero).

Neither external system uses a 25-field numeric comp schema — Impeccable deliberately treats comps as finish-references and knobs as coarse. The WAZIBIZ-native contract should therefore bind **relationships and identity**, not attempt full numeric layout specification:

- **Selector/class binding** (the actual v3 killer): CSS must scope rules to every canonical region's `data-region` attribute; page prompts receive the generated CSS class inventory verbatim and may use only those classes; assembly validation fails `REGION_STYLE_MISSING` / `ORPHANED_CLASS`.
- **Measured geometry** (already frozen by the evidence pipeline): per-region viewport-height targets from `canonicalRegionComposition`; reference image-mass from the extraction channel. Enforced by the precheck (issue #49), not by prose.
- **Role binding**: image slots carry orientation derived from the role (the v3 about slot demanded a 2:3 portrait and got a hardcoded-landscape 1344×768 collage), and CRITICAL slots carry a `mustNotSubstitute` derived from the role purpose ("full-bleed backdrop must not become contained card/mockup").
- **Preservation set**: for repairs, the list of already-passing gates/regions that directives may not restyle.

## 6. Composition contract — minimum useful schema

Extends `ImplementationContract` (backward-compatible optional block, so frozen /1 artifacts still parse):

```text
realization:
  regionStyleBinding[]        regionId + cssSelector ([data-region="{id}"])   ← binding, deterministic
  classVocabularyPolicy       "css-defined-classes-only"                      ← pages constrained to generated CSS
  contentCapacityPolicy       "copy-fits-measured-regions"                    ← Part 9 semantics as policy
  regionRealization[]         regionId +
    viewportHeightTarget?     (from canonicalRegionComposition, not invented)
    mediaMode?                full-bleed | contained | split | backdrop       (from role purpose + evidence)
    gridTopology?             columns/ratios when the Blueprint states them
    surfaceRole?              from Blueprint colorRoles/surface sequence
    mustPreserve[]            identity traits this region realizes
    mustNotSubstitute[]       anti-substitution pairs derived per Blueprint feature
  criticalImageRoles[]        slotId + orientation + role statement
```

Deliberately omitted: x/y spans, container ratios, text mass budgets — the evidence pipeline does not measure them reliably, so a schema field would invite invented numbers (the exact failure mode #39–#46 removed). "Convert rich visual intent into executable constraints" is achieved by binding + measured targets + roles, all of which the pipeline can actually verify.

## 7. Reference crops

Recommendation: **yes, phased — full page for generation, region crops for verification and repair.**

- Initial generation keeps the normalized full-page visual package (the analyzer/blueprint/generator already consume it faithfully; coverage is proven).
- The **craft preflight** and **repair** rounds are where attention economics matter: a repair round for the hero should carry `hero region contract + reference hero crop + current rendered hero crop + measured deltas`, not the full page a fourth time. Crops are cut deterministically from the frozen canonical screenshot using evidence-region boundaries the Blueprint already records (`sourceEvidenceRegionIds`).
- Cost: bounded (one crop pair per failed region, only on repair rounds). Fidelity: targeted comparison is exactly the Impeccable comp pattern adapted to REFERENCE_BOUND. Risk: low — crops are derived, frozen, and provenance-tracked like all visual inputs.

## 8. Generator ownership

Current call structure per Build Version: 1 CSS + 1 JS + 4 pages = 6 generation calls (~19 across the three retest versions incl. repairs). The count is not the problem; ownership was implicit. Recommendation: **keep incremental generation, make ownership explicit** — no architecture rewrite:

- CSS call = design-system owner: tokens, vocabulary, per-region surface rules, first-viewport geometry. (Already receives the full Blueprint; add the realization binding.)
- Page calls = markup + content owners inside the frozen vocabulary (inventory injected).
- JS/motion = a single behavior owner (unchanged).
- Repair = targeted page/region owner with the preservation set and measured deltas; never a whole-site re-roll.

## 9. DESIGN CRAFT PREFLIGHT (mode-split)

New deterministic step between assembly/preview and expensive QA — one desktop-home capture, zero LLM calls:

**Both modes (correctness floor):**
- headline clipped/off-canvas; material horizontal overflow;
- display-type scale vs Blueprint tokens (v3: 32px UA default vs 60px demanded);
- CRITICAL image slots rendered in their canonical region with meaningful displayed area, natural size > 0, orientation conforming to the slot;
- first-viewport image mass vs reference extraction when the reference has significant hero media (Part 12 gate, early);
- region height vs measured composition targets (gross-error tolerance, looser than the macro gate).

**REFERENCE_BOUND only:** the above measured-reference checks. Anti-generic detectors run **informational-only** here (they may contradict the Reference — Morabeza legitimately uses violet accents, eyebrow pills, icon tiles).

**ORIGINAL_DESIGN only:** WAZIBIZ-native antipattern detectors adapted from the Impeccable rule *concepts* (identical-card-grid scaffolding, eyebrow-on-every-section, gradient text, glow halos, bounce easing, layout-property transitions, one-radius-everywhere) + a design-specificity model check at QA ("could an unrelated product ship this unchanged?" — Anthropic's verdict question).

On precheck failure: exactly **one** informed per-page regeneration carrying the measured deltas (numbers, targets, tolerances, preservation set), then re-assemble, redeploy, re-check once. No QA repair budget consumed; unresolved findings flow into full QA as evidence. Bounded by construction; no new free-form LLM stage (the regeneration is the existing schema-bound generator call with better inputs — instruction #10 satisfied).

## 10. ORIGINAL_DESIGN upgrade (banked, PRD-gated)

Future flow once 3/5 Benchmark Pass unlocks Phase 10:

```text
Business Brief
-> Design Direction (subject-grounded; seven-candidate discipline from Impeccable new-work, adapted)
-> Anti-Generic Review (deterministic detectors + design-specificity model check)
-> Blueprint (existing stage, unchanged authority)
-> Realization Contract (same block as REFERENCE_BOUND, minus reference-derived numbers)
-> Generator (same binding; region crops N/A)
-> Craft Preflight (both-mode floor + ORIGINAL_DESIGN detectors)
-> QA-A/QA-B (unchanged)
-> bounded targeted repair
```

Anthropic's plan→review→build→critique and Impeccable's shape→craft→critique→polish both collapse into stages WAZIBIZ already has; nothing new is free-form.

## 11. Stage discipline

No new model roles. The only new model *inputs* are: class inventory (existing calls), crop pairs + measured deltas on repair rounds (existing calls), and the existing confirmation prompt gaining the imagery-fabrication restatement (#48). All new *judgment* is deterministic (detector + preflight). The design-specificity verdict for ORIGINAL_DESIGN reuses QA-A's authority with one added question — it does not add a stage.

## 12. The mode-split is not theoretical

Impeccable's own detector flags `hero-eyebrow-chip`, `ai-color-palette` (purple/violet headings), and `icon-tile-stack` — three patterns the Morabeza Blueprint mandates by name ("pill eyebrow labels", "violet accent pair", "circular violet icon tiles"). Running those rules as gates in REFERENCE_BOUND would *fail correct output*. Detectors are ORIGINAL_DESIGN quality tools and REFERENCE_BOUND diagnostics only.

## 13. Licensing

- Impeccable: Apache-2.0. Concept adoption is safe; clean-room reimplementation is planned anyway (Cloudflare-native, no CLI). If any code were ever copied verbatim, LICENSE/NOTICE attribution would be required — recommend not copying code at all; the rule *ideas* (contrast math, stripe heuristics) are unprotectable facts implemented differently here.
- Anthropic skill: proprietary license referenced in the plugin ("Full terms in LICENSE.txt"); no verbatim prompt text is copied into WAZIBIZ prompts. Concepts (subject grounding, anti-generic calibration, plan→build→critique) are adopted as unprotectable ideas, rewritten in WAZIBIZ's own domain language inside the existing prompt manifest structure.

## 14. RankForge failure → preventing concept

| v3 failure | Preventing concept |
|---|---|
| Hero collapsed/clipped (0.3 or off-canvas content) | Selector/class binding (CSS rule applies) + craft preflight (clipped headline, height vs measured target) |
| Laptop-mockup collage instead of full-bleed photography | Media-mode binding + mustNotSubstitute + image acceptance orientation/role conformance + reference hero crop at repair |
| Single-column services stack | Region-scoped grid rule actually applying (binding) + precheck region-height check (3.2 vs ~1.85 viewports) |
| UA-default typography | Display-type check vs Blueprint tokens; vocabulary binding makes the `.display-h1` rule reachable |
| Repair degradation 74 → 71 → 62 | Targeted repair with preservation set + deterministic re-measurement + REPAIR_REGRESSION guard |
| Fabricated client names in image pixels | #48 unchanged: KIE prompt prohibition, acceptance vision check, confirmation restatement (orthogonal to this analysis; fully preserved) |

## 15. Revised issue plan (replaces old #47/#48)

**#47 — CSS/HTML realization binding (the vocabulary fix).**
Goal: one styling vocabulary owned by the CSS call, consumed by every page/repair call; canonical regions styled via data-region selectors.
Changes: `ImplementationContract.realization` block (planner-derived, optional field); `extractCssClassInventory` injection into page prompts; `REGION_STYLE_MISSING`/`ORPHANED_CLASS` assembly findings; css prompt styling-contract block; image slot orientation derived from role purpose.
Tests: vocabulary-split fixture fails; conforming source passes; orientation derivation; ORIGINAL_DESIGN unaffected.
Risk: low. No new model calls. (The paused WIP in the working tree is exactly this issue and can be finished first.)

**#48 — Fabrication defenses for identity/trust content (unchanged from the old plan).**
Deterministic trust-context lint (facts-allowlisted); KIE prompt prohibition on text/logos/UI chrome; bounded acceptance vision check on CRITICAL/HIGH attempts; confirmation-QA imagery-fabrication restatement with regression tests.
Risk: low-medium (vision check adds bounded calls). Independent of #47.

**#49 — Design Craft Preflight + informed realization repair.**
Goal: deterministic gross-error gate after preview, before expensive QA; one informed per-page regeneration on failure.
Changes: extend layout extraction (headline bounds, image region attribution — already prototyped in the paused WIP); new precheck evaluator (mode-split per section 9); pipeline step; informed regen under new immutable subkeys; re-assembly + redeploy; region crops attached on repair rounds (section 7).
Depends on: #47 (binding supplies region selectors/inventory the precheck reasons over).
Risk: medium (workflow step sizing; re-assembly idempotency — both prototyped).

**#50 — Measurable repair + regression guard.**
Goal: repairs stop regressing passing work.
Changes: measured-delta directive blocks (current geometry, targets, tolerances, passing-gate list, mutation scope) for Fix Coordinator and RBF prompts; preservation set; deterministic REPAIR_REGRESSION detection surfaced in terminal reasons; confirmation loop re-runs the deterministic precheck between rounds.
Depends on: #49 (precheck supplies the between-round measurement).
Risk: low-medium.

**#51 (deferred, PRD-gated) — ORIGINAL_DESIGN craft layer:** direction discipline + antipattern detectors + design-specificity QA question, per section 10.

## 16. Explicit recommendation

**REPLACE #47/#48 with the four-issue breakdown above.** The old plan identified the right root causes and its deterministic philosophy was confirmed by both external systems, but it (a) under-specified the central mechanism (the class-vocabulary binding now backed by measured 28/59-orphan evidence), (b) placed all realization enforcement inside the QA-time macro gate instead of a cheap pre-QA craft preflight, (c) had no answer for repair-induced regression beyond "detect", and (d) would have left anti-generic/antipattern concepts unexamined. The revised plan keeps every old safeguard (gates untouched, bounded repair budgets, Business Truth rules) and adds only deterministic enforcement, better generator inputs, and targeted repair.

## 17. Work-state report (per the pause instruction)

- Committed before the pause: `4a10cb3` — forensic trace + frozen generator-negative fixture + old #47/#48 scope notes (docs only; production behavior untouched).
- Uncommitted working-tree changes (preserved, not committed/deployed): prototype #47a/#47b code in `src/domain/implementation-planner.ts`, `src/domain/site-generator.ts`, `src/lib/browser-adapter.ts` — realization contract block, class-inventory injection, `REGION_STYLE_MISSING`/`ORPHANED_CLASS` validation, orientation derivation, informed-regen entry point, layout-extraction extensions. These map 1:1 onto revised issue #47 (+ the extraction half of #49) and can be completed or discarded after operator review. No commits, no deploys, no production generations occurred after the pause.
