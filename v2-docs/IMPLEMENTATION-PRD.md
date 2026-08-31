# WAZIBIZ CF-Native Website Builder V2
## Final Implementation PRD, Architecture and Coding-Agent Specification

**Status:** FINAL / AUTHORITATIVE  
**Version:** 2.0.0  
**Date:** 2026-08-31  
**Repository:** `KingSolomun79/Cf-native-website-builder-v2`  
**Runtime:** Cloudflare-native  
**Generated output:** static/framework-light HTML + CSS + minimal JS  
**Image generation:** KIE.ai  
**Browser/reference/QA:** Cloudflare browser infrastructure / Browser Run  
**Contact delivery:** central WAZIBIZ Form Service + Cloudflare-native outbound email

> `../CONTEXT.md` is authoritative for domain vocabulary and semantics. This PRD is authoritative for implementation requirements. If an older prompt, V1 file, root document or earlier PRD conflicts with either, the canonical domain model and this PRD win.

---

# 1. Product Goal

Build a Cloudflare-native website-generation system that creates high-quality four-page local-business Sites with strong design fidelity, distinctive visual quality, reliable imagery, deterministic validation, bounded autonomous repair, explicit human Approval and immutable Publication.

V2 has exactly two Build Modes:

1. `REFERENCE_BOUND` — recreate the visual architecture of an external Reference while replacing its content, branding, imagery and Business Facts.
2. `ORIGINAL_DESIGN` — create a distinctive visual system from Business, audience, brand, offer, conversion and creative-direction inputs without an external Reference.

Implementation order:

```text
REFERENCE_BOUND
  -> prove on fixed five-site benchmark
  -> minimum 3/5 Benchmark Pass
  -> then implement ORIGINAL_DESIGN
```

A Benchmark Pass means the exact result reaches Release Ready automatically, without manual source-code edits and within the hard KIE image-generation budget. Human Approval and Publication are not benchmark criteria.

---

# 2. Canonical Domain Model

Implementation must use `../CONTEXT.md` terminology exactly.

Core identity hierarchy:

```text
Business
  -> Site
      -> Site Generation
          -> Build
              -> Build Version
```

Release lifecycle for an exact Build Version:

```text
Build Version
  -> Release Candidate
      -> Release Ready
          -> Approval
              -> Publication
                  -> Published Version
```

## 2.1 No client-account domain

V2 has no Client Account, Client User, Customer Account or persistent mutable Client Profile concept.

A completely new Site Generation starts from one fresh immutable Onboarding Submission. The Business is the stable real-world entity; the Site is the stable website identity for that Business.

## 2.2 Onboarding Submission

An Onboarding Submission is an immutable fact/input snapshot for one Site Generation.

It must not be mutated later. Replacement Site Generations may use later Onboarding Submissions, while earlier submissions remain historical inputs to the Builds they governed.

## 2.3 Revision Request and Fact Update

A human-requested change that preserves both Reference and Build Mode is a Revision Request and starts a new Build.

A Revision Request may contain a Fact Update. A Fact Update supersedes affected Business Facts for the new Build lineage without mutating the historical Onboarding Submission or previous Builds.

Examples that normally remain Revision Requests:

- phone/email/address changes;
- opening-hours changes;
- service additions/removals;
- Business description changes;
- new approved imagery/content;
- design adjustments inside the existing Reference/design-origin contract.

Changing Reference or Build Mode is not a Revision Request; it starts a new Site Generation from a fresh Onboarding Submission.

## 2.4 Build and Build Version

A Build represents one fixed set of approved Business/content/design inputs.

Human new intent starts a new Build.

A Build Version is an immutable candidate state within that Build. Bounded Automated Repair may create `v2`, `v3`, etc., but it remains inside the same Build only while the governing Business inputs, Reference, Build Mode, Visual Blueprint and human intent remain fixed.

## 2.5 Automated Repair

Automated Repair may modify realization details only, including:

- HTML/CSS/JS implementation;
- CSS geometry/crop/object-position;
- content mapping within already-approved facts;
- asset routing;
- Image Attempt selection;
- bounded image regeneration where permitted;
- technical metadata and form integration defects;
- other Implementation Contract-compliant realization details.

Automated Repair must never:

- introduce new human intent;
- add/change Business Facts;
- replace Reference;
- change Build Mode;
- redefine the Visual Blueprint;
- silently change a declared Adaptation Contract.

Every material Automated Repair creates a new immutable Build Version and therefore a new Release Candidate that must be re-evaluated.

---

# 3. Repository Strategy

This repository is the dedicated V2 fork of the original builder. V1 remains preserved separately.

During implementation, proven infrastructure may be reused after audit, including:

- Worker bootstrap;
- Wrangler/environment/bindings;
- Cloudflare Workflows foundation;
- D1/R2 utilities;
- KIE client/auth/task/callback infrastructure;
- browser/screenshot utilities;
- deployment/domain plumbing;
- approval infrastructure;
- logging/observability;
- provider/AI Gateway wrappers;
- robust validation/tests.

Do not preserve obsolete product logic for compatibility:

- old generator intelligence;
- old design-analysis logic;
- old image prompting;
- old QA/self-review loops;
- hardcoded generic section architecture;
- permanent V1/V2 switches;
- superseded schemas/types/routes/tests/prompts.

V1 cleanup is a formal V2 release gate. No production route may invoke V1 after acceptance.

---

# 4. V2 Capability Envelope

The human and machine boundaries are maintained in:

- `CAPABILITY-ENVELOPE.md`
- `capability-envelope.json`

V2 supports:

- exactly Home, About, Services, Contact;
- static/framework-light output;
- semantic HTML;
- shared Site-specific CSS and minimal JS;
- responsive layouts;
- ordinary CSS/JS motion;
- hover/focus/active behavior;
- reveals, sticky behavior, simple parallax and justified lightweight sliders/carousels;
- KIE-generated Site imagery;
- central form delivery;
- deterministic SEO foundations;
- immutable versioned Publication.

Normally unsupported:

- WebGL/Three.js/canvas as the primary experience;
- physics-heavy interaction;
- complex specialized scroll choreography;
- authenticated application UIs;
- rich configurators/state machines;
- huge ecommerce/catalog architecture;
- CMS/blog as a core dependency;
- arbitrary page counts.

---

# 5. Generated Site Output Contract

Default generated artifact:

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

Page-specific CSS/JS is allowed only when genuinely required by the Visual Blueprint/Implementation Contract.

Do not use React, Tailwind, GSAP or comparable large libraries by default.

Standardize technical interfaces, not visual composition:

- semantic header/nav/main/footer;
- one H1 per page;
- metadata hooks;
- image-slot linkage;
- Contact form platform contract;
- accessibility fundamentals;
- small token layer;
- assembly/versioning contracts.

Reference-specific grids, overlaps, clipping, wrappers, asymmetry, spacing exceptions and component topology must remain possible.

---

# 6. Authority Order Inside a Build

Where implementation inputs conflict, resolve in this order:

1. supported Business Facts from governing Onboarding Submission + applicable Fact Updates;
2. explicit human requirements for the current Build;
3. security/accessibility/platform constraints;
4. Business brand requirements;
5. Adaptation Contract where applicable;
6. Visual Blueprint;
7. Reference Screenshot for static composition in `REFERENCE_BOUND`;
8. Reference URL/Reference Evidence for interaction/responsive/computed details;
9. Implementation Contract;
10. Image Slot requirements;
11. QA findings;
12. general best practice where higher authorities leave room.

Reference content is never Business truth.

---

# 7. Design Archetype Rule

`design_archetypes.md` is non-authoritative and should be removed from final V2 product logic.

No runtime rule may implement:

```text
industry -> predefined visual archetype
```

`ORIGINAL_DESIGN` must derive from:

```text
Business Facts
+ audience
+ offer/service model
+ physical/service environment
+ brand
+ conversion goal
+ explicit creative direction
+ design reasoning
```

---

# 8. REFERENCE_BOUND Fidelity Definition

`REFERENCE_BOUND` means structural visual reproduction, not style resemblance.

Target fidelity includes:

- region order;
- first-viewport topology;
- section proportions;
- major text/image mass;
- grid/container relationships;
- whitespace rhythm;
- surface/light-dark sequence;
- typography character;
- component geometry;
- image roles and crop logic;
- responsive transformations;
- ordinary motion/interaction behavior.

The new Site uses new Business content, branding and imagery.

Never copy the Reference logo, proprietary graphics, photography, trademarks, proprietary font files or implementation source wholesale. Measurement and independent reimplementation are allowed.

---

# 9. Reference, Screenshot and URL

A Reference is the design source for one `REFERENCE_BOUND` Site Generation.

## 9.1 Reference Screenshot

The frozen Reference Screenshot is authoritative for static composition:

- page silhouette;
- region order;
- proportions;
- image placement/mass;
- whitespace;
- surfaces;
- static component appearance.

## 9.2 Reference URL

The Reference URL supplements evidence for:

- computed typography/styles;
- hover/focus;
- transitions/animation;
- sticky/fixed behavior;
- responsive transformations;
- breakpoints;
- mobile-navigation behavior.

If current live behavior conflicts with static composition visible in the frozen screenshot, the screenshot wins and the discrepancy is recorded.

URL-only Reference input is valid only after a canonical screenshot/evidence package is captured and frozen.

---

# 10. Reference Suitability Gate

Run before Reference Analysis.

Canonical outcomes:

```ts
type ReferenceSuitability =
  | "SUPPORTED"
  | "SUPPORTED_WITH_LIMITATIONS"
  | "UNSUPPORTED";
```

Check deterministically first where possible:

- canvas/WebGL/Three.js dependence;
- application/authenticated behavior;
- dominant video dependence;
- extreme scroll-jacking;
- complex stateful interaction;
- unsupported page/product scale;
- rendering patterns outside capability envelope.

AI may interpret ambiguity only after deterministic evidence exists.

`SUPPORTED_WITH_LIMITATIONS` requires a concrete Adaptation Contract before generation:

```ts
interface AdaptationContract {
  version: string;
  unsupportedFeatures: Array<{
    feature: string;
    reason: string;
  }>;
  acceptedApproximations: Array<{
    replaces: string;
    substituteOutcome: string;
  }>;
  qaExceptions: string[];
}
```

An Adaptation Contract cannot legalize removal of an identity-defining unsupported feature. That case is `UNSUPPORTED`.

---

# 11. Reference Evidence

Reference Evidence records observations and measurements before interpretation.

Do not pass loose browser dumps directly to AI.

Minimum versioned schema:

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

Machine-extract where measurable:

- geometry;
- section boundaries;
- typography;
- colors;
- radii;
- container widths;
- sticky/fixed states;
- transition properties;
- image geometry;
- responsive changes.

Reference Evidence must never be rewritten to match later interpretation.

---

# 12. Reference Analysis

Reference Analysis interprets Reference Evidence.

Responsibilities:

- describe the visual system;
- identify hierarchy/relationships;
- identify signature traits;
- infer likely design intent with confidence;
- describe photographic grammar;
- describe responsive/motion behavior;
- identify what carries visual identity.

It must not:

- redesign;
- map Business content into a new design;
- fabricate observations;
- choose implementation architecture;
- overwrite Reference Evidence.

Persist prompt/model/schema provenance.

---

# 13. Visual Blueprint

The Visual Blueprint is the binding design contract.

It must define at minimum:

- visual thesis;
- 3–8 signature traits;
- fidelity priorities;
- tokens;
- global grid/container logic;
- spacing rhythm;
- typography roles;
- color roles/distribution;
- surface/depth language;
- header/navigation language;
- homepage first viewport;
- ordered homepage regions;
- image system/photography grammar;
- image role contracts;
- motion grammar;
- responsive contract;
- inner-page vocabulary;
- anti-fallback rules;
- accessibility/reference adaptations;
- declared capability limitations.

For `REFERENCE_BOUND`, it translates Reference Analysis into the intended Business Site while preserving identity-defining structure/signature traits and replacing branding/content/assets.

For `ORIGINAL_DESIGN`, it is created directly from Business/audience/brand/creative inputs.

Once generation begins, downstream Automated Repair may correct implementation against the Blueprint but may not redefine it.

If the Blueprint itself is materially wrong, contradictory or impossible, emit:

```text
BLUEPRINT_REVIEW_REQUIRED
```

This leads to `HUMAN_REVIEW_REQUIRED`. Human resolution may result in a new Build or new Site Generation depending on whether design origin changes.

---

# 14. Implementation Contract

The Implementation Planner creates the binding realization plan from Visual Blueprint + Business content.

It may decide:

- semantic page skeletons;
- shared CSS/token architecture;
- shared JS needs;
- component boundaries;
- file plan;
- Business content allocation by Blueprint region;
- responsive implementation strategy;
- Image Slot mapping;
- approved dependencies;
- form hooks;
- metadata/assembly strategy.

It may not change:

- visual thesis;
- first viewport;
- signature traits;
- section topology;
- image roles;
- Blueprint intent.

If realization is impossible inside the capability envelope, surface an explicit blocker rather than silently simplifying.

Minimum shape:

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

# 15. Incremental Website Generation

Do not ask one model call to emit the complete four-page Site atomically.

Generate incrementally under the same fixed Visual Blueprint + Implementation Contract:

1. shared design tokens/CSS;
2. shared header/footer/runtime JS;
3. Home;
4. About;
5. Services;
6. Contact;
7. Image Plan;
8. deterministic cross-file assembly validation.

These are generation steps, not independent designers.

Default CSS/JS architecture remains `site.css` + `site.js`, with exceptions only when required by contract.

---

# 16. Business Fact and Content Rules

Use only supported Business Facts from the governing Onboarding Submission plus applicable Fact Updates.

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

Missing factual data remains unknown/omitted.

Derived Content may create safe non-factual marketing language but cannot smuggle unsupported facts into copy.

---

# 17. Image Plan and Image Slots

Image Slots are stable semantic/compositional requirements defined before generation.

Each Image Slot should include:

- id;
- page;
- region;
- semantic role;
- Blueprint role;
- requirement;
- priority;
- subject;
- shot type;
- orientation/aspect ratio;
- camera angle/distance;
- lighting;
- desktop/intermediate/mobile crop intent;
- human-presence rules;
- background style;
- color/temperature;
- negative-space/text-safe requirements;
- depth of field;
- realism/visual tone;
- mobile behavior;
- avoidance rules.

HTML may reference unresolved internal slot placeholders during generation:

```html
<img src="IMG:home-hero-primary" data-image-id="home-hero-primary" alt="...">
```

Release Ready output must contain no unresolved `IMG:` token.

An Image Attempt is one candidate for one slot. An Accepted Image is the selected attempt for an exact Build Version.

Crop/object-position/remap/new attempt does not create a new slot. Changing the semantic/compositional role requires a new Build/Blueprint path.

---

# 18. Image Quantity, Waves and Budget

Normal target:

```text
12 Accepted Images / completed four-page Site
```

This is not 12 generation attempts.

Hard KIE spend gate:

```text
KIE image spend <= USD 3.00 per completed Site
```

Reserve ~20–25% for repair where practical.

Generation waves:

1. Wave 1 — all CRITICAL slots + HIGH homepage slots.
2. Wave 2 — remaining NORMAL/supporting slots.

Use concurrency within waves.

Repair priority:

1. CSS/object-position/container fix;
2. asset-routing fix;
3. content remap;
4. Image Attempt regeneration;
5. prompt repair + regeneration;
6. Blueprint Review only when the contract itself is defective.

Generate dedicated mobile variants only when one master cannot satisfy the required composition.

Persist every Accepted Image to project-controlled storage before Release Ready. No temporary provider URL may ship.

---

# 19. AI Boundary Validation

Every AI output is runtime validated by versioned schema.

Required families include:

- normalized Onboarding/Business inputs;
- ReferenceSuitability;
- AdaptationContract;
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

Malformed AI output must never propagate downstream.

---

# 20. Retry Policy

No blind retry loops.

- deterministic transient infrastructure: bounded retry;
- malformed AI structure: one targeted schema-repair attempt;
- semantic AI failure: retry only with explicit corrective feedback where the stage contract permits;
- KIE: priority/budget/attempt limits;
- browser capture: bounded infrastructure retry;
- QA mutation: exactly one Fix Coordinator batch + at most one Release Blocker Fix.

Persist attempt and failure class.

---

# 21. Prompt and Model Governance

Different stages may use different configured models.

Do not hardcode one model/provider throughout product logic.

Persist:

```ts
interface AiProvenance {
  promptId: string;
  promptVersion: string;
  promptDomainContractVersion: string;
  model: string;
  schemaVersion: string;
  attempt: number;
  inputArtifactIds: string[];
  tokenUsage?: unknown;
  estimatedCost?: number;
}
```

Canonical prompt runtime composition is defined by:

- `prompts/PROMPT-MANIFEST.md`
- `prompts/00-domain-contract-v1.md`

Each executable stage prompt is composed as:

```text
00-domain-contract-v1.md
+
full retained detailed stage-prompt body named in PROMPT-MANIFEST.md
```

The manifest runtime version supersedes the historical version suffix in the retained body filename.

The domain contract is authoritative over contradictory legacy clauses, including obsolete presentation-only/no-submit Contact-form rules.

---

# 22. Artifact and Retention Model

Canonical generated source for each Build Version is immutable while needed for active QA, Publication or Rollback.

Recommended artifact path:

```text
builds/{buildId}/v{buildVersion}/
  source/
  assets/
  manifest.json
  evidence/
  ai/
  qa/
```

D1 stores workflow state, metadata, indexes, Build Records and mutable Site Configuration.

R2/project-controlled storage holds source/evidence/assets where retention requires it.

## 22.1 Build Record

Retain lightweight Build Records even after disposable failed/superseded artifacts are cleaned up.

Build Record should include at least:

- Build and version identifiers;
- Site/Site Generation identity;
- outcome;
- QA scores/gates;
- root cause;
- cost;
- prompt/model/schema provenance;
- publication/approval history where applicable.

## 22.2 Disposable Deployments

Failed and superseded Preview Deployments are cleanup candidates. Do not accumulate Workers/Deployments indefinitely.

## 22.3 Published and Rollback retention

At most one current Published Version is active.

When Publication replaces it, retain the immediately previous Published Version as Rollback Version for a bounded rollback window. Older superseded published Deployments may be removed once they no longer hold the rollback role.

Benchmark evidence may be retained longer for reproducibility.

---

# 23. Canonical Workflow State Machine

Use explicit state rather than inferring completion from incidental rows.

Suggested canonical states:

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
RELEASE_READY
APPROVED
PUBLISHING
PUBLISHED
DEGRADED
FAILED
HUMAN_REVIEW_REQUIRED
```

`BLUEPRINT_REVIEW_REQUIRED` is a specific escalation signal/reason, not a normal retry state; it routes to `HUMAN_REVIEW_REQUIRED`.

One primary `WebsiteBuildWorkflow` owns lifecycle orchestration. Use helpers/services for bounded operations. Introduce child workflows only if Cloudflare operational limits materially require them.

---

# 24. Mutation Boundary

AI agents return structured decisions/plans and do not receive arbitrary D1/R2 mutation authority.

Pattern:

```text
AI result
  -> runtime validation
  -> application service
  -> idempotent mutation
```

Examples:

- Fix Coordinator returns a Repair Plan;
- Repair Service creates the next Build Version;
- Image Prompt Generator returns prompt records;
- Image Service creates provider tasks and persists Image Attempts;
- Publication Service publishes an already-approved exact Build Version.

---

# 25. Technical Preflight

Before expensive QA, reject Release Candidates with at least:

- missing core page;
- malformed final HTML;
- missing H1;
- broken internal navigation;
- unresolved `IMG:` placeholder;
- missing CRITICAL Accepted Image;
- broken image URL;
- temporary provider URL;
- invalid JSON-LD;
- missing required metadata;
- fatal JS error;
- material page-level horizontal overflow;
- Contact form contract failure;
- duplicate critical IDs;
- obvious assembly failure.

Only a preflight-passing candidate enters full QA.

---

# 26. Standard QA Evidence Bundle

Every Release Candidate uses a standardized evidence set.

Home:

- desktop ~1440 full page;
- intermediate ~768 full page;
- mobile ~390 full page;
- first-viewport captures.

About/Services/Contact:

- desktop full page;
- mobile full page.

Also persist:

- geometry metrics;
- runtime/load evidence;
- network/console evidence for QA-B;
- image manifest;
- Implementation Contract/provenance.

---

# 27. Visual Geometry Comparator

For `REFERENCE_BOUND`, compare normalized structural properties rather than raw pixels:

- first-viewport height ratio;
- region count/order;
- region height distribution;
- container-width ratio;
- image-mass position/size;
- major column ratios;
- dominant alignment;
- surface/light-dark sequence;
- whitespace distribution;
- major header/footer mass.

Comparator output is evidence for QA-A, not a standalone verdict.

---

# 28. QA-A — Visual and Content

QA-A judges rendered output, not implementation internals.

Primary inputs:

- Reference Screenshot in `REFERENCE_BOUND`;
- Visual Blueprint;
- Adaptation Contract;
- standardized candidate screenshots;
- geometry evidence;
- supported Business Facts;
- Image Plan/Image Slot records;
- Accepted Images.

Release condition:

```text
visual fidelity >= 90
AND content quality >= 90
AND P0 = 0
AND P1 = 0
AND fabrication = false
AND hard visual gates pass
```

Hard gates include:

- first viewport materially correct;
- page silhouette/region order materially correct;
- dominant text/image mass materially correct;
- CRITICAL signature traits preserved;
- mobile preserves visual identity;
- CRITICAL imagery serves required role.

A high aggregate score cannot compensate for a failed hard gate.

---

# 29. QA-B — Browser and Technical

QA-B owns:

- all four pages load;
- internal navigation;
- mobile menu;
- responsive mechanics;
- overflow;
- keyboard/focus/accessibility;
- central Form Service behavior;
- Turnstile integration where configured;
- runtime/console/network;
- image manifest/storage resolution;
- no provider URLs;
- image loading/LCP/CLS risks;
- metadata/canonical/OG;
- truthful JSON-LD;
- crawlability;
- Implementation Contract integrity.

QA-B may inspect source/DOM/network/runtime.

Technical pass target: >=90, P0=0, P1=0 and all mandatory gates passing.

---

# 30. Release Blocker and Repair

A Release Blocker is P0/P1 only. P2/P3 imperfections or optional polish do not prevent Release Ready when all mandatory gates pass.

## 30.1 Fix Coordinator

The Fix Coordinator creates exactly one coordinated main Automated Repair plan after failed QA.

It must:

- merge QA-A/QA-B findings;
- validate blockers against evidence;
- deduplicate root causes;
- repair at the narrowest correct level;
- preserve already-correct work;
- distinguish implementation/image defects;
- respect KIE budget;
- never change Business Facts/Reference/Build Mode/Visual Blueprint.

If Blueprint is the root cause:

```text
BLUEPRINT_REVIEW_REQUIRED
```

## 30.2 Confirmation

After applied repair creates a new Build Version:

- QA-A Confirmation rechecks previous/changed visual blocker domains;
- QA-B Confirmation rechecks previous/changed technical blocker domains;
- any domain plausibly affected by the repair must also rerun.

## 30.3 Release Blocker Fix

If confirmation still has valid P0/P1, allow at most one narrow final Automated Repair batch.

Then rerun failed/affected confirmation domains.

If a valid Release Blocker remains:

```text
HUMAN_REVIEW_REQUIRED
```

No further automated mutation.

---

# 31. Degraded and Failed

Never silently degrade.

`DEGRADED` means a genuinely useful Preview/partial result exists but one or more non-optional Build/release requirements remain unsatisfied. Degraded is never Release Ready and never auto-publishes.

`FAILED` means no usable candidate or meaningful partial result remains for inspection/diagnosis/salvage.

A Degraded or Failed state must not be represented as release PASS.

---

# 32. Release Ready, Approval and Publication

## 32.1 Release Ready

Release Ready is the automated quality state of one exact Build Version after all release gates pass and no Release Blocker remains.

It is not Approval and not Publication.

## 32.2 Approval

Approval is explicit human acceptance of one exact Release Ready Build Version and authorization to publish it.

Approval identity includes at least:

```text
build_id
build_version
artifact_manifest_hash
```

Approval never carries to another Build Version.

## 32.3 Publication

Publication is a separate explicit operational act.

It must deploy the exact approved Build Version without regeneration.

If Publication fails operationally while the Build Version remains unchanged, retry Publication using the same Approval.

Any Build Version change requires Release Ready + fresh Approval again.

## 32.4 Published Version

The successfully published exact Build Version becomes the current Published Version.

A Site has at most one current Published Version.

---

# 33. Rollback

When a new Published Version replaces the old one, retain the immediately previous Published Version temporarily as Rollback Version.

Rollback:

- restores that exact prior approved Build Version;
- performs no regeneration;
- creates no new Build;
- creates no new Build Version;
- requires no new Approval;
- preserves the historical fact that the replaced version was once published.

Mutable Site Configuration does not roll back unless explicitly requested.

A later corrected replacement must follow the normal Release Ready -> Approval -> Publication flow.

---

# 34. Site Configuration

Site Configuration is mutable operational state only.

Initial V2 Site Configuration includes form/email routing settings such as:

```ts
interface SiteConfiguration {
  siteId: string;
  form: {
    enabled: boolean;
    allowedOrigins: string[];
    formDestination: string;
    senderIdentity: string;
    turnstileRequired: boolean;
    retentionPolicy?: string;
  };
}
```

Changing Form Destination or verified Sender Identity:

- does not create a Build;
- does not create a Revision Request;
- does not require website rebuild;
- does not require Approval/Publication;
- survives website Rollback unless explicitly changed.

If a requested setting changes generated content/design/page behavior, it is not Site Configuration and must use the proper Build lifecycle.

---

# 35. Form Submission Architecture

V2 requires a real working Contact form backed by one central multi-tenant WAZIBIZ Form Service.

Generated Sites remain static and contain no mail credentials or custom per-Site mail Worker logic.

Flow:

```text
visitor
  -> static Contact form
  -> POST WAZIBIZ Form Service
  -> origin/schema/Turnstile/rate validation
  -> Accepted Submission
  -> resolve current Site Configuration
  -> Form Destination + Sender Identity
  -> Cloudflare-native Email Delivery
  -> bounded retry / delivery audit
```

---

# 36. Browser Form Contract

Minimum semantic form fields:

- name;
- email;
- message.

Optional phone/subject are allowed where useful.

Browser payload may contain only:

- public Site/form identifier;
- visitor fields;
- Turnstile token;
- client-safe metadata required by service.

Browser payload must not control:

- recipient;
- From sender;
- sender domain;
- email template;
- internal routing;
- credentials.

Visitor email may be validated and used as Reply-To. It must never become transactional `From`.

---

# 37. Accepted Submission and Email Delivery

A Form Submission becomes an Accepted Submission only when the platform has validated it and durably accepted responsibility for processing it.

Browser success must not be shown merely because client-side validation or a network request succeeded.

After acceptance:

- transient Email Delivery failure triggers bounded server-side retry;
- visitor must not be required to resubmit;
- permanent delivery failure is recorded and surfaced operationally;
- the Accepted Submission remains accepted and is not rewritten as nonexistent.

Persist minimal audit/processing data needed for reliability and operations. Message-body retention must remain minimal/configurable; V2 is not a CRM.

Visitor autoresponder is off by default.

---

# 38. Sender Identity

V2 defaults to one verified WAZIBIZ platform Sender Identity for outbound email.

A Business-owned sender domain may be supported later only after verification and remains mutable Site Configuration.

Never use arbitrary visitor-provided email as `From`.

---

# 39. Form Security

Required:

- allowed-origin validation;
- server-side field schema validation;
- length limits;
- content/header-injection defenses;
- Turnstile;
- rate limiting;
- no browser-selected destination/sender;
- no secret leakage;
- no full form body logging to browser console;
- bounded delivery retries;
- explicit delivery failure classification.

---

# 40. SEO Foundation

V2 guarantees technical/on-page foundations only:

- unique title/page;
- unique meta description/page;
- canonical when final base URL known;
- semantic headings;
- crawlable navigation;
- truthful minimal JSON-LD;
- Open Graph where appropriate;
- correct alt semantics;
- no Reference-domain/content leakage.

Full SEO campaign/content management is separate.

---

# 41. Fonts and Accessibility

Typography is first-class Reference Evidence.

Use supplied/legally accessible/public web fonts where appropriate. Never copy proprietary Reference font files. When unavailable, declare `REFERENCE_FONT_UNAVAILABLE` and use an approved closest substitute.

Do not reproduce clear accessibility failures merely for fidelity. Adapt contrast, focus, touch targets, hover-only critical functionality and reduced-motion behavior while preserving design character. Record adaptations in Blueprint/Adaptation Contract.

---

# 42. Observability

Every relevant event/log includes:

- siteId;
- siteGenerationId;
- buildId;
- buildVersion;
- stage;
- attempt;
- duration;
- model/provider where applicable;
- cost where known;
- result;
- error/root-cause classification.

A developer must be able to answer “why did this Build fail?” from one Build-centric trace.

---

# 43. Benchmark Program

Freeze exactly five materially different Benchmark Sites before optimizing against results:

1. asymmetric/editorial;
2. image-heavy hospitality/travel;
3. restrained corporate/professional;
4. bold trades/local service;
5. difficult but supported responsive/motion Reference.

Do not replace a failing Benchmark Site because it is inconvenient.

Freeze:

- canonical Reference Screenshot;
- initial Reference Evidence;
- Adaptation Contract;
- prompt/model/schema settings where possible;
- standardized replacement-Business inputs.

The live Reference URL may be rechecked for drift, but the frozen target is not silently refreshed.

---

# 44. Benchmark Pass

A Benchmark Pass requires the exact candidate to reach Release Ready through the automated pipeline with:

- zero manual source-code edits;
- QA-A visual >=90;
- QA-A content >=90;
- all hard composition gates;
- QA-B >=90;
- P0=0;
- P1=0;
- no fabrication;
- four valid pages;
- bounded Automated Repair only;
- KIE image spend <= USD 3.00/Site;
- Contact form capability functional where exercised.

Approval and Publication are not required for Benchmark Pass.

At least 3/5 Benchmark Pass unlocks `ORIGINAL_DESIGN` implementation work. It does not mean `REFERENCE_BOUND` quality work ends.

---

# 45. Benchmark Runner and Root Cause

Record for each run:

- Benchmark Site ID;
- replacement Business brief/input ID;
- Reference Suitability;
- Adaptation Contract version;
- Build ID/version;
- prompt/model/schema versions;
- QA-A score/gates;
- QA-B score/gates;
- KIE spend;
- model/browser usage where available;
- repair count/type;
- final PASS/FAIL;
- primary root cause.

Minimum root-cause taxonomy:

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

---

# 46. Implementation Phases

## Phase 0 — Brownfield audit

Create/update:

```text
docs/architecture/v1-fork-audit.md
docs/architecture/v2-migration-manifest.md
```

Classify modules as KEEP, KEEP+RENAME, EXTEND, REFACTOR, REPLACE, DELETE BEFORE V2 RELEASE.

## Phase 1 — Domain contracts/state

Implement:

- `CONTEXT.md` vocabulary in code types/names;
- Site/Site Generation/Build/Build Version identities;
- Onboarding Submission immutability;
- Revision Request/Fact Update model;
- state machine;
- runtime schemas;
- provenance;
- Build Records;
- Site Configuration separation;
- Build-centric logging.

## Phase 2 — Suitability/evidence

Implement deterministic Suitability Gate, Adaptation Contract, Reference Evidence extractor and frozen evidence persistence.

## Phase 3 — Reference intelligence

Implement Reference Analysis, Visual Blueprint and geometry-comparator contract.

## Phase 4 — Planning/generation

Implement Implementation Planner, incremental generation, canonical static artifact structure and deterministic assembly validation.

## Phase 5 — Images

Implement Image Slot/Image Attempt/Accepted Image schemas, provider prompt generation, two-wave orchestration, USD 3 budget control, persistent assets and bounded regeneration.

## Phase 6 — Form service

Implement central Form Service, Site Configuration, Form Destination, Sender Identity, Turnstile, origin/rate/schema validation, Accepted Submission persistence, Cloudflare-native Email Delivery, bounded retry and UX contract.

## Phase 7 — QA/repair

Implement Technical Preflight, standard evidence, geometry comparator, QA-A, QA-B, Fix Coordinator, confirmations, Release Blocker Fix, BLUEPRINT_REVIEW_REQUIRED and hard automation stop.

## Phase 8 — Approval/Publication/Rollback

Implement Release Ready, exact Build Version Approval, separate idempotent Publication, Rollback Version retention and Rollback semantics.

## Phase 9 — Benchmark proof

Freeze five Benchmark Sites and run until at least 3/5 Benchmark Pass.

## Phase 10 — Original Design

Implement/re-enable `ORIGINAL_DESIGN` Blueprint flow and quality suite. Keep Design Archetypes non-binding.

## Phase 11 — V1 removal/final audit

Delete superseded V1 product logic, switches, prompts, schemas/types/tests/routes and obsolete docs. No V1 production route remains.

---

# 47. Repository Release Acceptance

Before V2 release:

- canonical domain model implemented consistently;
- no Client Account/Client User product model introduced;
- 3/5 fixed Benchmark Sites pass automatically;
- benchmark harness exists;
- central Form Service works;
- prompt composition uses canonical manifest/domain contract;
- runtime schemas exist for AI boundaries;
- immutable Build Version model works;
- Release Ready/Approval/Publication are separate and correct;
- Rollback Version/rollback behavior works;
- Build Records survive cleanup of disposable Deployments;
- Site Configuration is independent from immutable Builds;
- Build-centric observability works;
- V1 generator path deleted;
- V1/V2 routing flags removed;
- superseded prompt registry entries removed;
- dead schemas/types/tests removed;
- no production route invokes V1.

---

# 48. Coding-Agent Rules

1. Read `../CONTEXT.md` before implementation and use its terms exactly.
2. Audit infrastructure before rewriting it.
3. Do not preserve V1 product logic for compatibility.
4. Prefer deterministic extraction/validation when machine-measurable.
5. Keep AI stages narrow and schema-bound.
6. Persist prompt/model/schema provenance.
7. Never silently degrade.
8. Never create unbounded retries or QA loops.
9. Human new intent creates a new Build; Automated Repair creates a new Build Version only inside fixed contracts.
10. Never mutate Business Facts through Automated Repair.
11. Never mutate the Visual Blueprint through implementation/QA repair.
12. Emit `BLUEPRINT_REVIEW_REQUIRED` for Blueprint-root defects.
13. Never let browser code choose mail recipients/senders.
14. Use verified platform Sender Identity by default and visitor email only as Reply-To.
15. Never exceed KIE hard budget through uncontrolled retry.
16. Do not introduce a universal visual template.
17. Do not use Design Archetypes as automatic design selectors.
18. Keep generated Sites static/framework-light.
19. Publication deploys the exact approved Build Version without regeneration.
20. Approval and Publication are separate.
21. Rollback restores exact prior Published Version without creating a Build.
22. Do not roll back Site Configuration implicitly.
23. Clean up failed/superseded Deployments while retaining required Build Records and Rollback Version.
24. Use only prompt versions declared by `prompts/PROMPT-MANIFEST.md`.

---

# 49. Documentation Source of Truth

Read in this order:

1. `../CONTEXT.md` — canonical domain vocabulary/semantics.
2. `IMPLEMENTATION-PRD.md` — normative implementation specification.
3. `CAPABILITY-ENVELOPE.md` + `capability-envelope.json` — support boundary.
4. `FINAL-DECISION-RECORD.md` — locked decisions/rationale.
5. `prompts/PROMPT-MANIFEST.md`.
6. `prompts/00-domain-contract-v1.md` + retained detailed prompt body.
7. root/V1 documentation only for explicitly retained infrastructure context.

The goal is one coherent V2 system, not compatibility between competing specifications.
