# WAZIBIZ Website Builder V2 — Final Decision Record

**Status:** FINAL / APPROVED  
**Date:** 2026-08-31  
**Repository:** `KingSolomun79/Cf-native-website-builder-v2`  
**Authority:** This record captures the product and architecture decisions made during the Matt Pocock-style grilling session. `IMPLEMENTATION-PRD.md` is the normative implementation specification. If an older prompt, README, V1 file, or implementation detail conflicts with the final PRD, the PRD wins.

---

## 1. Product sequencing and proof standard

1. Build and prove `REFERENCE_BOUND` first. Implement `ORIGINAL_DESIGN` only after the reference pipeline reaches the agreed proof threshold.
2. Remove design archetypes as a decision-making authority. Industry-to-style mappings may remain only as non-binding inspiration vocabulary and must never select a design automatically.
3. Generated customer sites remain framework-light/static for V2: semantic HTML, CSS and minimal JavaScript by default.
4. Normal image target: **12 accepted images per completed four-page site**, not 12 attempts.
5. Hard KIE.ai generation spend ceiling: **USD 3.00 per completed site**.
6. REFERENCE_BOUND proof milestone: fixed benchmark of **5 sites**, with **at least 3/5 automated passes**. This unlocks Original Design work; it does not mean reference fidelity work is finished.
7. A benchmark pass must require zero manual source-code edits. Humans may choose references, provide business data, inspect results and classify failures.

---

## 2. Reference fidelity and authority

8. QA visual release requires **visual score >= 90 plus hard composition gates**. A high aggregate score cannot compensate for a materially wrong first viewport, topology, major image/text mass, signature trait or mobile identity.
9. REFERENCE_BOUND means **structural visual reproduction**, not merely style resemblance. Preserve the reference visual architecture: region order, proportions, major image placement, grid, whitespace, surface sequence, component geometry and responsive transformation, while replacing content, branding and imagery.
10. The supplied full-page screenshot is authoritative for static homepage composition.
11. The live reference URL supplements the screenshot for computed typography, interactions, hover, motion, sticky behavior and responsive transformations. If a property is visibly represented in the screenshot and conflicts with the current live site, the screenshot wins and the discrepancy is recorded.
12. Browser inspection may measure DOM geometry, computed CSS, fonts, colors, transitions and breakpoints. It must not copy source HTML, CSS, JavaScript bundles or proprietary implementation wholesale.
13. Add a `Reference Suitability Gate` before analysis with outcomes `SUPPORTED`, `SUPPORTED_WITH_LIMITATIONS`, or `UNSUPPORTED`.
14. Suitability is deterministic-first. Browser/runtime checks should detect WebGL/canvas dependence, application-like behavior, excessive video dependence, scroll-jacking and other unsupported patterns; AI interprets only ambiguity.
15. `SUPPORTED_WITH_LIMITATIONS` references may pass only when limitations and required approximations are declared before generation. QA judges against that adaptation contract.

---

## 3. Evidence, analysis and blueprint separation

16. Keep Reference Analyzer and Visual Blueprint Generator as separate stages.
17. Create a versioned deterministic `ReferenceEvidence` contract. Machine-extract what can be measured before asking AI to interpret it.
18. Evidence should include viewport geometry, bounding boxes, region boundaries, computed typography, colors, radii, container widths, responsive state changes, transitions, animation properties, sticky/fixed states, image geometry and evidence provenance/confidence.
19. Reference Analyzer observes and describes. It does not redesign.
20. Visual Blueprint Generator converts analysis into the binding visual implementation contract.
21. The Implementation Planner treats the Blueprint as binding. It may map the Blueprint into technical implementation decisions but may not silently simplify or change the visual thesis, section topology, signature traits, first viewport or image roles.
22. If the Blueprint is genuinely contradictory or impossible within the capability envelope, return an explicit blocker rather than silently weakening it.

---

## 4. Generation architecture

23. Use hierarchical generation:
   - Visual Blueprint
   - Implementation Planner
   - Website Generator
24. Website generation is incremental by file/output while every generation step consumes the same Blueprint and Implementation Contract.
25. Default generation sequence:
   - shared design tokens/CSS
   - shared header/footer/runtime JS
   - Home
   - About
   - Services
   - Contact
   - IMAGE_PLAN
   - deterministic assembly and validation
26. Do not use four independent page designers/agents. Cross-page consistency must come from one shared contract.
27. Standardize technical interfaces, not visual composition.
28. Enforce semantic platform contracts such as header/nav/main/footer, one H1/page, metadata hooks, form contract, image-slot markers and a small token layer while allowing custom reference-specific grids, overlaps, wrappers and CSS.
29. Use a small site-specific token/component layer. Do not turn this into a universal WAZIBIZ visual template.
30. Prefer one shared `site.css` and one shared `site.js`; allow page-specific exceptions only when the reference genuinely requires them.
31. V2 MVP is fixed to four generated pages: Home, About, Services and Contact. Schemas may anticipate future pages but arbitrary page count is out of scope.
32. CMS/blog functionality is out of scope for initial V2.
33. Generated sites should not depend on React, Tailwind, GSAP or other large frameworks/libraries by default. Native CSS/JS and approved lightweight dependencies are preferred.

---

## 5. Images and KIE.ai budget

34. Treat 12 accepted images as the normal four-page baseline.
35. Generate in two waves with concurrency inside each wave:
   - Wave 1: CRITICAL and HIGH homepage imagery
   - Wave 2: remaining NORMAL/supporting imagery
36. Preserve approximately 20–25% of the KIE budget as repair reserve rather than spending the entire USD 3.00 on initial generation.
37. Regeneration is priority-aware. CRITICAL images may receive bounded automatic retry when generation itself fails. HIGH images regenerate only when CSS/remapping cannot solve the defect. NORMAL supporting images normally do not automatically regenerate.
38. CSS crop/object-position, asset routing and content remapping are considered before regeneration.
39. Dedicated mobile image variants are generated only when one master asset cannot satisfy the required desktop/mobile composition.
40. The orchestrator must know/estimate per-generation provider cost and prevent `expected spend + repair reserve` from exceeding USD 3.00.

---

## 6. Validation and immutable artifacts

41. Persist immutable inputs/outputs for every major pipeline stage and build version.
42. At minimum preserve normalized intake, suitability, reference evidence, reference analysis, Blueprint, Implementation Contract, Image Plan, image prompt records, image manifest, QA reports, repair reports and final build artifacts.
43. Runtime-validate every AI boundary with versioned schemas. Invalid output receives at most one targeted schema-repair attempt before stage failure.
44. Generated source is stored as canonical immutable build artifacts rather than reconstructed from many mutable D1 fragments.
45. D1 stores workflow state, metadata, indexes and operational configuration. R2/project-controlled artifact storage stores immutable build/source/evidence assets.
46. Publishing must address an exact immutable `build_id`, `build_version` and artifact/manifest identity. Never publish a mutable concept of “latest”.

---

## 7. QA, comparison and bounded repair

47. QA-A is visual/content QA and primarily receives rendered evidence, Blueprint, business facts and image contracts. It should not rely on source code.
48. QA-B owns browser/runtime/source/DOM/network/accessibility/SEO/image-pipeline verification.
49. Add a deterministic Technical Preflight before expensive QA. Reject obvious failures such as malformed/missing pages, unresolved image placeholders, broken critical links/assets, invalid metadata/JSON-LD, fatal JS, form-contract failure and prohibited temporary provider URLs.
50. Standardize the visual evidence bundle for every release candidate.
51. Add a lightweight Visual Geometry Comparator. Compare structural geometry and composition indicators, not raw pixel similarity.
52. Geometry evidence should cover first-viewport ratio, region order/count, container ratios, image mass position, column ratios, surface sequence and major whitespace.
53. Fix Coordinator cannot mutate the Blueprint. If the Blueprint is the root defect, return `BLUEPRINT_REVIEW_REQUIRED`.
54. Keep the bounded mutation budget:
   - initial generation
   - one Fix Coordinator batch
   - at most one Release Blocker Fix batch
   - then human review if confirmation still fails
55. No agent may create an unbounded “try again until it passes” loop.

---

## 8. Benchmarking and observability

56. Freeze a fixed five-site benchmark before optimizing against results.
57. Benchmark set should deliberately include: asymmetric/editorial, image-heavy hospitality/travel, restrained corporate/professional, bold trades/local service, and one difficult but supported responsive/motion reference.
58. Do not replace failed benchmark references because they are inconvenient.
59. Freeze canonical screenshots/evidence so external website changes do not alter the benchmark target.
60. Use standardized replacement-business briefs rather than the reference company’s own content. The test is whether the visual architecture adapts to a different business.
61. Benchmark models/settings/prompts/schemas should be fixed where provider capabilities allow reproducibility.
62. Add a benchmark runner that records suitability, QA-A, QA-B, KIE spend, final result and root-cause classification.
63. Every failed benchmark receives a primary root-cause taxonomy such as `REFERENCE_UNSUITABLE`, `EVIDENCE_EXTRACTION`, `REFERENCE_ANALYSIS`, `BLUEPRINT`, `IMPLEMENTATION_PLAN`, `GENERATOR`, `IMAGE_PLAN`, `IMAGE_GENERATION`, `ASSEMBLY`, `QA_FALSE_POSITIVE`, `FIX_COORDINATOR`, `PLATFORM_RUNTIME`.
64. Log every stage around `buildId`/`buildVersion` with attempt, duration, provider/model, cost where known, result and error class.
65. Track total model/browser cost from day one, but only KIE’s USD 3.00 ceiling is initially a hard benchmark cost gate.

---

## 9. Retry, model and prompt governance

66. Every stage has a strict retry budget.
67. Deterministic transient operations may use normal bounded infrastructure retry.
68. Malformed AI output gets one targeted schema-repair attempt.
69. Semantic AI failure does not trigger blind reruns; retry only with explicit corrective feedback defined by the workflow.
70. Different stages may use different models. Model routing is configuration-driven, not hardcoded through product logic.
71. Stronger reasoning/vision is appropriate for Reference Analyzer, Blueprint generation, QA-A and difficult repair reasoning; cheaper structured models may handle classification, schema repair and simple structured tasks.
72. Prompts are versioned independently from code. Persist `prompt_id`, `prompt_version`, `model`, and `schema_version` with AI artifacts.

---

## 10. Capability envelope

73. Static/framework-light output is the V2 product boundary.
74. Supported motion includes ordinary CSS/JS transitions, hover, reveals, sticky effects, simple parallax, justified carousels/sliders and modest scroll-linked behavior.
75. Heavy WebGL/canvas experiences, physics-heavy interactions, complex scroll choreography and application-grade state machines are outside the normal V2 envelope.
76. Fonts are first-class dependencies. Use legal/public/supplied fonts where available; otherwise declare an approved substitute. Never copy proprietary font files from the reference.
77. Accessibility may override exact reference defects. Preserve visual character while correcting unusable contrast, missing focus, undersized controls or hover-only critical interaction; record the adaptation.
78. Client brand colors override reference brand colors. Preserve color roles, contrast hierarchy, surface rhythm and accent frequency rather than copying the reference brand palette.
79. Reference logos, trademarks, proprietary graphics and photography are never reused. Their layout footprint/visual role may be measured.
80. SEO remains deterministic and foundational: unique title/description, canonical when known, semantic headings, crawlable links, truthful JSON-LD, suitable OG metadata and correct image alt semantics. Full SEO strategy/content optimization is separate.

---

## 11. Contact forms and Cloudflare-native email

81. The old presentation-only form decision is superseded.
82. V2 uses a **central multi-tenant WAZIBIZ Form Service** rather than custom email logic generated into each static site.
83. Generated static sites submit to the platform form endpoint.
84. The browser may submit only a public site/form identifier and field payload. It must never choose `to`, `from`, sender domain or mail template.
85. Server-side configuration resolves `site_id -> approved destination/sender/configuration`.
86. Use Cloudflare-native outbound email capability through the platform Worker/email binding.
87. Use Cloudflare Turnstile plus server-side schema validation and rate limiting.
88. Do not expose email credentials, internal tokens or arbitrary recipient control to generated sites.
89. Persist minimal submission/delivery metadata for audit and bounded retry; do not accidentally turn V2 into a CRM. Full message retention should be minimal/configurable.
90. Do not report a successful form submission before the form service has accepted it for delivery.
91. Use an authenticated platform/client-domain sender identity. The visitor email is `Reply-To`, not arbitrary `From`.
92. Website success-state UI is required. Visitor autoresponder is off by default for V2.
93. Form data must not be logged to browser console or sent to unrelated third parties.
94. Maintain mutable `SiteFormConfig` separately from immutable website build artifacts so destination email can change without rebuilding the site.

---

## 12. Workflow, mutation boundaries and state

95. Use one canonical build state machine.
96. One primary Cloudflare `WebsiteBuildWorkflow` owns lifecycle orchestration; helper services perform bounded operations. Avoid unnecessary nested workflow sprawl.
97. AI agents return structured results/plans and do not directly mutate D1/R2 arbitrarily.
98. Application services perform validated/idempotent writes.
99. Builds never silently degrade. Explicit statuses include at least `COMPLETED`, `FAILED`, `DEGRADED`, `HUMAN_REVIEW_REQUIRED`, and the finer stage state machine defined in the PRD.
100. Human approval remains mandatory before publish even when QA passes.

---

## 13. Repository and V1 cleanup

101. This repo is the dedicated V2 fork. V1 remains preserved in its own repository.
102. Reuse proven V1 infrastructure after audit, not obsolete product architecture.
103. V2 is not release-complete until superseded V1 generation paths, feature flags, prompt registry entries, dead schemas/types, obsolete tests and compatibility scaffolding are removed.
104. No production route may still invoke V1 generation logic after V2 acceptance.
105. Repository cleanup is a formal V2 acceptance gate, not deferred technical debt.

---

## 14. Source-of-truth rule

Implementation authority is:

1. `v2-docs/IMPLEMENTATION-PRD.md` — normative implementation specification.
2. `v2-docs/CAPABILITY-ENVELOPE.md` / `capability-envelope.json` — product support boundaries.
3. `v2-docs/FINAL-DECISION-RECORD.md` — rationale and locked decisions.
4. `v2-docs/prompts/*` — executable stage instructions; they must be reconciled to the PRD before runtime use.
5. Older root docs/V1 logic — non-authoritative historical context only where explicitly retained.

If any prompt currently says the Contact form must not have a backend, that clause is obsolete and must be updated before the prompt is used in V2 runtime.
