# NANO BANANA 2 LITE — FINAL SIMPLE BENCHMARK (Phase 6)

Status: COMPLETE. Image-provider substitution only (z-image →
nano-banana-2-lite); SIMPLE architecture, frozen blueprint, QA, single-repair
design, truth rules, approval/publication all untouched. Image validation
PASSED 6/6 → the ONE final full SIMPLE benchmark ran LIVE and reached
first-pass RELEASE_READY. No merge, no production deploy, manual source edits 0.

## Required report

```text
Branch:              experiment/simplified-design-pipeline
HEAD:                0620e9f (implementation) + this report commit

Image API:           KIE Nano Banana 2 Lite
Model ID:            nano-banana-2-lite
API reference:       https://docs.kie.ai/cn/market/google/nano-banana-2-lite
                     (product/model: https://kie.ai/nano-banana-2-lite)
                     Implemented against the documented contract —
                     POST /api/v1/jobs/createTask,
                     input { prompt (≤20000), aspect_ratio (required enum),
                     image_urls omitted for text-to-image }; z-image's
                     nsfw_checker flag NOT sent; shared jobs recordInfo
                     status lifecycle reused unchanged.

Frozen Blueprint:    d8fac165 / dabc524 — byte-exact reuse (R2
                     builds/06025a7d-74cc-4655-9718-b3a190e78f92/
                     v6/design_blueprint.json; never regenerated)

IMAGE VALIDATION (human inspection, no OCR, no image-QA model)

slot                 | text | pseudo-text | UI  | facing-screen | photo | comp | usable
hero-team-collab     | NO   | NO          | NO  | NO            | 5     | 5    | YES
about-strategist     | NO   | NO          | NO  | NO            | 5     | 5    | YES
results-celebration  | NO   | NO          | NO  | NO            | 5     | 5    | YES
testimonial-office   | NO   | NO          | NO  | NO            | 5     | 5    | YES
newsletter-owner     | NO   | NO          | NO  | NO            | 5     | 5    | YES
contact-presentation | NO   | NO          | NO  | NO            | 5     | 5    | YES

Initial usable:      6/6
Retry used:          NO (allowed by §16, not needed)
Final usable:        6/6

KIE attempts:        6 tasks (max allowed 7) — every slot attempt 1 succeeded
KIE duplicates:      0
KIE cost:            $0.30 ($0.05/task estimate; build ledger total $1.20
                     including prior phases; hard gate $3.00 intact)
KIE duration:        ~3.2 min wall for all six
Model:               nano-banana-2-lite on every attempt

Provider aspect-ratio mappings (compositionAspectRatio → providerAspectRatio,
recorded per attempt with mappingReason + blueprint/effective prompt hashes):
hero-team-collab     21:9 → 21:9  (native — the z-image 21:9→16:9 downgrade is GONE)
about-strategist      5:3 → 16:9  (composition unsupported → frozen generation ratio)
results-celebration   5:3 → 16:9  (composition unsupported → frozen generation ratio)
testimonial-office   4:3 → 4:3   (native)
newsletter-owner     3:2 → 3:2   (native)
contact-presentation 16:9 → 16:9 (native)
The screen-safe deterministic scene adaptation was applied to every request
(screenSafeAdaptationApplied true ×6) and Nano Banana 2 Lite HONORED it:
rear-facing laptop lids/backs, paper notebooks, plain-wall staging — the
exact rewrites z-image ignored.

FULL SITE (one final benchmark; validated Accepted Images inherited — no
second KIE wave)

Builder:             streamed Workers AI @cf/zai-org/glm-5.3-flash
Builder strategy:    TWO_CALL_SINGLE_STAGE (ONE_CALL attempt failed schema
                     twice on short home/about strings inside the builder's
                     own bounded boundary handling; no pipeline repair
                     involved)
Preflight 1:         PASS — Technical Preflight passed (153 checks), preview
                     deployed the exact candidate
                     (manifest 85cb0e8c68f6, 12 files)
Truth 1:             PASS — 0 findings
Repair:              NOT USED — first-pass RELEASE_READY (spec section 48),
                     the single repair budget was never touched
Repair runtime:      n/a
Legacy gateway invoked by SIMPLE: NO — every v9 semantic row is
                     workers-ai/@cf/zai-org/glm-5.3-flash
Preview marker:      PASS — exact Build Version verified through the browser
                     binding before captures; 9 real page/viewport captures
                     (no placeholder race this round)
Visual QA:           94/100 overall — macroLayout 93, typography 92,
                     spacingRhythm 93, surfaceColor 94, imageTreatment 95,
                     components 93, signatureElements 95, responsive 95.
                     Findings are polish-rank: (1) testimonial "Coming soon"
                     placeholder copy — the TRUTH-CLEAN choice, fabricated
                     client names stay blocked by the trust lint; (2)
                     newsletter illustration lighter than the reference
                     motif. Neither is identity drift.
Human Fidelity:      HIGH_FIDELITY — operator inspection of desktop+mobile
                     home, About, Services, Contact against the frozen
                     Morabeza reference: dark duotone hero over the team
                     photo, eyebrow chips, services card grid, purple process
                     band, growth-channel photo split, FAQ envelope,
                     testimonial band over the handshake photo, newsletter
                     split, dark contact CTA + full footer — all intact on
                     the real Nano Banana photography.
Image quality:       Natural documentary photography throughout; six fresh
                     assets carried onto the site verbatim (v8 assets
                     inherited by v9; zero regeneration)
Pseudo-text target:  PASS (6/6)
Technical:           PASS (0 blockers — the Phase 5 reveal-detector false
                     positive did not fire this round)
Truth:               PASS (0 findings)

Manual source edits: 0
Production:          UNTOUCHED · Main: UNTOUCHED · V1: UNCHANGED

Legacy comparison:   Legacy never produced a complete RankForge candidate
                     on this frozen input (Phase 3 record: transport-blocked,
                     visual n/a, ~17-stage design chain). SIMPLE now delivers
                     first-pass RELEASE_READY at visual 94 with 4 call-sites,
                     ≤1 repair, $0.30 image spend, ~15 min blueprint→preview.
                     SIMPLE clearly outperforms Legacy.
```

## Recommendation

MERGE_SIMPLIFIED_DIRECTION

Every GO §25 condition holds: Human HIGH_FIDELITY, Technical PASS, Truth
PASS, Nano Banana images clean (6/6, no text/pseudo-text/UI/facing screens),
manual source edits 0, SIMPLE clearly outperforms Legacy — and the remaining
"automated score below 90" question is moot: the automated Visual QA itself
scored 94/100, ABOVE the threshold, on real marker-gated captures. The
z-image instruction-adherence blocker that forced DO_NOT_MERGE in Phase 5 is
resolved by the provider substitution: nano-banana-2-lite honors the
screen-free scene rewrite and the native aspect ratios.

## Benchmark lifecycle record (GO §8)

```text
benchmark lifecycle:        existing durable polling
                            (POST /api/v1/jobs/createTask +
                             GET /api/v1/jobs/recordInfo?taskId=... — the
                             unified KIE jobs query; state success/fail,
                             resultJson.resultUrls; worked for all 6 tasks)
future production option:   KIE callBackUrl (documented; evaluate AFTER
                            SIMPLE acceptance — not in this GO)
```

## Process record (honest disclosure)

- The final-run stream dropped once at ~7.5 min (edge-side, no done/error
  event) during the FIRST invocation that created v9; the invocation died
  pre-QA having consumed no repair budget. The op gained a guarded resume
  (reuse the benchmark version ONLY while it is still the build's latest —
  refusing resumes once a repair has chained past it) and the client
  auto-reconnects; the run then completed in ONE resumed invocation
  (~14.8 min). No repair chaining occurred (repairApplied false).
- inheritedAcceptedImages=0 on the resumed invocation is expected: the
  accepted-image inheritance had already run in the dropped invocation
  (idempotent ON CONFLICT DO NOTHING copy of v8's six accepted rows onto v9).

Evidence: v2-docs/experiments/morabeza-rankforge/phase6-nano-banana-images/
(six validated Nano Banana images, kie-validation-result.json with full
per-slot provenance, frozen blueprint, v9 home desktop+mobile + About +
Services + Contact captures, final-run-result.json, v9 QA package).
```
