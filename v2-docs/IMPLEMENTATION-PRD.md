# WAZIBIZ CF-Native Website Builder V2
## Final Implementation PRD, Architecture and Coding-Agent Specification

**Status:** FINAL / AUTHORITATIVE  
**Date:** 2026-08-31  
**Repository:** `KingSolomun79/Cf-native-website-builder-v2`  
**Runtime:** Cloudflare-native  
**Generated output:** static/framework-light HTML + CSS + minimal JS  
**Image generation:** KIE.ai  
**Browser/reference/QA:** Cloudflare browser infrastructure / Browser Run  
**Contact delivery:** centralized WAZIBIZ Form Service using Cloudflare-native outbound email  

> This document is the normative implementation specification for Website Builder V2. If an older prompt, V1 file, root document or previous PRD conflicts with this file, this file wins.

---

# 1. Product Goal

Build a Cloudflare-native website-generation system that creates four-page local-business websites with substantially higher design fidelity, stronger imagery, deterministic QA and bounded autonomous repair.

V2 has two product modes:

1. `REFERENCE_BOUND` — reproduce the visual architecture of a supplied reference while replacing content, branding, imagery and business facts.
2. `ORIGINAL_DESIGN` — create a distinctive visual system from business/audience/brand context without a reference.

Implementation order is deliberate:

```text
REFERENCE_BOUND
  -> prove on fixed benchmark
  -> then implement ORIGINAL_DESIGN
```

`ORIGINAL_DESIGN` remains part of V2, but reference fidelity is the first proof target.

---

# 2. Repository Strategy

This repository is a dedicated V2 fork of the original builder.

The original V1 repository remains preserved separately.

During construction, V1 code may temporarily remain when it is useful as infrastructure or comparison material. At V2 acceptance, all superseded V1 product logic must be removed.

Core rule:

> Reuse proven infrastructure, not obsolete product architecture.

Reuse candidates after audit:

- Worker bootstrap;
- Wrangler/environment/bindings;
- Cloudflare Workflows foundation;
- D1/R2 utilities;
- KIE.ai client/auth/task/callback code;
- browser/screenshot utilities;
- preview/deployment/domain plumbing;
- approval infrastructure;
- logging;
- provider/AI Gateway wrappers;
- reliable validation/tests.

Do not retain merely for compatibility:

- old generator intelligence;
- old design-analysis logic;
- old image prompting;
- old QA/self-review loops;
- hardcoded generic section architecture;
- permanent V1/V2 switches;
- dead schemas/types/routes/tests.

V1 cleanup is a formal release gate.

---

# 3. V2 Capability Envelope

The detailed capability boundary is also maintained in `CAPABILITY-ENVELOPE.md`.

V2 supports:

- exactly four pages in the initial product: Home, About, Services, Contact;
- static/framework-light output;
- semantic HTML;
- shared site-specific CSS and minimal JS;
- responsive layouts;
- ordinary CSS/JS motion, hover, reveal, sticky behavior, simple parallax, justified lightweight sliders/carousels;
- KIE-generated site imagery;
- central form delivery;
- deterministic SEO foundations;
- immutable versioned publishing.

Normally unsupported for V2:

- WebGL/Three.js/canvas as primary experience;
- physics-heavy interaction;
- complex scroll choreography requiring a specialized runtime;
- authenticated application UIs;
- rich product configurators;
- CMS/blog as a core dependency;
- arbitrary page counts;
- huge ecommerce/catalog architectures.

A reference may be `SUPPORTED_WITH_LIMITATIONS` only when limitations are declared before generation.

---

# 4. Final Product Constraints

## 4.1 Output architecture

Default generated site:

```text
index.html
about.html
services.html
contact.html
site.css
site.js
assets/
manifest.json
```

Prefer one shared `site.css` and one shared `site.js`.

Page-specific CSS/JS is allowed only for genuinely unique reference behavior.

Do not use React, Tailwind, GSAP or comparable large libraries by default.

## 4.2 Technical interfaces are standardized; design is not

Standardize:

- semantic header/nav/main/footer;
- one H1 per page;
- metadata insertion hooks;
- image-slot linkage;
- Contact form contract;
- accessibility fundamentals;
- small token layer;
- assembly/versioning contracts.

Do not standardize page composition into a universal WAZIBIZ template.

Reference-specific:

- grids;
- overlaps;
- clipping;
- image placement;
- section topology;
- asymmetry;
- spacing exceptions;
- component composition;

must remain possible.

---

# 5. Core Authority Order

Across the pipeline, resolve conflicts in this order:

1. verified client/business facts;
2. explicit client requirements;
3. accessibility/security/platform constraints;
4. client brand requirements;
5. Visual Blueprint;
6. supplied reference screenshot for static homepage composition in reference mode;
7. live reference evidence for interaction/responsive/computed details;
8. Image Plan;
9. Implementation Contract;
10. QA findings;
11. general best practice only when higher authorities leave room.

Reference content is never business truth.

---

# 6. Design-Archetype Decision

`design_archetypes.md` must not be used as a decision-making authority.

Industry must not deterministically choose a visual style.

Original Design must derive from:

```text
business facts
+ audience
+ offer/service model
+ physical/service environment
+ brand
+ conversion goal
+ explicit creative direction
+ design reasoning
```

The archetype file may remain only as optional inspiration vocabulary.

No runtime rule may implement:

```text
industry -> predefined design archetype
```

---

# 7. REFERENCE_BOUND Fidelity Definition

Reference mode reproduces **visual architecture**, not just mood.

Target fidelity includes:

- region order;
- first-viewport topology;
- section proportions;
- major text/image mass;
- grid and container relationships;
- whitespace rhythm;
- surface/light-dark sequence;
- typography character;
- component geometry;
- image roles and crop logic;
- responsive transformations;
- ordinary motion/interaction behavior.

The generated site must use:

- new client content;
- new client branding;
- new business-appropriate imagery;
- factual client data.

Never copy:

- reference logo;
- proprietary graphics;
- photography;
- trademarks;
- proprietary font files;
- HTML/CSS/JS source wholesale.

Measurement is allowed. Implementation copying is not.

---

# 8. Reference Evidence Authority

## 8.1 Screenshot

The supplied full-page screenshot is authoritative for static homepage composition:

- page silhouette;
- region order;
- proportions;
- image placement;
- whitespace;
- surfaces;
- static component appearance.

## 8.2 Live URL

The live URL supplements evidence for:

- computed fonts;
- exact CSS where measurable;
- hover/focus;
- transitions;
- animation;
- sticky/fixed behavior;
- responsive transformations;
- breakpoints;
- mobile navigation behavior.

If the screenshot and current live URL disagree on something visible in the screenshot, the screenshot wins and the discrepancy is persisted.

---

# 9. Reference Suitability Gate

Add a deterministic-first stage before Reference Analyzer.

Output:

```ts
type ReferenceSuitability =
  | "SUPPORTED"
  | "SUPPORTED_WITH_LIMITATIONS"
  | "UNSUPPORTED";
```

Check deterministically where possible:

- canvas/WebGL/Three.js dependence;
- application-like/authenticated behavior;
- dominant video dependence;
- extreme scroll-jacking;
- complex stateful interaction;
- unsupported page/product scale;
- rendering patterns outside capability envelope.

AI may classify ambiguity only after evidence exists.

For `SUPPORTED_WITH_LIMITATIONS`, persist an adaptation contract:

```ts
interface ReferenceAdaptationContract {
  unsupportedFeatures: string[];
  requiredApproximations: string[];
  qaExceptions: string[];
}
```

The limitation contract is frozen before generation and used by QA.

---

# 10. Versioned ReferenceEvidence Contract

Do not pass loose browser dumps directly to the Analyzer.

Create a runtime-validated `ReferenceEvidence` schema.

Minimum content:

```ts
interface ReferenceEvidence {
  version: string;
  referenceUrl?: string;
  screenshotId: string;
  screenshotMetadata: {
    pixelWidth?: number;
    pixelHeight?: number;
    likelyCssViewportWidth?: number;
    devicePixelRatio?: number;
  };
  captures: Array<{
    viewportWidth: number;
    viewportHeight?: number;
    screenshotArtifact: string;
  }>;
  regions: Array<{
    id: string;
    startY?: number;
    endY?: number;
    height?: number;
    viewportHeightRatio?: number;
    boundingBox?: { x:number; y:number; width:number; height:number };
  }>;
  measuredElements: Array<{
    selectorHint?: string;
    role?: string;
    boundingBox?: { x:number; y:number; width:number; height:number };
    computed?: Record<string, string | number | boolean | null>;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    source: "DOM" | "COMPUTED_STYLE" | "SCREENSHOT" | "BROWSER_INTERACTION";
  }>;
  responsiveObservations: unknown[];
  motionObservations: unknown[];
  discrepancies: unknown[];
}
```

Machine-extract before AI wherever measurable:

- element geometry;
- section boundaries;
- font family/weight/size/line height;
- colors;
- radii;
- container widths;
- sticky/fixed states;
- transition properties;
- image geometry;
- responsive changes.

---

# 11. Final REFERENCE_BOUND Pipeline

```text
CLIENT INTAKE
    ↓
NORMALIZE BUSINESS TRUTH
    ↓
REFERENCE SUITABILITY GATE
    ↓
SUPPORTED / SUPPORTED_WITH_LIMITATIONS ?
    ↓ yes
REFERENCE ACQUISITION
    ↓
REFERENCE EVIDENCE EXTRACTOR
    ↓
ReferenceEvidence v1
    ↓
REFERENCE ANALYZER
    ↓
ReferenceAnalysis
    ↓
VISUAL BLUEPRINT GENERATOR
    ↓
VisualBlueprint
    ↓
IMPLEMENTATION PLANNER
    ↓
ImplementationContract
    ↓
INCREMENTAL WEBSITE GENERATION
    ↓
HTML/CSS/JS + IMAGE_PLAN
    ↓
RUNTIME SCHEMA + DETERMINISTIC VALIDATION
    ↓
IMAGE WAVE 1
    ↓
IMAGE WAVE 2
    ↓
R2 PERSISTENCE + ASSET MANIFEST
    ↓
SITE ASSEMBLY
    ↓
TECHNICAL PREFLIGHT
    ↓
PREVIEW DEPLOY
    ↓
STANDARD QA EVIDENCE CAPTURE
    ↓
VISUAL GEOMETRY COMPARATOR
    ↓
QA-A + QA-B independently
    ↓
PASS? ── yes ──> READY_FOR_APPROVAL
    │
    no
    ↓
FIX COORDINATOR (one batch)
    ↓
CONFIRMATION QA
    ↓
PASS? ── yes ──> READY_FOR_APPROVAL
    │
    no
    ↓
OPTIONAL RELEASE BLOCKER FIX (one narrow batch)
    ↓
RERUN FAILED CONFIRMATION DOMAIN(S)
    ↓
PASS? ── yes ──> READY_FOR_APPROVAL
    │
    no
    ↓
HUMAN_REVIEW_REQUIRED
```

No unbounded mutation loop is allowed.

---

# 12. Reference Analyzer

Reference Analyzer remains separate from Blueprint generation.

Responsibility:

- interpret evidence;
- describe the reference system;
- identify confidence/ambiguity;
- record visual and photographic grammar;
- record responsive/motion behavior;
- do not redesign;
- do not map client content;
- do not choose implementation architecture.

Persist exact prompt/model/schema provenance with output.

---

# 13. Visual Blueprint Generator

The Blueprint is the binding visual contract.

It must define at minimum:

- visual thesis;
- 3–8 signature traits;
- fidelity priorities;
- design tokens;
- global grid/container logic;
- spacing rhythm;
- typography roles;
- color roles/distribution;
- surface/depth language;
- header/navigation language;
- homepage first viewport;
- ordered homepage regions;
- image system and photography grammar;
- image role contracts;
- motion grammar;
- responsive contract;
- inner-page design vocabulary;
- anti-fallback rules;
- accessibility/reference adaptations;
- declared capability limitations.

The Blueprint must not copy reference brand identity.

Client brand colors replace reference brand colors while preserving role and distribution when relevant.

---

# 14. Implementation Planner

Add a new stage between Blueprint and Website Generator.

The Planner converts the binding Blueprint into a technical Implementation Contract.

It decides:

- semantic page skeletons;
- shared CSS/token architecture;
- shared JS needs;
- component boundaries;
- exact file plan;
- content allocation by Blueprint region;
- responsive implementation strategy;
- image-slot placement strategy;
- approved dependencies;
- form integration hooks;
- metadata/assembly strategy.

It does **not** change:

- visual thesis;
- first viewport;
- signature traits;
- section topology;
- image roles;
- Blueprint intent.

If an implementation conflict exists, return a blocker.

Suggested output:

```ts
interface ImplementationContract {
  version: string;
  pages: Array<{
    id: "home" | "about" | "services" | "contact";
    path: string;
    regions: unknown[];
  }>;
  files: {
    sharedCss: string;
    sharedJs: string;
    pageFiles: Record<string,string>;
  };
  tokens: Record<string,string | number>;
  components: unknown[];
  responsiveStrategy: unknown;
  imageSlotStrategy: unknown;
  formContract: unknown;
  approvedDependencies: string[];
  blockers: unknown[];
}
```

---

# 15. Website Generation Strategy

Do not ask one model response to emit an enormous four-page site atomically.

Generate incrementally while sharing the same Blueprint + Implementation Contract:

1. shared design tokens/CSS;
2. shared header/footer/runtime JS;
3. Home;
4. About;
5. Services;
6. Contact;
7. IMAGE_PLAN;
8. deterministic cross-file assembly validation.

These are generation steps, not independent designers.

All output must remain visually consistent through the shared contracts.

---

# 16. Website Content Rules

Use only normalized client facts.

Never invent:

- testimonials/reviews;
- ratings;
- customer/project counts;
- years/founding dates;
- awards;
- certifications;
- guarantees;
- prices/discounts;
- opening hours;
- service areas;
- team members;
- partnerships;
- leadership claims;
- results metrics.

Missing data is omitted.

Content requirements are semantic, not permission to create generic sections.

Avoid generic AI filler and keyword stuffing.

---

# 17. Image Plan

Website generation produces HTML/CSS/JS plus a structured `IMAGE_PLAN`.

The Website Generator decides the business subject and composition role, not the final provider prompt.

Each image slot must include:

- id;
- page;
- region;
- semantic role;
- Blueprint role;
- requirement;
- priority;
- subject;
- shot type;
- orientation;
- aspect ratio;
- camera angle/distance;
- lighting;
- crop desktop/intermediate/mobile;
- human-presence rules;
- background style;
- color/temperature;
- composition/negative space/text-safe area;
- depth of field;
- realism;
- visual tone;
- mobile behavior;
- avoidance rules.

HTML references image slots as unresolved internal placeholders until assembly, e.g.:

```html
<img src="IMG:home-hero-primary" data-image-id="home-hero-primary" alt="...">
```

No final release may retain an unresolved `IMG:` token.

---

# 18. Image Quantity and Cost Budget

Normal V2 target:

```text
12 accepted images / completed four-page site
```

This is not a target of 12 generation attempts.

Hard provider budget:

```text
KIE spend <= USD 3.00 per completed site
```

Reserve approximately 20–25% for repair.

The orchestrator must budget expected spend before submitting generation tasks.

No image generation call may be launched when it would violate the hard budget unless an explicit human override capability is later designed.

---

# 19. Two-Wave Image Generation

Wave 1:

- all CRITICAL slots;
- HIGH homepage slots.

Wave 2:

- remaining NORMAL/supporting slots.

Use concurrency within each wave.

Do not generate all assets sequentially without reason.

Do not spend the complete budget before CRITICAL/HIGH results are known.

---

# 20. Image Repair Priority

For every image defect use this order:

1. CSS/object-position/container fix;
2. asset-routing fix;
3. content remap;
4. image regeneration;
5. prompt repair + regeneration;
6. Blueprint review only when contract itself is contradictory.

Regenerate only affected slots.

Mobile-specific generation only when a single master cannot satisfy the Blueprint.

Persist every accepted image to project-controlled storage before release.

No temporary KIE provider URL may remain in release output.

---

# 21. Runtime Validation of AI Boundaries

Every AI output must have a versioned runtime schema.

Required schema families include:

- NormalizedBusinessIntake;
- ReferenceSuitability;
- ReferenceEvidence;
- ReferenceAnalysis;
- VisualBlueprint;
- ImplementationContract;
- ImagePlan;
- ImagePromptRecord;
- QA-A;
- QA-B;
- FixCoordinator;
- confirmation reports;
- ReleaseBlockerFix.

Flow:

```text
model result
  -> parse
  -> runtime validate
  -> valid: continue
  -> invalid: one targeted schema repair
  -> still invalid: fail stage
```

Do not allow malformed AI JSON to propagate downstream.

Use the repo's existing robust validation approach if suitable; otherwise use Zod or equivalent.

---

# 22. Retry Policy

No blind retry loops.

Rules:

- deterministic transient infrastructure: bounded normal retry;
- malformed AI structure: one targeted repair;
- semantic AI failure: retry only with explicit corrective feedback when a stage contract permits it;
- KIE: priority/budget/attempt limits;
- browser capture: bounded infrastructure retry;
- QA mutation: only Fix Coordinator + optional Release Blocker Fix.

Persist attempt number and failure class.

---

# 23. Model Routing and Prompt Provenance

Different stages may use different configured models.

Do not hardcode one provider/model throughout product logic.

Persist with each AI artifact:

```ts
interface AiProvenance {
  promptId: string;
  promptVersion: string;
  model: string;
  schemaVersion: string;
  attempt: number;
  inputArtifactIds: string[];
  tokenUsage?: unknown;
  estimatedCost?: number;
}
```

Prompts are independently versioned product artifacts.

Benchmark runs should freeze model/settings/prompt/schema versions where supported.

---

# 24. Immutable Build Artifact Model

Persist complete immutable artifacts for every build version.

Recommended path model:

```text
builds/{buildId}/v{buildVersion}/
  source/
    index.html
    about.html
    services.html
    contact.html
    site.css
    site.js
  assets/
  manifest.json
  evidence/
  ai/
  qa/
```

D1 tracks metadata/state/indexes.

R2/project-controlled storage holds canonical source/evidence/assets.

Do not rebuild production by stitching together mutable AI fragments.

---

# 25. Canonical Build State Machine

Use an explicit state machine rather than inferring stage completion from incidental rows.

Recommended states:

```text
INTAKE_READY
REFERENCE_CHECK
REFERENCE_EVIDENCE
REFERENCE_ANALYSIS
BLUEPRINT
IMPLEMENTATION_PLAN
SITE_GENERATION
SITE_VALIDATION
IMAGE_WAVE_1
IMAGE_WAVE_2
ASSET_PERSISTENCE
ASSEMBLY
TECHNICAL_PREFLIGHT
PREVIEW
QA_EVIDENCE
QA
FIX
CONFIRMATION
RELEASE_BLOCKER_FIX
READY_FOR_APPROVAL
APPROVED
PUBLISHED
DEGRADED
FAILED
HUMAN_REVIEW_REQUIRED
```

One primary `WebsiteBuildWorkflow` owns lifecycle orchestration.

Use helper services for bounded operations.

Do not create nested workflow sprawl without a Cloudflare operational reason.

---

# 26. Mutation Boundary

AI agents return structured decisions/plans.

They do not receive arbitrary direct D1/R2 mutation authority.

Pattern:

```text
AI result
  -> runtime validation
  -> application service
  -> idempotent mutation
```

Examples:

- Fix Coordinator returns a Repair Plan;
- Repair Service applies validated file/asset changes;
- Image Prompt Generator returns prompt records;
- Image Service creates provider tasks and persists results.

This separation is mandatory for auditability and security.

---

# 27. Technical Preflight

Before expensive QA reasoning, run deterministic/browser preflight.

At minimum reject release candidates with:

- missing core page;
- malformed final HTML;
- missing H1;
- broken internal navigation;
- unresolved `IMG:` placeholders;
- missing CRITICAL images;
- broken image URLs;
- prohibited temporary provider URLs;
- invalid JSON-LD;
- missing required metadata;
- fatal JS errors;
- material page-level horizontal overflow;
- Contact form contract failure;
- duplicate critical IDs;
- obvious assembly failure.

Only a preflight-passing candidate enters full QA.

---

# 28. Standard QA Evidence Bundle

Every release candidate uses a standardized evidence set.

Home:

- desktop ~1440 full page;
- intermediate ~768 full page;
- mobile ~390 full page;
- first-viewport captures.

About, Services, Contact:

- desktop full page;
- mobile full page.

Also persist:

- geometry metrics;
- page load/runtime evidence;
- network/console evidence for QA-B;
- image manifest;
- implementation provenance.

Avoid QA agents independently creating inconsistent evidence sets.

---

# 29. Visual Geometry Comparator

Add a deterministic structural comparator for reference mode.

Do **not** use raw pixel similarity because content and imagery intentionally differ.

Compare normalized properties such as:

- first-viewport height ratio;
- region count/order;
- region height distribution;
- container width ratio;
- image mass position/size;
- major column ratios;
- dominant alignment;
- surface/light-dark sequence;
- whitespace distribution;
- major header/footer mass.

Output becomes evidence for QA-A, not a standalone release verdict.

---

# 30. QA-A — Visual + Content

QA-A judges rendered output rather than source implementation.

Inputs should prioritize:

- frozen reference screenshot;
- Visual Blueprint;
- adaptation contract;
- standardized final screenshots;
- geometry-comparator evidence;
- business data;
- IMAGE_PLAN;
- generated-image records.

QA-A should not normally require source code.

Release condition:

```text
visual fidelity >= 90
AND content quality >= 90
AND P0 = 0
AND P1 = 0
AND fabrication = false
AND hard visual gates pass
```

Hard visual gates include at minimum:

- first viewport materially correct;
- page silhouette/region order materially correct;
- dominant text/image mass materially correct;
- CRITICAL signature traits preserved;
- mobile preserves the same visual identity;
- CRITICAL imagery serves required role.

A 90+ score cannot compensate for a failed hard gate.

---

# 31. QA-B — Browser + Technical

QA-B owns:

- all four pages load;
- internal navigation;
- mobile menu;
- responsive mechanics;
- horizontal overflow;
- keyboard/focus;
- accessibility;
- Contact form behavior;
- Turnstile integration where configured;
- browser runtime/console/network;
- image-plan/manifest/R2 resolution;
- no temporary provider URLs;
- image loading/LCP/CLS risks;
- metadata/canonical/OG;
- truthful JSON-LD;
- crawlability;
- implementation contract integrity.

QA-B may inspect source/DOM/network/runtime.

Technical pass target remains >=90 with zero P0/P1 and all release gates passing.

---

# 32. Fix Coordinator

The Fix Coordinator is the only main QA-stage mutation planner.

It must:

- merge QA-A/QA-B findings;
- validate P0/P1 against actual evidence;
- deduplicate root causes;
- repair at narrowest correct level;
- preserve already-correct work;
- distinguish implementation defects from image-generation defects;
- respect KIE budget;
- create exactly one coordinated main repair batch.

It cannot mutate the Blueprint.

If the Blueprint is the root contradiction:

```text
BLUEPRINT_REVIEW_REQUIRED
```

Do not silently redesign through QA repair.

---

# 33. Confirmation and Hard Automation Limit

After the Fix Coordinator:

- QA-A Confirmation rechecks only previous/changed visual blockers;
- QA-B Confirmation rechecks only previous/changed technical blockers.

If one or both fail with valid P0/P1 blockers, allow at most one narrow Release Blocker Fix.

Then rerun only failed confirmation domains unless the repair plausibly affected another domain.

If confirmation still fails:

```text
HUMAN_REVIEW_REQUIRED
```

No further automated mutation.

---

# 34. Contact Form Architecture

The previous “presentation-only form” rule is superseded.

V2 requires a real working Contact form backed by one central multi-tenant WAZIBIZ Form Service.

Generated sites remain static and do not contain mail credentials or custom mail-worker logic.

Flow:

```text
visitor
  ↓
static contact form
  ↓
POST WAZIBIZ Form Service
  ↓
origin + schema + Turnstile + rate validation
  ↓
site_id -> SiteFormConfig
  ↓
approved sender/destination resolution
  ↓
Cloudflare-native outbound email
  ↓
delivery/audit metadata
```

---

# 35. Contact Form Browser Contract

The generated Contact page must include a semantic form, with stable platform field names.

Minimum:

```html
<form id="contact-form">
  name
  email
  message
</form>
```

Optional fields may include phone/subject when useful.

Browser payload may contain:

- public site/form identifier;
- visitor fields;
- Turnstile token;
- client-safe metadata required by the service.

Browser payload must **not** control:

- recipient (`to`);
- sender (`from`);
- sender domain;
- email template;
- internal routing;
- authentication credentials.

Use visitor email as Reply-To, not arbitrary From.

---

# 36. SiteFormConfig

Maintain form operational configuration separately from immutable website artifacts.

Example:

```ts
interface SiteFormConfig {
  siteId: string;
  enabled: boolean;
  allowedOrigins: string[];
  destinationEmail: string;
  senderIdentity: string;
  turnstileRequired: boolean;
  retentionPolicy?: string;
}
```

This configuration is intentionally mutable.

Changing a destination email must not require rebuilding/reapproving website design.

---

# 37. Form Security and Abuse Controls

Required:

- allowed-origin validation;
- server-side field schema validation;
- length limits;
- content/header-injection defenses;
- Cloudflare Turnstile;
- rate limiting;
- no client-selected destination;
- no secret leakage;
- no full form body logging to browser console;
- bounded delivery retries for transient server/provider failures.

Do not build a CRM in V2.

Persist minimal audit metadata such as:

- submission ID;
- site ID;
- timestamp;
- delivery status;
- outbound message ID when available;
- failure code;
- abuse/rate metadata needed for operations.

Message-body retention should be minimal/configurable.

---

# 38. Form UX

Do not report success until the form service accepts the submission for delivery.

Generated UI must support:

- submitting/pending state;
- accepted/success state;
- usable error state;
- accessible messages;
- retry after recoverable failure.

Visitor autoresponder is off by default in V2.

---

# 39. SEO Foundation

V2 guarantees technical/on-page foundations only:

- unique title/page;
- unique meta description/page;
- canonical when final base URL is known;
- semantic headings;
- crawlable navigation;
- truthful minimal JSON-LD;
- Open Graph where appropriate;
- correct alt semantics;
- no reference-domain/content leakage.

Do not turn builder generation into a full SEO campaign/content-management system.

---

# 40. Fonts

Typography is first-class reference evidence.

Rules:

- use supplied/legally accessible/public web fonts where appropriate;
- never copy proprietary font files from reference;
- when unavailable, record `REFERENCE_FONT_UNAVAILABLE` and use a declared closest approved substitute;
- validate actual font loading before release QA.

QA evaluates the declared limitation rather than pretending an unavailable proprietary font was reproducible.

---

# 41. Accessibility versus Fidelity

Do not reproduce clear accessibility failures just because the reference has them.

Adapt while preserving design character:

- insufficient contrast;
- invisible focus;
- materially undersized touch targets;
- hover-only critical functionality;
- motion incompatible with reduced-motion preference.

Record the adaptation in the Blueprint/adaptation contract.

---

# 42. Build Status and Degradation

Never silently degrade.

At minimum distinguish:

- normal in-progress stage states;
- `READY_FOR_APPROVAL`;
- `COMPLETED` where used operationally;
- `DEGRADED`;
- `FAILED`;
- `HUMAN_REVIEW_REQUIRED`;
- `APPROVED`;
- `PUBLISHED`.

A preview may exist for a degraded/failed build, but it must never be represented as a release PASS.

---

# 43. Human Approval and Publishing

Automated QA determines release readiness.

Human/customer approval determines publication.

Approval references an immutable build identity:

```text
build_id
build_version
artifact_manifest_hash
```

Production deploys exactly that version.

A later revision creates a new version and requires separate approval.

---

# 44. Observability

Every relevant event/log must include:

- buildId;
- buildVersion;
- stage;
- attempt;
- duration;
- model/provider where applicable;
- cost where known;
- result;
- error classification.

A developer must be able to answer “why did this build fail?” using one build-centric trace.

---

# 45. Benchmark Program

Freeze exactly five materially different reference sites before optimizing against their results.

Required categories:

1. asymmetric/editorial;
2. image-heavy hospitality/travel;
3. restrained corporate/professional;
4. bold trades/local service;
5. difficult but supported responsive/motion reference.

Do not replace a failed reference because it is inconvenient.

Freeze:

- canonical full-page screenshots;
- reference evidence snapshot;
- adaptation contracts;
- model/settings where possible;
- prompt versions;
- schema versions;
- standardized replacement-business briefs.

Use business briefs from different contexts than the reference company so the benchmark tests adaptation rather than content copying.

---

# 46. REFERENCE_BOUND Proof Threshold

The reference pipeline is sufficiently proven to begin Original Design when:

```text
at least 3 of 5 fixed benchmark sites PASS automatically
```

A benchmark PASS requires:

- zero manual source-code edits;
- QA-A visual >=90;
- QA-A content >=90;
- all hard visual gates pass;
- QA-B >=90;
- P0 = 0;
- P1 = 0;
- no fabrication;
- four valid pages;
- bounded mutation budget only;
- KIE spend <= USD 3.00/site;
- required Contact form integration functional where exercised.

3/5 unlocks work on Original Design. It does not mark reference quality as permanently finished.

---

# 47. Benchmark Runner

Build a dedicated benchmark harness.

For every run record:

- benchmark/reference ID;
- replacement business brief ID;
- suitability result;
- limitation contract;
- build ID/version;
- prompt/model/schema versions;
- QA-A score/gates;
- QA-B score/gates;
- KIE spend;
- total AI/browser usage metrics where available;
- number/type of repair cycles;
- final PASS/FAIL;
- root cause.

Example summary columns:

```text
Site | Suitability | QA-A | QA-B | KIE Spend | Final | Primary Root Cause
```

---

# 48. Failure Root-Cause Taxonomy

Every failed benchmark/build should classify a primary failure cause.

Minimum taxonomy:

```text
REFERENCE_UNSUITABLE
EVIDENCE_EXTRACTION
REFERENCE_ANALYSIS
BLUEPRINT
IMPLEMENTATION_PLAN
GENERATOR
IMAGE_PLAN
IMAGE_GENERATION
ASSEMBLY
TECHNICAL_PREFLIGHT
QA_FALSE_POSITIVE
FIX_COORDINATOR
FORM_SERVICE
PLATFORM_RUNTIME
```

Secondary causes may be recorded.

This taxonomy is required to improve the system rationally after benchmark runs.

---

# 49. Implementation Phases

## Phase 0 — Brownfield audit

Create/update:

```text
docs/architecture/v1-fork-audit.md
docs/architecture/v2-migration-manifest.md
```

Classify relevant V1 modules:

```text
KEEP
KEEP + RENAME
EXTEND
REFACTOR
REPLACE
DELETE BEFORE V2 RELEASE
```

## Phase 1 — Contracts and state

Implement:

- canonical build state machine;
- runtime schemas;
- artifact/provenance model;
- normalized business intake;
- prompt/model/schema versioning;
- build-centric logging.

## Phase 2 — Suitability and evidence

Implement:

- deterministic suitability scan;
- adaptation contract;
- ReferenceEvidence extractor;
- frozen evidence persistence.

## Phase 3 — Reference intelligence

Implement/update:

- Reference Analyzer;
- Visual Blueprint Generator;
- geometry comparator contract.

## Phase 4 — Implementation planning and site generation

Implement:

- Implementation Planner;
- incremental shared-contract generation;
- canonical static artifact structure;
- deterministic validation.

## Phase 5 — Images

Implement:

- Image Plan schema;
- provider-aware prompt generator;
- two-wave KIE orchestration;
- hard USD 3 budget control;
- R2 persistence/manifest;
- bounded regeneration.

## Phase 6 — Form service

Implement:

- multi-tenant SiteFormConfig;
- form endpoint;
- Turnstile;
- origin/rate/schema validation;
- Cloudflare-native outbound email;
- audit metadata;
- browser success/error contract.

## Phase 7 — Preflight/QA/repair

Implement:

- Technical Preflight;
- standardized evidence capture;
- Visual Geometry Comparator;
- QA-A;
- QA-B;
- Fix Coordinator;
- confirmation agents;
- Release Blocker Fix.

## Phase 8 — Benchmark proof

Freeze five references + replacement briefs and run the benchmark until the system reaches at least 3/5 automatic PASS without manual source edits.

## Phase 9 — Original Design

Only after benchmark proof:

- implement/re-enable Original-Design Blueprint flow;
- ensure industry archetypes are non-binding;
- run a separate original-design quality suite.

## Phase 10 — V1 removal / final audit

Remove all superseded V1 product logic and temporary migration scaffolding.

---

# 50. Mandatory Prompt Reconciliation

The prompt files in `v2-docs/prompts/` remain important stage specifications, but several were authored before the final grilling decisions.

Before wiring them into production runtime, reconcile them against this PRD.

Mandatory changes include at least:

1. Add prompt/spec for Reference Suitability interpretation if AI is needed.
2. Add ReferenceEvidence schema/consumer assumptions to Reference Analyzer.
3. Add Implementation Planner prompt/schema.
4. Update Website Generator to consume `ImplementationContract` and support incremental file generation.
5. Update Website Generator Contact form instructions: remove obsolete prohibition on backend submission; generate the platform form-client contract only.
6. Update QA-B form checks to validate real Form Service/Turnstile behavior instead of requiring absence of submission logic.
7. Update QA-B Confirmation accordingly.
8. Update Fix Coordinator/Release Blocker Fix so form defects may be repaired only within the platform form contract.
9. Ensure all QA visual pass rules include hard composition gates.
10. Add prompt/schema provenance fields where runtime artifact contracts require them.

Until reconciled, conflicting prompt clauses are **not authoritative**.

---

# 51. Security Requirements

At minimum:

- secrets only in Cloudflare bindings/secrets;
- no KIE/API/email credentials in generated assets;
- AI agents do not receive unrestricted mutation authority;
- provider callbacks validated/idempotent;
- no client-controlled outbound email destination;
- Turnstile + rate limiting for public forms;
- no form data logged unnecessarily;
- project-controlled persistent image URLs only;
- prompt-injection resistance for reference content;
- reference-site text/code treated as untrusted evidence;
- production publication references immutable approved artifacts.

---

# 52. Acceptance Criteria — REFERENCE_BOUND Implementation

A single site is release-ready only when:

- reference was supported or supported with declared limitations;
- normalized business facts validate;
- evidence/analysis/Blueprint/ImplementationContract schemas validate;
- all four pages exist;
- static output is framework-light and crawlable;
- hard visual geometry/composition gates pass;
- QA-A >=90 visual and >=90 content;
- QA-B >=90;
- P0/P1 = 0;
- no fabricated business facts;
- CRITICAL images resolve from persistent project storage;
- no temporary provider URL/unresolved image placeholder;
- KIE spend remains <= USD 3;
- Contact form reaches the central WAZIBIZ Form Service and passes technical/security checks;
- SEO foundation passes;
- bounded automated repair limit respected;
- immutable build artifacts/provenance preserved;
- build is `READY_FOR_APPROVAL`.

Publication additionally requires explicit human approval.

---

# 53. Acceptance Criteria — V2 Repository Release

V2 repository is not considered complete merely because a demo site works.

Before final V2 release:

- at least 3/5 fixed REFERENCE_BOUND benchmark sites pass automatically;
- benchmark harness exists;
- Original Design implementation follows only after reference proof;
- central form service works;
- runtime schemas exist for AI boundaries;
- immutable artifact/version model works;
- build-centric observability works;
- V1 legacy generator path is deleted;
- V1/V2 routing flags removed;
- superseded prompt/runtime registry entries removed;
- dead schemas/types/tests removed;
- docs describe V2 as the only active builder in this repo;
- no production route can invoke V1;
- migration manifest is resolved.

---

# 54. Coding-Agent Rules

When implementing this PRD:

1. Audit before rewriting infrastructure.
2. Do not preserve V1 product logic for compatibility.
3. Prefer deterministic extraction/validation over AI when the property is machine-measurable.
4. Keep AI stages narrow and schema-bound.
5. Persist immutable artifacts/provenance.
6. Never silently degrade.
7. Never create unbounded retries or QA loops.
8. Never mutate the Blueprint from implementation/QA stages.
9. Never let generated browser code choose mail recipients/senders.
10. Never exceed the hard KIE budget through uncontrolled retry.
11. Do not introduce a universal visual template under the guise of components/tokens.
12. Do not use design archetypes as an automatic design selector.
13. Keep generated customer sites static/framework-light.
14. Keep the build workflow understandable as one primary orchestrated lifecycle.
15. Treat this document as authoritative when older files disagree.

---

# 55. Documentation Source of Truth

Read in this order:

1. `v2-docs/IMPLEMENTATION-PRD.md`
2. `v2-docs/CAPABILITY-ENVELOPE.md`
3. `v2-docs/FINAL-DECISION-RECORD.md`
4. `v2-docs/prompts/*` after reconciliation to the PRD
5. root/V1 documents only for retained infrastructure context

The goal is one coherent V2 system, not a compatibility layer between competing specifications.
