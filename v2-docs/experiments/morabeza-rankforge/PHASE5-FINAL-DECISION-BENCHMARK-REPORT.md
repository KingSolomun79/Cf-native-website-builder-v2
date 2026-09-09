# FINAL SIMPLE DECISION BENCHMARK — REPORT (Phase 5)

Status: COMPLETE. All five GO-scoped fixes implemented, gated, deployed; the
final benchmark ran LIVE end-to-end on the frozen blueprint/reference/facts
(fresh Build Version, fresh KIE, streamed builder, marker-gated captures, QA,
changed-files repairs). No merge, no production deploy, blueprint untouched,
manual source edits 0.

This is the final permitted SIMPLE iteration. Recommendation below is the
operator merge decision input; per the GO, no further automatic SIMPLE
iterations follow.

## Required report

```text
Branch:              experiment/simplified-design-pipeline
HEAD:                5ca131f (implementation) + this report commit
Blueprint:           d8fac165 / dabc524 — reused byte-exact (canonical JSON
                     identity proven against the frozen artifact before the
                     final evaluation; never regenerated)

Image screen-safe adaptation:
IMPLEMENTED + REACHED EVERY REQUEST — deterministic screen-free scene
rewrite at the KIE boundary (11 ordered phrase rewrites + stripped
superseded self-policy tails + leading SCREEN-FREE PHOTOGRAPHY REQUIREMENT
clause + unchanged negative list), pure prompt transform, no new model
stage, no slot-id hardcoding. Provenance per attempt: blueprintPromptHash,
effectivePromptHash, screenSafeAdaptationApplied (kie_screen_safe_provenance
log). Unit-tested against all six frozen briefs: every rewritten brief is
screen-free and semantically preserved; every assembled prompt <= 1000 chars.
RESULT AT THE PROVIDER: FAIL — z-image still rendered facing screens with
fabricated UI/pseudo-text in all six images (see Images).

Images (manual classification, human inspection of all six, preserved in
phase5-final-images/):
slot                  | visible text | pseudo-text | UI  | visible screen
hero-team-collab      | YES          | YES         | YES | YES  FAIL
about-strategist      | YES          | YES         | YES | YES  FAIL
results-celebration   | YES          | YES         | YES | YES  FAIL
testimonial-office    | YES (chrome) | YES         | YES | YES  FAIL
newsletter-owner      | YES          | YES         | YES | YES  FAIL
contact-presentation  | YES          | YES         | YES | YES  FAIL
Target NO/NO/NO/NO: 0/6 PASS (Phase 4 was 1/6 partial). The rewritten scene
elements DID reach the provider (e.g. newsletter-owner renders the rewritten
paper-notebook moment) but z-image ADDED facing monitors/browser UI anyway.

KIE:                 6 planned / 6 accepted / 6 attempts / 0 duplicates /
                     $0.30 / ~5 min (fresh wave on the benchmark version)

Builder:             streamed, Workers AI pinned. ONE_CALL truncated at
                     ~102-111K chars (2 boundary attempts), then the allowed
                     TWO-CALL SINGLE-STAGE fallback completed: shell VALID,
                     four-pages VALID. Bundle stored; the benchmark candidate
                     rendered a complete site.

Preflight 1 (v5):    PASS — assembly + Technical Preflight accepted the
                     candidate; preview deployed (first candidate was
                     renderable, unlike Phase 4).

Truth 1 (v5):        PASS — 0 findings. The #5 trust-lint fix is verified
                     live: the Phase 4 FABRICATED_TRUST_ENTITY false positive
                     class ("Learn More About Us" CTA in a testimonial-classed
                     container) no longer fires; fabricated entities in
                     genuine identity slots remain blocked (unit tests).

Preview marker:      PASS, after a transport fix — the hardening pass's gate
                     polled via Workers-Runtime fetch(), and Cloudflare
                     error 1042 bars a Worker from fetching *.workers.dev
                     hosts (live-proven: 45+ min of 404 "error code: 1042"
                     from the Worker while external clients saw the exact
                     candidate). Fix keeps the gate's exact semantics and
                     verifies the marker through the browser binding
                     (waitForPreviewMarkerViaBrowser). With the fix the gate
                     verified the EXACT candidate marker and captures ran.

Visual QA 1 (v5):    84/100 — truth-mandated adaptation visible in the
                     renders; findings are composition-rhythm polish (results
                     photo panel, services 4/wide/4 rhythm, mobile hero
                     inset), not identity drift.

Human Candidate 1:   HIGH_FIDELITY (operator inspection of v5 desktop+mobile
                     captures against the frozen Morabeza reference: same
                     silhouette grammar — dark duotone hero over photo,
                     eyebrow chips, services card grid, why-choose photo
                     split, FAQ accordion, testimonial band over photo,
                     newsletter split, dark contact CTA + footer).

Repair:              USED — and disclosed: TWO changed-files repairs ran
                     (v5→v6: site.css, site.js; v6→v7: site.css,
                     index.html). Each pipeline INVOCATION performed at most
                     ONE repair (the spec budget held per invocation); the
                     chaining across v6 was caused by the operator's repeated
                     resume invocations after infrastructure failures, not by
                     pipeline code. Honest disclosure per the no-unbounded-
                     loop rule.

Repair runtime:      workers-ai (BOTH repairs — the #2 transport pin is
                     verified LIVE: every SIMPLE semantic row in this run is
                     workers-ai/@cf/zai-org/glm-5.3-flash; the only openrouter
                     rows in the ledger are Phase 4's, pre-fix).

Legacy gateway invoked by SIMPLE:  NO

Preflight 2 (v6):    PASS (renderable, captured).
Truth 2 (v6):        PASS — 0 findings.
Visual QA 2 (v6):    85/100 (repair improved some composition findings;
                     below the 90 threshold).

Final preview:       v7 terminal HUMAN_REVIEW_REQUIRED — BUT the v7
                     evaluation is INVALID EVIDENCE: its captures raced the
                     freshly-provisioned preview hostname and rendered the
                     Cloudflare placeholder ("There is nothing here yet",
                     preserved as v7-INVALID-placeholder-capture.png), so its
                     visual 7 is the placeholder's score, not the site's.
                     The deterministic gates correctly refused the dark
                     preview twice earlier; the remaining gap is colo-level
                     flapping DURING captures (gate poll passed, capture
                     navigations hit the un-provisioned edge).

Final Human Fidelity: HIGH_FIDELITY — held by the last validly evaluated
                     candidates (v5 and v6 renders, inspected by the
                     operator).

Pseudo-text target:  FAIL (0/6).

Technical:           PASS in substance — the only technical blocker on v5/v6
                     is CONTENT_HIDDEN_WITHOUT_JS, and it is a DETERMINISTIC
                     FALSE POSITIVE this round: the builder (and the repair)
                     emitted the SANCTIONED pattern (hidden reveal state
                     scoped under html.js, which site.js adds; content is
                     fully visible without JavaScript; home does not even use
                     .js-reveal). The reveal detector (a) swallows CSS
                     comments into its selector group and (b) does not
                     recognize html.js-scoped hiding as safe. Recorded as a
                     small, isolated detector fix for a future iteration.

Truth:               PASS (0 findings on v5/v6/v7).

Visual:              84 (v5, first candidate) / 85 (v6, after ONE repair) —
                     below the unchanged 90 threshold. v7's 7 is invalid
                     (placeholder capture).

Manual source edits: 0
Production:          UNTOUCHED · Main: UNTOUCHED · V1: UNCHANGED
```

## Recommendation

DO_NOT_MERGE

The single remaining blocker:

```text
KIE z-image instruction adherence: the provider fabricates visible screens,
browser/website UI and pseudo-text in photographic slots REGARDLESS of
prompt-level control. The negative-only policy (Phase 4: 5/6 FAIL) and the
positive screen-free scene rewrite + binding clause + negative list (this
round: 0/6 PASS) are both proven insufficient. A merged SIMPLE pipeline
would ship fabricated-UI imagery in site heroes.
```

Everything else the GO ordered now demonstrably works, most of it proven
live: first-pass renderable candidate (preflight PASS), repair transport
pinned end-to-end on Workers AI streaming (no legacy/OpenRouter row anywhere
in this run), changed-files repair completing in ~30-220s, truth lint clean
with the CTA false positive fixed, the preview-readiness gate holding (after
the error-1042 transport fix), and the deterministic safety net catching
every defect before any release-facing surface. The automated visual score
(84/85) vs human fidelity (HIGH) disagree by calibration and composition-
polish, not identity drift — per the GO that delta is now an operator data
point, not a goalpost.

Operator decision space for the image blocker (outside this GO's scope):
(1) a different image model/provider with real instruction adherence at the
same KIE boundary, (2) a sanctioned post-generation rejection lever (would
need a GO amendment — image QA was explicitly out of scope), or (3) a
blueprint-level brief rewrite in a FUTURE blueprint iteration (the frozen
artifact stays untouched here).

## Infrastructure findings preserved for the record

```text
A. CF error 1042 (workers.dev loopback): any in-Worker readiness check of a
   workers.dev preview is structurally impossible; browser-binding transport
   is the fix (qa-capture.ts). The Phase 4 "live smoke" of the gate only
   ever exercised the REFUSING path — the positive path was unverifiable
   in-production until this fix.

B. Colo-flap capture race: a fresh preview hostname can serve the marker on
   the gate poll and then serve placeholder content to capture navigations
   (v7 evidence, preserved). The gate needs a per-capture re-verification or
   a post-capture marker assertion; recorded, not fixed in this GO.

C. Resume-driven repair chaining: repeated pipeline invocations each carry
   their own ONE-repair budget. Single-invocation behavior is spec-correct;
   cross-invocation chaining is operator tooling behavior, disclosed above.

D. Workers AI transient 8005 on a multimodal call cleared on retry; the
   bounded transport behaved as designed.
```

Evidence: v2-docs/experiments/morabeza-rankforge/phase5-final-images/
(all six fresh images, v5/v6 home desktop+mobile captures, reference,
invalid v7 placeholder capture, full run result JSON).
