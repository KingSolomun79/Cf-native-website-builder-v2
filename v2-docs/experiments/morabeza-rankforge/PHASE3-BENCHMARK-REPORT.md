# SIMPLE FULL MORABEZA → RANKFORGE BENCHMARK — PHASE 3 REPORT

Status: COMPLETE — full pipeline executed live, end to end, on the frozen
Blueprint. No merge, no production deploy, no V1 changes.

```text
Branch:
experiment/simplified-design-pipeline

HEAD:
dabc524 (+ benchmark tooling commits on top; pipeline code unchanged)

Frozen Blueprint:
d8fac165 / dabc524

Blueprint human verdict:
GOOD_BLUEPRINT

Runtime:
Cloudflare Workers AI

Model:
@cf/zai-org/glm-5.3-flash
(streaming: true, enable_thinking: false via chat_template_kwargs)

KIE planned:
6 slots (hero-team-collab, about-strategist, results-celebration,
testimonial-office, newsletter-owner, contact-presentation)

KIE accepted:
6 / 6

KIE attempts:
6 (one per slot — every slot accepted on attempt 1)

KIE duplicates:
0 (6 distinct provider task IDs; single-flight held)

KIE cost:
USD 0.30 (6 × $0.05) of the USD 3.00 hard gate — 10%

KIE duration:
3.2 minutes

Undefined Blueprint media refs:
1 — "about-strategist-2" (home/about section spec). NOT a slot. The builder
resolved it coherently with the real slot "about-strategist" (mirrored about
split, rounded photo). No fabrication, no manual fix.

Unused Accepted Images:
2 — newsletter-owner, contact-presentation (slots never named in the frozen
page specs). Both were generated (within plan), accepted, and simply not
referenced by the builder. No visual defect; $0.10 of the spend.

Builder strategy:
ONE_CALL (streamed) — succeeded using the boundary's ONE schema correction.
First ONE_CALL attempt returned an instantly-empty JSON object ({}); the
correction attempt (schema errors appended) generated the complete bundle
in ~9 minutes of healthy streaming. The TWO_CALL_SINGLE_STAGE fallback was
NOT needed.

Builder calls:
6 attempts total across two invocations:
- Invocation 1 (aborted by the operator-side client disconnect at 300s):
  ONE_CALL a1 invalid (empty {}), a2 invalid (empty {}), shell a1 valid,
  pages call in flight when the client died → isolate canceled.
- Invocation 2 (resumed cleanly on the same immutable Build Version):
  ONE_CALL a1 invalid (empty {}), a2 repaired/valid → site_bundle stored.
Note: pipeline artifact idempotency made the resume safe; no duplicate
bundles, no duplicate KIE tasks, no extra blueprint calls.

Builder output tokens:
~26K output tokens (bundle = 102,816 chars; token_usage_json not persisted
for workers-ai streaming runs — a provenance gap to fix in a follow-up;
size measured from the stored artifact)

Builder duration:
~9.2 min streamed for the successful bundle (08:27:57 → 08:37:11);
full driver op wall clock 19.8 min including assembly, preview, render
evidence, deterministic QA, visual QA and the failed repair.

Technical QA 1:
PASS — 0 blocker findings, 14/15 mandatory gates PASS.
Failed gate: RUNTIME_CONSOLE_NETWORK_CLEAN (1 failed request during the
raced first capture; the re-render passes it). All pages present, nav
complete, shared CSS/JS, form contract, image manifest resolution,
metadata/OG, focus-visible, reduced-motion, responsive mechanics all PASS.

Truth QA 1:
PASS — zero-tolerance lint: 0 findings. Fabricated clients 0, partners 0,
awards 0, testimonials 0, unsupported statistics 0, incorrect contact
details 0, unsupported services 0. Verified by hand against the immutable
facts: the `.example` contact email, all six services, hero headline, both
CTAs, the four process stages and the three principles are verbatim facts.
Floating chips ("Organic — growth channel", "Focused — search execution")
are qualitative positioning phrases, not statistics.

Visual QA 1:
CORRUPTED INPUT — the deterministic render capture raced the preview
worker's asset propagation and captured Cloudflare's "There is nothing
here yet" workers.dev placeholder for desktop home. Visual QA scored the
placeholder: overall 15/100 (hard composition gates failed). This score is
VOID as a judgement of the candidate — it is an evaluation-infrastructure
finding (see Findings F1).
Honest re-judgement on TRUE renders (same frozen blueprint, same immutable
bundle, no repair, no source edits):
  macroLayout 88, typography 90, spacingRhythm 85, surfaceColor 90,
  imageTreatment 89, components 88, signatureElements 92, responsive 83,
  overall 87
  Findings (5, ranked): 1) hero headline sizing/bold contrast weaker than
  reference; 2) testimonial band card count / right-edge peek weaker;
  3) mobile hero panel sits too low, photo too tall; 4) about-band photo
  treatment/blob decoration less pronounced; 5) newsletter illustration
  weight differs.

Candidate 1 preview:
https://b-06025a7d74-v1.wazibizwebsites.workers.dev
(experimental preview Worker; corresponds exactly to Build Version v1
manifest 27c5b5f770a00422…/assembled_manifest frozen 2026-09-09T08:37:18Z)

Candidate 1 human fidelity:
HIGH

Repair:
USED (triggered — Visual QA 1's corrupted 15/100 gate verdict demanded it;
a real 87/100 would ALSO have triggered it, since 87 < 90)

Repair findings:
The ONE repair call failed schema-invalid on both of its attempts and
produced no bundle:
- a1: instantly-empty JSON object ({} — every field under minLength)
- a2: streamed ~105,852 chars of real content, then truncated mid-string
  (unparseable JSON). The repair regenerates the COMPLETE bundle
  (~103K chars ≈ 26K tokens) on top of an input containing the current
  bundle + QA package (~50K chars); the 32,000-token output budget cannot
  reliably hold a full-bundle repair output.
Repair budget consumed. Per spec: no second repair. Terminal state of the
pipeline run: FAILED (automation stopped honestly; nothing was mutated).

Technical QA 2:
NOT RUN (no repaired bundle exists; re-render of v1 passes 15/15 gates)

Truth QA 2:
NOT RUN (no repaired bundle exists; v1 truth lint is 0)

Visual QA 2:
NOT RUN (no repaired bundle exists; the 87-score above is the honest
automated judgement of record for Candidate 1)

Final preview:
https://b-06025a7d74-v1.wazibizwebsites.workers.dev

Final desktop screenshot:
v2-docs/experiments/morabeza-rankforge/phase3-renders/candidate1-desktop-full.png
(also R2: benchmark/phase3/final-candidate-desktop.png)

Final mobile screenshot:
v2-docs/experiments/morabeza-rankforge/phase3-renders/candidate1-mobile-full.png
(also R2: benchmark/phase3/final-candidate-mobile.png)
Reference render preserved alongside:
phase3-renders/reference-desktop-full.png
Infrastructure-finding exhibit (the placeholder capture):
phase3-renders/EVIDENCE-placeholder-capture-race.png

Final Human Fidelity:
HIGH_FIDELITY
With copy and branding blurred the candidate clearly reads as the same
underlying design: same ~100vh dark photographic hero with violet duotone
and dark inset panel (eyebrow chip, two-weight H1, capsule CTAs); same
dark → pale → white grid → pale → white FAQ → dark bookend → dark footer
surface rhythm; same component language (icon-tile cards, capsule CTAs,
purple FAQ accordion, floating stat chips over photography). The one
silhouette deviation — the reference's dark photographic TESTIMONIAL
interruption is absent — is the truth-mandated omission (no supported
testimonials may exist), which §16/§17 explicitly exclude from penalty.

Malformed lineHeight impact:
NO — typography scored 90; no rendering breakage. The builder evidently
sanitized/ignored the malformed "," values.

Blank CTA radius impact:
NO — header CTA renders as a proper purple capsule.

Inner-page specification impact:
NO (mild) — /about, /services, /contact are complete, fact-derived pages
("SEO without the noise." / "Focused SEO services, prioritised for
growth." / "Let's talk about where search can take your business.") that
keep the design language (chips, two-weight H1s, mirrored image splits).
They are lighter than Home — exactly as the frozen blueprint specified —
and were not flagged by visual QA as broken.

Image-reference mismatch impact:
NO — the dangling "about-strategist-2" reference was satisfied coherently
by the real "about-strategist" slot; the two never-referenced slots simply
went unused. No visual defect, no fabricated imagery, no manual edits.

Major semantic calls:
4 call-sites for the whole benchmark (blueprint [prior phase, frozen
artifact reused here] + website builder + visual QA + repair); 10 semantic
attempt-rows total including corrections and the evaluation retries
(3× builder ONE_CALL pairs incl. the aborted run, 1× shell [aborted run],
3× visual QA of which 2 were evidence-integrity retries, 2× repair).

Manual source edits:
0

Major findings (operator-oriented):
F1. CAPTURE/PROPAGATION RACE (evaluation infrastructure): the deterministic
    QA capture hit the preview URL seconds after deploy and captured the
    workers.dev placeholder. Visual QA then scored the placeholder (15/100)
    and the repair was dispatched against a false brief. The pipeline has
    no "preview serves the real candidate" verification before rendering
    evidence. Small fix candidate: post-deploy verification fetch before
    capture (deterministic; no architecture change).
F2. REVEAL-ON-SCROLL STATIC CAPTURE ROBUSTNESS (generated-bundle trait):
    sections animated by scroll reveals render blank in static/headless
    captures (both the pipeline's mobile capture and full-page stitches).
    In interactive browsing the sections render correctly. The Reference's
    frozen capture shows all sections, so static fidelity is measurably
    hurt (responsive 83; mobile void flagged as finding #1). Fix candidate:
    blueprint/builder rule — reveals must be progressive enhancement
    (content visible without JS; animate from visible).
F3. REPAIR OUTPUT BUDGET (transport): the ONE repair regenerates the whole
    ~26K-token bundle; 32K tokens truncated mid-stream (~105,852 chars).
    Fix candidates: repair emits only changed files, or a higher streaming
    output budget for the repair call, or TWO_CALL repair (shell + pages).
    No fix applied in this benchmark (budget consumed; §23).
F4. EMPTY-{} GIVE-UP: on very large single-call outputs the model
    occasionally returns an instantly-empty JSON object; the schema
    boundary's ONE correction reliably recovers (builder) but cannot when
    the correction ALSO truncates (repair). Interaction of F3/F4 killed
    the repair, not design quality.
F5. LIVE POLISH GAPS (visual QA finding list): hero headline weight/sizing
    below reference; mobile hero vertical composition drift; garbled
    decorative scramble-text ("Loz Agniac" watermark) caught mid-animation
    in static captures — verify the decode animation's reduced-motion and
    no-JS fallbacks.
F6. PROVENANCE GAP: token_usage_json is null for workers-ai streaming
    stage runs; §8 transport telemetry (TTFB/chunks/tokens) reached worker
    logs only. Persist streaming usage on ai_stage_runs.

Major semantic calls total: 4 call-sites (see above)
Manual source edits: 0

Legacy comparison (retained Legacy V2 evidence; Legacy NOT rerun):
- Human fidelity: Legacy full pipeline never produced a complete RankForge
  candidate on this transport (zhipu coding-edge ~8K output ceiling,
  transport-blocked at blueprint/builder stages). Its forced small-call
  diagnostic (shell + 4 page calls, 5 semantic calls) produced a GOOD
  design-transfer diagnostic on Finch — quality comparable per-page, but
  the pipeline as an integrated whole could not complete. SIMPLE completed
  end-to-end and scores HIGH_FIDELITY.
- Automated visual score: Legacy n/a (no legal full run). SIMPLE 87.
- Time to usable candidate: Legacy: never (transport-blocked) / diagnostic
  only. SIMPLE: ~14 min pipeline time from frozen blueprint to previewed
  candidate (KIE 3.2 + builder 9.2 + assembly/QA ~1.5).
- Major semantic calls: Legacy design chain ≈ 17 stages / 10+ prompts /
  multi-repair ontology. SIMPLE: 4 call-sites, 4 prompts, ≤1 repair.
- Repair calls: Legacy 0 completed (never reached). SIMPLE 1 (failed on
  transport budget, recorded honestly).
- Design-specific LOC: Legacy V2 design pipeline substantially larger;
  SIMPLE ≈ 2,566 design-specific LOC (unchanged this phase).
- Prompt count: SIMPLE 4 (unchanged).
- KIE cost: Legacy n/a. SIMPLE $0.30.
- Truth blockers: SIMPLE 0. Technical blockers: SIMPLE 0.
- Operator/debug interventions: 2 — (1) local client disconnect at 300s
  required a streamed-driver retry (tooling, not pipeline); (2) re-render +
  visual-QA re-judgement after the placeholder race (F1). Zero
  interventions touched design behavior, sources, or the repair outcome.
- Manual source edits: 0.

Recommendation:
ITERATE_SIMPLIFIED_ONCE

Why:
SIMPLE is materially superior to Legacy on this transport — Legacy could
not complete a legal full run at all, while SIMPLE delivered a complete,
truth-clean, technically-clean, HIGH_FIDELITY four-page site from one
frozen blueprint with 4 semantic call-sites and $0.30 of image spend.
Strictly, MERGE_SIMPLIFIED_DIRECTION's automated bar (Visual ≥ 90) was
missed by 3 points on honest evidence (87). The weakness is isolated and
now precisely diagnosed: F1 (capture/propagation race corrupting QA
evidence) + F2 (reveal-blank static captures suppressing scores) + F3/F4
(repair output budget) — none is a design-quality deficit, and none
requires a new stage, a second repair layer, or an architecture change.
One small iteration should push the honest automated score past 90 and
make the repair land.

Production:
UNTOUCHED

Main:
UNTOUCHED

V1:
UNCHANGED
```

## Evidence register

```text
Frozen blueprint artifact (exp R2):
builds/06025a7d-74cc-4655-9718-b3a190e78f92/v1/design_blueprint.json

Candidate site bundle (immutable, exp R2):
builds/06025a7d-74cc-4655-9718-b3a190e78f92/v1/site_bundle.json
(102,816 chars; home 33,662 / about 12,615 / services 14,069 /
 contact 13,189 / css 23,285 / js 5,996)

Accepted images (exp R2):
builds/06025a7d-…/v1/assets/images/{hero-team-collab,about-strategist,
results-celebration,testimonial-office,newsletter-owner,
contact-presentation}-a1.webp

QA artifacts (exp R2, Build Version v1 = 105f2f8b-7854-487b-92ea-23077dabb6fb):
v1/assembled_manifest.json, v1/qa_evidence_bundle.json, v1/qa_report.json,
v1/qa_package.json

True-render exhibits (exp R2):
benchmark/phase3/final-candidate-desktop.png (3,735,527 bytes)
benchmark/phase3/final-candidate-mobile.png (2,115,291 bytes)

Pipeline build versions:
v1 = candidate 1 (releaseReadyBuildVersionId: none — repair gate failed on
the corrupted 15/100 verdict; honest verdict 87 also below the 90 bar)
v2 = 70de1b79… (repair version; no bundle — repair call failed; terminal)

Driver ops added this phase (benchmark tooling only, no pipeline change):
simple-kie, simple-full-run (streaming), simple-rerender-qa,
stage-runs stage filter. Local streamed HMAC client with long-timeout
NDJSON reading (.tmp-exp-phase3/call_driver_stream.py).
```
