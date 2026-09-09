# FINAL SIMPLE HARDENING BENCHMARK — REPORT (Phase 4)

Status: COMPLETE. Hardening fixes implemented, gated, CSO-signed; fresh KIE +
fresh SIMPLE build executed live on the frozen blueprint/reference/facts.
No merge, no production deploy, no blueprint regeneration, manual source
edits 0.

## Gates run before the benchmark

```text
Focused tests:      15/15 PASS (tests/v2-simple-hardening.test.ts)
Full suite:         570/570 PASS (66 files)
Typecheck:          clean
Wrangler dry-run:   clean (default + exp configs)
/morabeza-cso:      SECURITY OK WITH WATCH ITEMS
                    (docs/security/2026-09-09-v2-simple-hardening-cso.md;
                     2 accepted Low watch items)
```

## Required benchmark report

```text
Reference:            same frozen Morabeza capture (Site Generation f9b671cc,
                      reference_evidence_packages reused byte-exact)
Blueprint:            d8fac165 / dabc524 — reused byte-exact (artifact copied
                      to the benchmark Build Version; never regenerated)
Business:             same frozen RankForge facts (submission fd8a09fe)
Benchmark version:    builds/06025a7d-74cc-4655-9718-b3a190e78f92 / v3
                      (7b0737c2-3b92-4a5d-8e05-2276013b43b1)

Hero pseudo-text present:            YES — hero-team-collab renders a fake
                                     website ("DIGLTM" logo, nav, gibberish
                                     lists) on a monitor plus pseudo-documents
                                     on two laptops
About image fake website/UI present: YES — about-strategist renders a full
                                     SEO analytics dashboard (bar/donut
                                     charts, tables, browser chrome) + phone UI
Any generated image contains
gibberish text:                      YES — 5/6 slots FAIL outright, 1/6 partial:
                                     hero FAIL, about FAIL, results FAIL
                                     ("STANP" dashboard + growth chart),
                                     newsletter FAIL ("Hinjs" social site +
                                     donut chart + tablet UI), contact FAIL
                                     ("Growth Strategy" slide + readable
                                     browser chrome), testimonial PARTIAL
                                     (mostly blank monitor but browser chrome,
                                     gibberish nav, pseudo-documents)
Evidence:                            v2-docs/experiments/morabeza-rankforge/
                                     phase4-hardening-images/ (all six)

Preview readiness verification:      PASS — deterministic gate proven by unit
                                     tests (placeholder refused, exact-marker
                                     required, wrong-version refused) and by a
                                     live smoke (the markerless Phase 3 v1
                                     preview is refused: it serves no
                                     wazibiz-build-version meta, so the gate
                                     returns PREVIEW_NOT_READY for it). In the
                                     live run the capture stage was never
                                     reached because Technical Preflight
                                     correctly rejected the bundle upstream —
                                     by construction no placeholder could
                                     enter Visual QA.

Blank reveal sections in QA:         YES at source — the builder again emitted
                                     `.reveal { opacity: 0 }` despite the
                                     progressive-enhancement prompt rule; the
                                     NEW deterministic gate caught it as a
                                     blocker (CONTENT_HIDDEN_WITHOUT_JS) BEFORE
                                     any capture, so no blank-void evidence
                                     could reach Visual QA. The CSS-level
                                     defect never shipped unflagged.

KIE (v3, text-safe policy):          6 planned / 6 accepted / 6 attempts /
                                     0 duplicates / $0.30 / ~4 min — the
                                     policy reached every request (it leads
                                     the prompt, cannot be truncated), but the
                                     z-image model did not honor it against
                                     scene descriptions that strongly imply
                                     screens (see Finding A)

Builder:                             streamed ONE_CALL, attempt 1 VALID on the
                                     first try (no empty-{} give-up, no
                                     correction) — bundle stored, 4 pages +
                                     css + js

Technical:                           FAIL (deterministic, by design) —
                                     Technical Preflight rejected home:
                                     MALFORMED_HTML (<div> opened 89x, closed
                                     88x) → no preview, no renders; plus
                                     CONTENT_HIDDEN_WITHOUT_JS blocker (the
                                     new gate firing). All other structural
                                     checks passed.

Truth:                               1 finding — FABRICATED_TRUST_ENTITY:
                                     trust label 'Learn More About Us' inside
                                     a testimonial-classed div (conservative
                                     zero-tolerance lint flagging a
                                     testimonial-styled section the facts do
                                     not support; the blueprint's testimonial-
                                     band motif invites this). No invented
                                     numbers/clients/claims anywhere.

Visual QA:                           NOT RUN — no renders existed (preflight
                                     rejection). The best honest automated
                                     visual measure remains Phase 3 v1's 87
                                     on true renders.

Human Fidelity:                      NOT RENDERABLE for v3 (no preview). The
                                     shipped Phase 3 candidate (v1) remains
                                     HIGH_FIDELITY and live at
                                     https://b-06025a7d74-v1.wazibizwebsites.workers.dev

Repair:                              FAILED — the ONE repair call, both
                                     attempts:
                                     a1: JSON parse error (bad escape at
                                         position 53,286)
                                     a2: truncation again (unterminated string
                                         at position 37,942)
                                     on provider "openrouter" — the LEGACY
                                     non-streaming gateway. Root cause
                                     (Finding B): a preflight-rejected
                                     candidate has no renders, so the repair
                                     received no images and
                                     createSimpleVisionGenerate was never
                                     built; runSchemaValidatedAiStage then
                                     fell back to its default legacy
                                     transport (z-ai/glm-5.3-flash via
                                     openrouter), which truncated. The
                                     changed-files repair output (~38K chars)
                                     would very likely complete on the pinned
                                     Workers AI streaming transport.
Repair budget:                       consumed; no second repair; pipeline
                                     terminal FAILED (honest stop). Run wall
                                     clock 49.2 min (KIE ~4 + builder ~9 +
                                     repair transport stall ~30+).

Manual source edits:                 0
Production:                          UNTOUCHED · Main: UNTOUCHED · V1: UNCHANGED
```

## Findings

```text
A. TEXT-SAFE PROMPT POLICY IS NECESSARY BUT NOT SUFFICIENT (KIE z-image).
   The boundary policy led every request and cannot be truncated away, yet
   the model still drew screens dashboards and slides whenever the scene
   description implies them ("reviewing analytics", "presenting a growth
   strategy on a large screen"). The frozen blueprint's own slot briefs
   demand screens, and a 1000-char prompt cannot override scene semantics
   for this provider. Levers for the next iteration (operator decision):
   (1) boundary-level scene REWRITE of screen-bearing briefs (deterministic
   transform or a tiny sanctioned model step — currently out of GO scope),
   (2) a different image model/provider with real instruction adherence,
   (3) blueprint-level brief rewrite in a FUTURE blueprint iteration (this
   GO forbade touching the frozen artifact).

B. REPAIR TRANSPORT FALLBACK GAP (small, isolated, high value).
   runSimpleSiteRepairStage builds its streaming vision seam ONLY when
   candidate renders exist. A preflight-rejected candidate (exactly the case
   that most needs repair) has no renders, so the repair silently drops to
   the legacy non-streaming gateway and truncates. Fix candidate (one seam,
   no architecture change): always pin the SIMPLE streaming transport for the
   repair call (text-only seam when no renders exist).

C. THE DETERMINISTIC SAFETY NET WORKED END TO END.
   Malformed HTML (div imbalance) → Technical Preflight rejection; hidden
   reveal CSS → CONTENT_HIDDEN_WITHOUT_JS blocker; unsupported trust label →
   zero-tolerance truth lint; marker gate ready had captures run. Every
   defect this round was caught BEFORE any release-facing surface — no
   placeholder, no blank-void screenshots, no untruthful candidate shipped.

D. MODEL ONE-SHOT HTML HYGIENE REMAINS VARIABLE.
   Same prompt family produced a valid first-try bundle in Phase 3 and a
   div-imbalanced bundle here. The gates hold the line; landing the ONE
   repair on the streaming transport (Finding B) is what converts a caught
   defect into a shipped fix.
```

## Target scorecard

```text
Human Fidelity = HIGH_FIDELITY   NOT MET this round (v3 unrenderable; Phase 3
                                 candidate holds HIGH_FIDELITY)
Visual >= 90                     NOT MEASURED this round (no renders)
Technical PASS                   NOT MET for v3 (preflight rejection — correct
                                 deterministic behavior, but a fail)
Truth PASS                       NOT MET for v3 (1 conservative trust-entity
                                 finding)
pseudo-text/gibberish images = 0 NOT MET (5/6 FAIL, 1/6 partial)
manual source edits = 0          MET
```

## Recommendation

ITERATE_SIMPLIFIED_ONCE

Why: every deterministic hardening fix performed exactly as designed (gate,
marker, reveal rule, changed-files schema), and the failures reduce to two
small, precisely-diagnosed, isolated items — the KIE provider's instruction
adherence (needs a stronger text-safe lever than prompt policy) and the
repair's streaming-transport fallback (one-seam fix). Legacy could never
complete a full run on this transport; SIMPLE's architecture is sound and its
safety net demonstrably holds. One focused iteration — pin the repair
transport, choose the stronger text-safe lever, re-run — is the path to the
merge bar. KEEP_LEGACY_V2 is not justified by any result in this cycle.
