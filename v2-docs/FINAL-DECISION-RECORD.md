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
