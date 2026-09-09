# SIMPLE FOUR-PAGE HERO FINALIZATION — REPORT (Phase 7)

Status: COMPLETE. The accepted SIMPLE direction now satisfies the global
four-page hero requirement: every routed page opens with a photographic hero
linked to a dedicated Accepted Image, enforced by the blueprint quality gate,
the builder instruction, ONE deterministic QA blocker and the visual-QA brief.
Verified live on a fresh RankForge blueprint/site. No pipeline redesign, no new
stages, no new QA subsystems, no benchmark-artifact regeneration.

## Required report

```text
Implementation SHA:   445a527 (feat) + this report commit

Blueprint contract:   design-blueprint/1 extended — every page spec's FIRST
                      section is a hero carrying `mediaSlotId`, linked to a
                      DEDICATED hero image slot (same page, hero section,
                      CRITICAL/HIGH priority; page heroes unique by default).
                      Enforced by the deterministic quality gate
                      (evaluateBlueprintQualityGate). Prompts bumped:
                      simple-design-blueprint/v4 (hero media REQUIRED field +
                      screen-free hero rules + hero mass guidance),
                      simple-website-builder/v2 (hero-media hard requirement,
                      traceable data-image-id, mobile 35-50svh mass floor),
                      simple-visual-qa/v2 (hero verification sentence).
                      No RankForge-specific hardcoding anywhere.

Home hero:            PASS (photographic, blueprint-designed ~1 viewport;
                      unchanged successful behavior)
About hero:           PASS (photographic duotone + dark panel, ~0.5 viewport)
Services hero:        PASS (full-bleed photographic wash + panel, ~0.5 viewport)
Contact hero:         PASS (split photographic hero, form below)

Hero image slots:     fresh Blueprint (hero contract) produced EXACTLY the
                      design-driven plan: home-hero (21:9 comp, CRITICAL),
                      about-hero (4:3, CRITICAL), services-hero (16:9,
                      CRITICAL), contact-hero (16:9, CRITICAL) + 3 supporting
                      slots (about-portrait, why-us-media, testimonials-bg) —
                      7 total, no ~12 target enforced.

Nano Banana attempts: 17 tasks this GO ($0.85): fresh-plan wave 9 (5 ok / 4
                      failed — see orientation finding below), post-fix wave 7
                      (7/7 ok, LIVE VERIFICATION of the fix), ONE bounded
                      stochastic retry of home-hero (1/1 ok). Build ledger
                      total $2.05 of the $3.00 hard gate.
KIE cost:             $0.85 this GO / $2.05 cumulative on the benchmark Build
Pseudo-text:          0 on all four page heroes (home retry clean; about and
                      contact exemplary; services carries faint hand-drawn
                      whiteboard sketches + sticky-note marks — no readable
                      text, no UI, no screens, muted by the wash treatment)
Desktop:              all four pages open with meaningful photographic hero
                      treatment (inspected LIVE in a browser on the exact
                      v18 Build marker, plus v14 QA captures)
Mobile:               hero keeps meaningful media height (35-50svh class),
                      text readable, no collapse to a strip, nothing hidden
                      behind the fixed nav (home inspected at 390px; QA
                      captures for the rest)
Technical:            PASS — v18 deterministic bundle QA: 0 findings
                      (INNER_PAGE_HERO_MEDIA_MISSING absent on all four
                      pages; hero image identity traceable via
                      IMG:/data-image-id); v14 candidate: 0 findings,
                      Technical Preflight 153 checks PASS
Truth:                PASS on the final artifact (v18 re-render: 0 findings).
                      NOTE the machinery PROVED itself this phase: v17's
                      first-pass lint caught two fabricated testimonial names
                      ("S. Mwangi", "A. Otieno") — zero tolerance held, the
                      ONE repair removed them.
Visual:               v14 (real captures): RELEASE_READY first-pass, 94/100
                      overall, imageTreatment 92, no repair. v17 first-pass
                      (real captures): 88/100 before the truth-driven repair.
                      v18's automated visual score is INVALID EVIDENCE: both
                      evaluation captures (pipeline + rerender-QA) raced the
                      freshly-provisioned preview hostname and rendered the
                      Cloudflare placeholder (visual 3/40) — the Phase 5
                      finding B colo-flap, now observed to PERSIST across
                      rerenders for a given fresh hostname while external
                      clients see the exact Build-marker site (v18 screenshot
                      evidence). Recorded, not hidden; the deterministic gates
                      on the same artifact are clean.
Human coherence:      PASS — live inspection of desktop Home/About/Services/
                      Contact + mobile Home on the exact v18 build: same
                      silhouette grammar as the reference (duotone heroes,
                      eyebrow chips, card grids, process band, dark CTA +
                      footer), natural photography throughout.
Tests:                18 new focused tests (tests/v2-four-page-hero.test.ts):
                      blueprint requires hero media on all four pages;
                      wrong-page/non-hero/NORMAL-priority slot rejection;
                      unique-page-hero default; hero slot ids exposed; image
                      plan carries page-hero slots; orientation follows the
                      PROVIDER-resolved ratio (live-regression proof);
                      typography-only About/Services/Contact heroes trigger
                      INNER_PAGE_HERO_MEDIA_MISSING; unreferenced/out-of-region
                      hero images rejected; data-image-id traceability; Nano
                      Banana screen-free adaptation covers every page hero;
                      builder prompt ships the 35-50svh mobile rule. FULL
                      SUITE 615/615.
Typecheck:            PASS (tsc --noEmit clean)
Dry-run:              PASS (wrangler deploy --config wrangler.exp.jsonc
                      --dry-run clean)
CSO:                  SECURITY OK WITH WATCH ITEMS
                      (docs/security/CSO-2026-09-09-four-page-hero-nano-banana.md —
                      experiment driver ops remain double-gated; no auth/
                      payment/secret changes; watch items recorded)

Recommended merge:    YES — merge the SIMPLE direction to main per the
                      operator's §21 plan.
Legacy removal:       DEFERRED (separate cleanup after main verification)
Production:           UNTOUCHED
V1:                   UNCHANGED
```

## Live findings recorded this phase

```text
A. ORIENTATION-CONFORMANCE vs PROVIDER RATIO (fixed + live-verified): the
   durable acceptance gate judged downloaded images against slot orientation
   derived from the blueprint's GENERATION ratio, while the nano-banana
   substitution requests the COMPOSITION ratio where natively supported. A
   4:3-composition / 1:1-generation slot received the CORRECT 4:3 image and
   was rejected as square-mismatched, burning both attempts (v12). Fix: slot
   orientation is now derived from the SAME provider-ratio resolution the
   adapter uses (src/lib/aspect-ratio.ts); post-fix wave 7/7 accepted.

B. MODEL ADHERENCE TO NEW CONTRACT FIELDS: the first fresh blueprint emitted
   hero sections without mediaSlotId (gate rejected, stage escalated
   per-spec); the second linked a body slot (gate rejected). The hardened v4
   prompt (REQUIRED field + rejection consequence + dedicated-hero-slot rule)
   produced a conforming blueprint. Two deterministic rejections before
   success — the gate did exactly its job; disclosed for prompt-engineering
   provenance.

C. PREVIEW CAPTURE RACE — UPGRADED EVIDENCE: the Phase 5 colo-flap (finding B)
   is now observed to persist for a fresh preview hostname: BOTH the pipeline
   evaluation and a later rerender-QA captured the Cloudflare placeholder for
   v17/v18 while external clients (and the operator's browser) receive the
   exact Build-marker site. v18 live screenshots preserved as evidence. The
   per-capture marker re-verification remains the recorded (unfixed) remedy.

D. REPAIR STOCHASTICITY: the v15 invocation's ONE repair hallucinated an
   off-contract bundle (static /images/*.jpg paths, invented /privacy//blog
   links, broken form contract) — every deterministic gate refused it and the
   pipeline stopped correctly (HUMAN_REVIEW_REQUIRED, no loop). A fresh
   builder run on the same clean images succeeded first-pass (v14) / with
   truth-driven repair completing cleanly (v17→v18 deterministic).

E. TRUTH LINT LIVE CATCH: fabricated testimonial identities in v17's
   first-pass bundle were caught verbatim and removed by the ONE repair —
   zero-tolerance trust lint verified again live.
```

Evidence: v2-docs/experiments/morabeza-rankforge/phase7-four-page-hero/
(four final hero images, v18 live desktop/mobile screenshots, v14 RELEASE_READY
captures incl. all four inner pages, v17 first-pass QA package, v14/v18 QA
packages, fresh hero-contract blueprint, invalid placeholder capture, run JSONs).
