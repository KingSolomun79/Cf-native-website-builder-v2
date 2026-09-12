# WAZIBIZ Website Builder V2 — Final Decision Record

**Status:** FINAL / APPROVED  
**Version:** 2.0.0  
**Date:** 2026-08-31  
**Repository:** `KingSolomun79/Cf-native-website-builder-v2`

`../CONTEXT.md` is authoritative for domain semantics. `IMPLEMENTATION-PRD.md` is authoritative for implementation. This record captures the locked product/architecture decisions and rationale.

---

## 1. Domain identity and intake

1. V2 has no Client Account, Client User, Customer Account or persistent mutable Client Profile domain.
2. Business is the stable real-world entity represented by one stable Site identity.
3. Every new Site Generation starts from exactly one fresh immutable Onboarding Submission.
4. A Site may have multiple Site Generations over time without becoming multiple Sites.
5. Replacing the Reference or changing Build Mode starts a new Site Generation, not a Revision Request.
6. Normal human changes that preserve Reference + Build Mode use a Revision Request and start a new Build.
7. Business Fact changes in a Revision Request are explicit Fact Updates; historical Onboarding Submissions and earlier Builds remain immutable.
8. Unsupported factual data must never be invented. Derived Content may create safe marketing language only when it does not introduce unsupported Business Facts.

## 2. Build/version boundary

9. Build = one end-to-end attempt under one fixed set of approved Business/content/design inputs.
10. Human new intent starts a new Build.
11. Build Version = immutable candidate state inside one Build created by bounded automated generation/repair.
12. Material Automated Repair creates a new Build Version.
13. Automated Repair may correct realization but cannot change Business Facts, Reference, Build Mode, Visual Blueprint or human intent.
14. Lightweight Build Records remain after disposable failed/superseded artifacts/Deployments are removed.
15. Build Records retain outcome, QA, root cause, cost and prompt/model/schema provenance.

## 3. Product sequencing

16. Prove `REFERENCE_BOUND` first.
17. Implement `ORIGINAL_DESIGN` only after at least 3/5 fixed Benchmark Sites achieve Benchmark Pass.
18. Benchmark Pass means Release Ready automatically, zero manual source edits and within the KIE hard budget; Approval/Publication are not required.
19. Do not replace failed Benchmark Sites because they are inconvenient.
20. Design Archetypes are inspiration vocabulary only and may never automatically select a design.

## 4. Reference fidelity and evidence

21. `REFERENCE_BOUND` means structural visual reproduction, not merely mood/style resemblance.
22. Hard visual gates exist in addition to QA score >=90.
23. Reference Screenshot is authoritative for static composition.
24. Reference URL supplements behavior, responsive transformations and computed/runtime evidence.
25. If screenshot/static composition conflicts with current live state, frozen screenshot wins for the visible static property and discrepancy is recorded.
26. Browser measurement of geometry/computed styles/behavior is allowed; wholesale source implementation copying is not.
27. Reference is design evidence only, never Business truth/content/branding/assets.
28. Reference Suitability is deterministic-first with `SUPPORTED`, `SUPPORTED_WITH_LIMITATIONS`, `UNSUPPORTED`.
29. `SUPPORTED_WITH_LIMITATIONS` requires a concrete Adaptation Contract fixed before generation.
30. Reference Evidence records observable/measurable facts without interpretation.
31. Reference Analysis interprets Evidence and identifies hierarchy/signature traits/design intent without overwriting Evidence.

## 5. Blueprint and implementation

32. Reference Analysis and Visual Blueprint are separate stages.
33. Visual Blueprint is the binding design contract.
34. `REFERENCE_BOUND` Blueprint preserves identity-defining structure/signature traits while replacing Business content/branding/imagery.
35. `ORIGINAL_DESIGN` Blueprint derives from Business, audience, brand, offer, conversion and creative direction rather than industry archetype.
36. Implementation Contract is a separate binding realization plan beneath the Blueprint.
37. Implementation Contract can choose semantic structure, components, tokens, responsive realization, image-slot mapping and file organization but cannot alter Blueprint topology, signature traits, first viewport, image roles or visual thesis.
38. If the Blueprint itself is wrong/contradictory/impossible, emit `BLUEPRINT_REVIEW_REQUIRED` and escalate to `HUMAN_REVIEW_REQUIRED`; never silently redesign through QA repair.

## 6. Generation architecture

39. Generated Sites are framework-light/static: semantic HTML, CSS and minimal JavaScript by default.
40. Initial V2 has exactly Home, About, Services, Contact.
41. Website generation is incremental under one shared Visual Blueprint + Implementation Contract: shared tokens/CSS, shared header/footer/runtime, Home, About, Services, Contact, Image Plan, assembly validation.
42. Do not use independent page designers that drift from one another.
43. Standardize technical interfaces, not page composition.
44. Prefer one shared `site.css` and one shared `site.js`; page-specific exceptions require contract justification.
45. React/Tailwind/GSAP or comparable large frameworks are not defaults.
46. CMS/blog is out of initial V2 scope.

## 7. Images and KIE

47. Normal target is 12 Accepted Images per completed four-page Site, not 12 attempts.
48. Image Slot is stable semantic/compositional intent; Image Attempt is one generated candidate; Accepted Image is the selected attempt for an exact Build Version.
49. Two generation waves: CRITICAL/HIGH homepage first, then NORMAL/supporting.
50. Hard KIE image-generation budget is USD 3.00 per completed Site.
51. Preserve ~20–25% repair reserve where practical.
52. CSS crop/object-position, routing and remap precede regeneration where viable.
53. Generate mobile-specific variants only when a master asset cannot satisfy the required composition.
54. No temporary provider URL may ship; Accepted Images persist to project-controlled storage.

## 8. Validation and prompts

55. Every AI boundary has a versioned runtime schema.
56. Malformed AI output gets at most one targeted schema-repair attempt before stage failure.
57. No malformed model output propagates downstream.
58. Different stages may use different configured models.
59. Persist prompt id/version, domain-contract version, model, schema version, attempt and input artifact identity.
60. Runtime prompt authority is `prompts/PROMPT-MANIFEST.md`.
61. Every runtime prompt is composed from `prompts/00-domain-contract-v1.md` + the retained full detailed stage-prompt body.
62. The domain contract supersedes contradictory clauses in older detailed prompt bodies while retaining their useful detail.

## 9. QA and bounded mutation

63. Technical Preflight runs before expensive QA.
64. QA-A owns rendered visual/content judgment and hard visual gates.
65. QA-B owns browser/source/DOM/network/accessibility/SEO/form-contract verification.
66. Visual Geometry Comparator supplies structural evidence; raw pixel similarity is not the release verdict.
67. Release Blocker means P0/P1. P2/P3 optional polish is not a blocker if mandatory gates pass.
68. One main Fix Coordinator Automated Repair batch is allowed.
69. At most one narrow Release Blocker Fix batch follows failed confirmation.
70. A repaired candidate is a new Build Version and must be re-evaluated.
71. If blockers remain after bounded automation, emit `HUMAN_REVIEW_REQUIRED`.
72. No unbounded retry/mutation loop.
73. Degraded means useful partial/Preview exists but cannot become Release Ready; Failed means no genuinely useful candidate remains.

## 10. Release, Publication and Rollback

74. Release Ready is an automated quality state for one exact Build Version.
75. Approval is explicit human acceptance/authorization for that exact Release Ready Build Version.
76. Approval and Publication are separate.
77. Publication is the explicit operational act that makes the exact approved Build Version live.
78. Publication never regenerates the approved Build Version.
79. Operational Publication failure may be retried under the same Approval while the Build Version is unchanged.
80. Any changed Build Version requires Release Ready + fresh Approval.
81. Site has at most one current Published Version.
82. Retain the immediately previous Published Version temporarily as Rollback Version.
83. Rollback restores that exact version without regeneration, new Build, new Build Version or new Approval.
84. Publication history remains truthful after Rollback.
85. Older superseded published Deployments may be removed after they no longer hold rollback responsibility.

## 11. Site Configuration

86. Site Configuration is mutable operational state only and is separate from immutable Build artifacts.
87. Initial Site Configuration includes Form Destination and Sender Identity.
88. Changing Form Destination/Sender Identity does not create a Build, Revision Request, Approval or Publication.
89. Site Configuration is not implicitly reverted by website Rollback.
90. Any setting that changes generated content/design/page behavior is not Site Configuration and must use the Build lifecycle.

## 12. Contact form and email

91. The old presentation-only/no-submit form rule is superseded.
92. Every generated Contact form uses one central multi-tenant WAZIBIZ Form Service.
93. Browser payload may include only public Site/form identity, visitor fields, Turnstile token and client-safe metadata.
94. Browser never controls recipient, From sender, sender domain, template, credentials or internal routing.
95. Turnstile, server schema/length validation, allowed-origin checks and rate limiting are required.
96. A Form Submission becomes Accepted Submission only after the platform validates and durably accepts responsibility for processing it.
97. Browser success is tied to Accepted Submission, not client-side validation or merely sending a request.
98. Email Delivery is downstream of acceptance.
99. Transient Email Delivery failure gets bounded server-side retry and does not require visitor resubmission.
100. Permanent delivery failure is recorded operationally without erasing the Accepted Submission.
101. V2 defaults to a verified WAZIBIZ platform Sender Identity.
102. Business-owned sender domain may be supported later only after verification and remains Site Configuration.
103. Visitor email is validated Reply-To, never arbitrary transactional From.
104. Visitor autoresponder is off by default.
105. Message retention remains minimal/configurable; V2 is not a CRM.

## 13. Capability and compliance

106. Ordinary CSS/JS transitions, hover, reveal, sticky, simple parallax, modest scroll-linked effects and justified lightweight sliders/carousels are supported.
107. WebGL/canvas-primary, physics-heavy, specialized scroll choreography, app-grade authenticated UI and rich configurators are normally unsupported.
108. Fonts are first-class dependencies; use legal/public/supplied fonts or declared substitutes, never proprietary copied font files.
109. Accessibility may override clear Reference defects while preserving design character and recording adaptation.
110. Business brand requirements override copying Reference brand identity; preserve relevant visual roles/distribution instead.
111. SEO scope is deterministic foundation only: titles/descriptions, canonical, semantic headings, crawlable links, truthful JSON-LD, OG and alt semantics.
112. Reference Analysis binds exactly 3–8 signature traits, schema-enforced (`reference-analysis/2`, issue #59). An output exceeding the bound is rejected by the Analyzer boundary and must return a compliant ranked set through the targeted schema repair; silent truncation is forbidden.
113. The REFERENCE_BOUND Visual Blueprint carries an explicit trait obligation ledger (`visual-blueprint/2`, issue #59): every identity-defining Analysis trait has exactly one disposition — PRESERVED (realized by existing canonical regions) or ADAPTED under an existing immutable Adaptation Contract clause. Per #110, Business-brand substitution of a trait is legal only through that authority. Absence is deterministic erasure (`BLUEPRINT_REVIEW_REQUIRED`). The 3–8 signature traits remain the Blueprint's concise vocabulary; identity no longer depends on trait-slot capacity or on repeating trait names.

## 14. Repository cleanup

112. V1 remains separately preserved.
113. Reuse proven infrastructure after brownfield audit, not obsolete product architecture.
114. V2 release requires deleting superseded V1 generator paths, routing flags, prompt registry entries, dead schemas/types/tests/routes and obsolete conflicting docs.
115. No production route may invoke V1 after V2 acceptance.

## 15. Source-of-truth order

1. `../CONTEXT.md` — canonical domain vocabulary/semantics.
2. `IMPLEMENTATION-PRD.md` — normative implementation requirements.
3. `CAPABILITY-ENVELOPE.md` + `capability-envelope.json` — capability boundaries.
4. `FINAL-DECISION-RECORD.md` — locked decisions/rationale.
5. `prompts/PROMPT-MANIFEST.md`.
6. `prompts/00-domain-contract-v1.md` + retained full detailed stage prompt.
7. Older root/V1 docs only for explicitly retained historical/infrastructure context.

## 16. SIMPLE canonical and legacy design-pipeline removal (2026-09-10)

116. The SIMPLE design pipeline is the canonical — and only — V2 design path: Reference Capture -> Design Blueprint -> Nano Banana images -> Website Builder -> Technical + Truth + Visual QA -> optional ONE Repair -> Release Ready -> Approval -> Publication. The runtime selector (`legacy_v2` vs `simple_blueprint_v1`) was removed; `DESIGN_PIPELINE_VERSION` survives only as a provenance string.
117. The obsolete COMPLEX design chain was deleted: Reference Analysis, Visual Blueprint (region/trait/obligation system), Implementation Contract, site generator realization, assembly/realization repair, Craft Preflight, Fix Coordinator/Release Blocker Fix, the 3-of-5 legacy benchmark proof gate, and their prompts, tests and fixtures. Applied migrations are untouched (history-only tables may remain unused).
118. ORIGINAL_DESIGN remains a recognized V2 Build Mode whose runtime is explicitly NOT ENABLED: a deterministic lock (`ORIGINAL_DESIGN_NOT_ENABLED`) replaces the retired proof gate. No fallback to REFERENCE_BOUND, no legacy generator, no automatic enablement. The creative-direction input contract is preserved (`src/domain/creative-direction.ts`); its SIMPLE implementation (Business Facts + creative direction -> the SAME Design Blueprint -> images -> builder -> QA -> repair path) is deferred and will not recreate a second design pipeline.
119. The experimental benchmark driver route (`EXP_BENCHMARK_DRIVER`, sandbox-only) is retained temporarily as verification tooling for cleanup/staging/first-production verification; it is removed later in its own small commit after the production rollout succeeds.
120. Production deployment from the then-current production config is FORBIDDEN until `KIE_MODEL` is updated from `z-image` to the canonical `nano-banana-2-lite` in a dedicated production-rollout GO.
121. Known follow-up (out of cleanup scope): Workers AI long-stream `8005` reliability and the Z.AI General transport's missing thinking-parameter contract — see `v2-docs/FOLLOW-UP-TRANSPORT-RESILIENCE.md`.

## 17. ORIGINAL_DESIGN enablement and operator acceptance (2026-09-12)

122. ORIGINAL_DESIGN Site Generation is implemented on the SAME SIMPLE pipeline (issue #24, commits `51646cb`/`caa1376`/`212bb30`): the divergence from REFERENCE_BOUND is exactly two prompts plus their inputs — `simple-original-design-blueprint/v1` (text-only: Business Facts + Creative Direction) and `simple-original-design-visual-qa/v1` (candidate renders judged against Blueprint + Creative Direction) — both emitting the UNCHANGED `design-blueprint/2` and Visual-QA schemas, so release/approval/publication machinery is shared byte-for-byte. The `ORIGINAL_DESIGN_NOT_ENABLED` lock (§118) is removed. Creative Direction rides the immutable Onboarding Submission (required for ORIGINAL_DESIGN, Reference input rejected, checksum-frozen, provenance-recorded). REFERENCE stages are SKIPPED, not faked (`referenceEvidence=NOT_APPLICABLE` provenance event; zero reference artifacts). No fallback between Build Modes in either direction.
123. Qualification evidence (sandbox, 2026-09-12): A Cedar & Stone Landscapes 87 first-pass -> ONE repair -> 93 RELEASE_READY; B Casa Luz de Sal 89 first-pass -> ONE repair -> 87 HUMAN_REVIEW_REQUIRED (stable 85–87 across five fair evaluations); C Meridian Flow Systems 88 first-pass -> ONE repair -> 90 RELEASE_READY. All three: Blueprint PASS, Technical PASS, Truth PASS, fabrication false, Distinctive YES (human visual review of release candidates), manual edits 0. REFERENCE_BOUND frozen-fixture regression: first-pass RELEASE_READY 93/95/95 on `v5`/`v8`/`v2` prompts, zero ORIGINAL_DESIGN leakage.
124. OPERATOR ACCEPTANCE OVERRIDE — an acceptance-policy decision, NOT a threshold change: the experimental qualification bar (3/3 Release Ready AND >=2/3 first-pass >=90) is superseded; qualification is ACCEPTED despite 2/3 automated Release Ready because all three candidates were distinctive and high-quality, all three Truth PASS and Technical PASS with zero fabrication, the fail-closed HUMAN_REVIEW_REQUIRED path behaved exactly as designed for B (a valid candidate requiring human design judgement — never a system failure), the REFERENCE_BOUND regression remained strong, and tuning the shared Builder to push B from 87 to 90 would risk overfitting one asymmetric-editorial candidate and regressing the production-proven shared path. Runtime release thresholds are UNCHANGED (Visual overall >=90, critical categories >=85, Technical PASS, Truth PASS); B remains HUMAN_REVIEW_REQUIRED; no ORIGINAL_DESIGN-specific lower threshold exists.
125. Builder/repair policy frozen at the accepted versions: the shared Builder stays `simple-website-builder/v8` (no v9 in this tranche) and the ONE durable Repair maximum is unchanged — B's 89->87 repair regression is an operational observation, not authorization for repair retry, repair chooser, best-of-N or iterative visual optimization. `HUMAN_REVIEW_REQUIRED` is a first-class safe terminal and is never auto-published; Approval and Publication remain separate human actions.
126. Quality watch (no new subsystem): record through existing telemetry — ORIGINAL_DESIGN generations, first-pass visual score, repair used YES/NO, final visual score, Release Ready vs Human Review. Review the distribution after ~10–20 real generations; consider a Builder/Blueprint quality iteration only on aggregate evidence (majority of runs requiring Repair, repeated asymmetric-layout realization failures, median final visual score <90, repeated Human Review for the same defect class, or loss of distinctiveness/template convergence), improving the smallest shared seam — not before.

## 18. Post-acceptance operating state and evidence-first quality phase (2026-09-12)

127. V2 implementation/design-pipeline work is CLOSED (operator acceptance, 2026-09-12, after prompt-generation idempotence landed as `168f091`): production healthy; REFERENCE_BOUND production-proven; ORIGINAL_DESIGN enabled and fail-closed below the 90 visual threshold (`HUMAN_REVIEW_REQUIRED` is a valid terminal, never a system failure); Builder frozen at `simple-website-builder/v8`; Visual QA frozen; ONE durable Repair only; LLM provider is the Z.AI Coding Plan only; images are Nano Banana 2 Lite via KIE only; architecture changes FROZEN. Prompt-generation determinism (LF canonical, `eol=lf` attributes, idempotence gate in `npm test`) is part of this closed state.
128. Next phase is evidence collection from REAL usage only: do NOT generate synthetic benchmark sites to reach a count. For every genuine ORIGINAL_DESIGN generation, retain through existing telemetry (builds/versions state, `ai_stage_runs`, QA report/evidence artifacts in R2, provenance events): BuildMode -> first-pass visual score -> category scores -> repair used/not used -> post-repair score -> terminal state -> Visual QA findings -> Technical/Truth outcome. When roughly 10–20 genuine generations exist, analyze them together: first-pass Release Ready rate; post-single-Repair rate; Human Review rate; whether Repair usually improves/flat/regresses the score; which visual categories repeatedly score below 90; which Visual-QA findings recur across unrelated businesses; whether asymmetric/editorial designs are disproportionately difficult; whether template convergence appears. ONLY a repeated systemic problem in that dataset unlocks a Blueprint prompt revision, Builder v9, Repair improvement or QA calibration proposal. No further pipeline optimization before then.
129. Low-priority hygiene, recorded and parked — do NOT execute unless it produces real drift: the vitest-config-generated `tests/_generated-wrangler-config.ts` and `tests/_generated-simple-finch*.ts` modules embed raw/escaped JSON from platform-smudged sources and could in principle vary across OS checkouts (LF vs CRLF). No drift has been observed on this platform. The cleanup cycle is closed; this item is not authorization to reopen it.
