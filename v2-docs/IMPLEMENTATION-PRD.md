# WAZIBIZ CF-Native Website Builder V2
## Complete Fork-Based Implementation PRD, Architecture & AI Coding Agent Guide

**Source repository:** Existing `CF-native-website-builder`  
**Target repository:** Fork dedicated to Website Builder V2  
**V1 repository:** Preserved permanently as the historical/stable V1 implementation  
**V2 repository:** Becomes a clean standalone V2 implementation  
**Runtime:** Cloudflare-native  
**Image generation:** KIE.ai  
**Browser/reference/QA tooling:** Existing Cloudflare browser infrastructure / Browser Run  
**Implementation model:** Brownfield code reuse during construction, clean V2 repository at completion

---

# 1. Repository Strategy

We are NOT upgrading V1 in place.

We are forking the current repository and building V2 inside the fork.

Final repository structure at organizational level:

```text id="w09yp0"
Wazibiz-Webdesign-Kenya/
│
├── CF-native-website-builder
│   └── V1 frozen / maintained independently
│
└── CF-native-website-builder-v2
    └── clean V2 implementation
```

The V2 fork may initially contain V1 code because it originates from V1.

That is temporary.

The finished V2 repository must NOT permanently contain:

- old website generator;
- old reference-analysis workflow;
- old image prompting logic;
- old QA implementation superseded by V2;
- V1/V2 routing switches;
- long-lived feature flags selecting old vs new;
- dead compatibility adapters;
- unused database fields created only for V1;
- abandoned prompts;
- deprecated build states;
- duplicate orchestration systems.

The V1 repository remains available if historical code is needed.

Therefore V2 has no reason to become a compatibility museum.

---

# 2. Core Migration Principle

Development follows:

```text id="rw5tno"
FORK V1
   ↓
AUDIT
   ↓
IDENTIFY REUSABLE INFRASTRUCTURE
   ↓
BUILD CLEAN V2 PIPELINE
   ↓
VERIFY V2
   ↓
REMOVE ALL SUPERSEDED V1 CODE
   ↓
FINAL V2 ARCHITECTURE AUDIT
   ↓
V2 RELEASE
```

The desired philosophy is:

> Reuse proven infrastructure, not obsolete architecture.

---

# 3. What We Reuse

The implementation agent must first inspect the fork.

Reuse working infrastructure where it remains appropriate.

Strong reuse candidates include:

- Cloudflare Worker bootstrap;
- Wrangler configuration;
- environment handling;
- Worker bindings;
- secrets;
- Cloudflare Workflows integration;
- D1 access utilities;
- R2 access utilities;
- KIE.ai API client;
- KIE authentication;
- KIE task creation;
- KIE callback handling if already good;
- browser/screenshot utilities;
- Browser Run integration;
- deployment utilities;
- preview URL handling;
- customer approval workflow;
- domain/custom-hostname utilities;
- logging;
- AI Gateway/provider wrappers;
- common validation utilities;
- useful tests.

Reuse is based on actual quality after inspection.

Nothing is retained solely because V1 used it.

---

# 4. What V2 Replaces

The following V1 intelligence should be assumed superseded unless the audit proves a reusable lower-level component exists:

- legacy website-generation prompt;
- legacy design-analysis prompt;
- legacy reference interpretation logic;
- generic section-generation rules;
- legacy image brief/prompt logic;
- old image-slot semantics;
- old website review prompt;
- any single-agent self-review loop;
- old automatic design-repair loop;
- hardcoded section structures;
- forced hero architecture;
- forced footer architecture;
- old metadata assembly if incompatible with per-page metadata;
- V1-specific generation schemas.

These are not compatibility requirements for the finished V2 repo.

---

# 5. Development vs Final Architecture

During development it is acceptable to have:

```text id="4vpveb"
legacy/
builder-v2/
```

or temporary:

```text id="pwalaf"
USE_BUILDER_V2=true
```

for side-by-side testing.

At V2 completion:

```text id="xenxls"
legacy/
```

must be deleted if no longer required.

And:

```text id="8qb8w5"
USE_BUILDER_V2
```

must disappear if V2 is now the only builder.

Final code should simply be:

```text id="z9dzuh"
builder/
```

not:

```text id="dy1xwd"
builder-v2/
```

unless the `v2` name remains useful as product terminology.

Inside the dedicated V2 repository there is no need to pretend another builder exists.

---

# 6. Final Product Goal

V2 creates high-quality four-page local-business websites using either:

## Reference-Bound Mode

Input:

- business onboarding data;
- optional client creative requirements;
- client brand palette;
- full-page reference screenshot;
- live reference URL.

Goal:

Reproduce the visual system as closely as practical while replacing reference:

- content;
- branding;
- imagery;
- business facts.

## Original-Design Mode

Input:

- business;
- industry;
- target audience;
- palette;
- visual style;
- design language;
- creative direction.

Goal:

Create a distinctive, non-generic visual system without requiring a reference.

Both modes converge on the exact same:

```text id="w7fwy2"
Visual Blueprint
```

and then use the same downstream system.

---

# 7. Architectural Principle

V2 separates responsibilities:

```text id="fo8su3"
EVIDENCE
   ↓
REFERENCE ANALYSIS
   ↓
DESIGN CONTRACT
   ↓
WEBSITE IMPLEMENTATION
   ↓
IMAGE ART DIRECTION
   ↓
IMAGE GENERATION
   ↓
REAL RENDERED WEBSITE
   ↓
INDEPENDENT QA
   ↓
CONTROLLED REPAIR
   ↓
CONFIRMATION
```

Do not collapse this into a new mega-prompt.

---

# 8. Complete V2 Workflow

```text id="n74t4c"
CLIENT ONBOARDING
       │
       ▼
[0] NORMALIZE BUSINESS INPUT
       │
       ▼
[1] SELECT BUILD MODE
       │
       ├──────────────────────────────┐
       │                              │
       ▼                              ▼
REFERENCE_BOUND                ORIGINAL_DESIGN
       │                              │
       ▼                              │
[2] REFERENCE ACQUISITION             │
       │                              │
       ▼                              │
[3] REFERENCE ANALYZER v2             │
       │                              │
       ▼                              ▼
[4A] VISUAL BLUEPRINT v2    [4B] ORIGINAL BLUEPRINT v2
       │                              │
       └─────────────┬────────────────┘
                     ▼
               VISUAL BLUEPRINT
                     │
                     ▼
          [5] WEBSITE GENERATOR v3
                     │
           HTML/CSS/JS + IMAGE_PLAN
                     │
                     ▼
       [6] DETERMINISTIC VALIDATION
                     │
                     ▼
       [7] KIE IMAGE PROMPT GENERATOR
                     │
                     ▼
               KIE.ai TASKS
                     │
                     ▼
             provider callback
                     │
                     ▼
                 R2 STORAGE
                     │
                     ▼
               ASSET MANIFEST
                     │
                     ▼
             [8] SITE ASSEMBLY
                     │
                     ▼
             [9] PREVIEW DEPLOY
                     │
                     ▼
          [10] BROWSER EVIDENCE
                     │
               ┌─────┴─────┐
               ▼           ▼
          [11A] QA-A   [11B] QA-B
               │           │
               └─────┬─────┘
                     ▼
          [12] FIX COORDINATOR v2
                     │
                     ▼
               BUILD VERSION 2
                     │
                     ▼
             REBUILD / CAPTURE
                     │
               ┌─────┴─────┐
               ▼           ▼
       [13A] QA-A CONF  [13B] QA-B CONF
               │           │
               └─────┬─────┘
                     ▼
                  BOTH PASS?
                  /       \
                YES        NO
                 │          │
                 ▼          ▼
          HUMAN APPROVAL  RELEASE BLOCKER FIX
                            │
                            ▼
                       BUILD VERSION 3
                            │
                            ▼
                  rerun failed confirmation(s)
                            │
                         PASS?
                       /       \
                     YES        NO
                      │          │
                      ▼          ▼
               HUMAN APPROVAL  HUMAN REVIEW
```

---

# 9. Hard Automation Limit

V2 permits only:

```text id="960tm9"
Initial generation
      ↓
one Fix Coordinator batch
      ↓
optional one Release Blocker Fix
```

No infinite autonomous design loop.

If a release confirmation still fails after the blocker fix:

```text id="wsalh8"
HUMAN_REVIEW_REQUIRED
```

---

# 10. Phase 0 — Mandatory Fork Audit

Before implementing V2, inspect the fork.

Create:

```text id="b73k1a"
docs/architecture/v1-fork-audit.md
```

The audit must answer:

## Worker

Where are:

- entrypoints;
- routes;
- middleware;
- bindings;
- auth;
- webhooks?

## Workflow

Where is current:

- generation orchestration;
- retries;
- waits;
- approval;
- publishing?

## AI

Where are:

- model calls;
- AI Gateway;
- prompts;
- response parsing?

## KIE

Where are:

- client;
- auth;
- image prompt generation;
- task submission;
- polling/callback;
- storage;
- retries?

## Browser

Where are:

- screenshot utilities;
- URL validation;
- rendering;
- browser sessions?

## Persistence

Document:

- D1 schema;
- R2 buckets;
- KV;
- Durable Objects where used.

## Deployment

Document:

- preview;
- static assembly;
- production deployment;
- domains.

## Approval

Document:

- preview UI;
- approval API;
- revision handling.

---

# 11. Audit Classification

Every relevant V1 module receives:

```text id="ll5epu"
KEEP
KEEP + RENAME
EXTEND
REFACTOR
REPLACE
DELETE BEFORE V2 RELEASE
```

This final category matters.

Example:

```text id="uz9cpp"
src/legacy/generator.ts
Classification:
DELETE BEFORE V2 RELEASE

Reason:
Entire functionality superseded by Website Generator v3.
```

---

# 12. Migration Manifest

Create:

```text id="wwzvat"
docs/architecture/v2-migration-manifest.md
```

Use:

| V1 component | V2 decision | New owner | Final V1 code removed? |
|---|---|---|---|
| KIE client | KEEP | images/provider | No |
| legacy image prompt | REPLACE | Image Prompt Generator | Yes |
| website generator | REPLACE | Website Generator v3 | Yes |
| R2 helper | KEEP | artifacts | No |
| old QA prompt | REPLACE | QA-A/QA-B | Yes |

This document drives final cleanup.

---

# 13. Temporary Development Architecture

During construction:

```text id="htvbrl"
src/
  legacy/
    ...

  builder-v2/
    ...
```

is acceptable.

OR reuse current source locations when separation is clear.

But this is temporary development scaffolding.

---

# 14. Required Final Cleanup

Before V2 release:

Move/rename V2 into canonical structure if appropriate.

Example:

FROM:

```text id="v5jv2g"
src/builder-v2/
```

TO:

```text id="u7xntd"
src/builder/
```

Delete:

```text id="e5ad54"
src/legacy/
```

Delete old feature flags.

Delete old prompt registry entries.

Delete V1 generator types.

Delete V1-only tests.

Delete V1-only migrations that are not part of current schema history, where safely possible.

Update docs to describe only V2.

---

# 15. Canonical Business Input

Normalize onboarding once.

```ts id="na354l"
interface NormalizedBusinessIntake {
  name: string;
  category: string;

  description?: string;
  audience?: string;

  services: Array<{
    name: string;
    description?: string;
  }>;

  location: {
    type:
      | "storefront"
      | "service-area"
      | "hybrid"
      | "appointment-only"
      | "unknown";

    publicAddress?: string;
    serviceAreas: string[];
  };

  phone?: string;
  email?: string;

  openingHours?: Array<{
    day: string;
    open?: string;
    close?: string;
  }>;

  primaryAction?: string;

  social: {
    facebook?: string;
    instagram?: string;
    x?: string;
    linkedin?: string;
  };

  brand: {
    primary?: string;
    secondary?: string;
    accent?: string;
    accent2?: string;

    visualStyle?: string;
    designLanguage?: string;
    creativeDirection?: string;
  };
}
```

All V2 agents consume this normalized object.

---

# 16. Build Mode

```ts id="vmmn44"
type BuilderMode =
  | "REFERENCE_BOUND"
  | "ORIGINAL_DESIGN";
```

Prefer REFERENCE_BOUND when usable evidence exists.

---

# 17. Reference Evidence

Screenshot remains static-homepage authority.

Live URL supplements:

- typography;
- motion;
- hover;
- responsive behavior;
- other computed details.

Store original screenshot unchanged.

Capture live reference approximately at:

```text id="h1wmaj"
1440
768
390
```

where available.

---

# 18. Reference Analyzer v2

Use approved:

```text id="pb2e0s"
Reference Analyzer v2
```

It only observes.

It produces:

```text id="e6tty5"
ReferenceAnalysis
```

including:

- geometry;
- silhouette;
- first viewport;
- regions;
- typography;
- colours;
- surfaces;
- components;
- photography grammar;
- responsive behavior;
- motion;
- inner-page evidence.

---

# 19. Visual Blueprint Generator v2

Reference builds use:

```text id="nm9phz"
ReferenceAnalysis
→ Visual Blueprint Generator
→ VisualBlueprint
```

This creates the binding design contract.

---

# 20. Original-Design Blueprint Generator v2

No-reference builds skip Reference Analyzer.

They use:

```text id="411ipd"
Business input
+
brand
+
industry
+
creative direction
→ Original Blueprint Generator
→ VisualBlueprint
```

Same core Blueprint contract.

---

# 21. Visual Blueprint Is Canonical

All subsequent stages consume:

```text id="b6lrmd"
VisualBlueprint
```

Website Generator does not reinterpret the reference.

QA does not invent a second design contract.

Image Prompt Generator does not independently create a photography system.

---

# 22. Website Generator v3

Use approved:

```text id="wkx1iy"
Website Generator v3
```

Responsibilities:

- business truth;
- copy;
- semantic content mapping;
- Blueprint implementation;
- HTML;
- CSS;
- JS;
- per-page metadata;
- structured IMAGE_PLAN.

It does not write final KIE prompts.

---

# 23. Generator Output

Exactly:

```text id="fjino1"
HEAD
META:home
META:about
META:services
META:contact
FOOTER
PAGE:home
PAGE:about
PAGE:services
PAGE:contact
IMAGE_PLAN
```

---

# 24. IMAGE_PLAN

Every meaningful generated image gets structured art direction.

Mandatory fields include:

- subject;
- shot type;
- orientation;
- aspect ratio;
- camera angle;
- camera distance;
- lighting;
- crop;
- human presence;
- background style;
- colour;
- temperature;
- composition;
- negative space;
- text-safe area;
- depth;
- realism;
- mobile behavior.

---

# 25. Image HTML

Use:

```html id="qfauyx"
<img
  src="IMG:home-hero-primary"
  alt="..."
  data-image-id="home-hero-primary"
>
```

Do not store large image prompts inside HTML.

---

# 26. Deterministic Site Validation

Run BEFORE KIE.

Validate:

- required blocks;
- valid IMAGE_PLAN;
- four pages;
- metadata;
- H1;
- navigation;
- Contact form;
- image mappings;
- minimum image count;
- fixed roles;
- no orphan slots;
- JSON-LD parse.

Maximum:

```text id="k4an93"
one targeted generator repair
```

before failure.

---

# 27. KIE Image Prompt Generator v1

Use approved prompt.

For each Image Plan item:

```text id="odoq3f"
Business context
+
Visual Blueprint photography grammar
+
Image Plan
+
KIE model capabilities
```

produces provider-ready:

- positive prompt;
- negative prompt;
- aspect ratio;
- provider parameters;
- mobile art-direction recommendation.

---

# 28. Reuse Existing KIE Integration

The low-level KIE client should be reused if reliable.

Target architecture:

```text id="7zu5gn"
Image Prompt Generator
        ↓
ImageGenerationService
        ↓
KieProvider
        ↓
existing proven HTTP integration
```

Do not rewrite a working provider client because V2 is new.

---

# 29. KIE Call Timing

Run KIE:

```text id="zvh6cq"
AFTER
Website Generator

AFTER
validation

AFTER
IMAGE_PLAN

BEFORE
visual QA
```

This is mandatory.

---

# 30. Image Generation

Fan out image tasks with concurrency controls.

Priority:

```text id="gl697l"
CRITICAL homepage
HIGH homepage
inner-page lead
supporting
```

Do not run sequentially unless required.

---

# 31. KIE Completion

Preferred:

```text id="klqj2k"
KIE callback
→ verify
→ persist callback
→ signal Workflow
```

Use existing callback/polling implementation if already sound, but final V2 should preferably use the cleaner callback flow.

---

# 32. KIE Security

Validate provider webhook using documented signature mechanism.

Ensure:

- timestamp tolerance;
- HMAC;
- constant-time compare;
- idempotency.

Provider callbacks may be repeated.

Do not process accepted task twice.

---

# 33. R2 Persistence

Final pages must never depend on temporary provider URLs.

Flow:

```text id="annlzf"
KIE result
↓
download
↓
R2
↓
asset manifest
↓
website
```

---

# 34. Canonical Image Manifest

Use one source of truth:

```ts id="mqd8y5"
interface ImageAssetManifest {
  buildId: string;
  buildVersion: number;

  images: Record<
    string,
    {
      slotId: string;
      acceptedGenerationId: string;
      assetKey: string;
      publicUrl: string;

      width?: number;
      height?: number;

      mobileVariant?: {
        generationId: string;
        assetKey: string;
        publicUrl: string;
      };
    }
  >;
}
```

---

# 35. Site Assembly

Assembler resolves:

```text id="kcyu25"
IMG:id
```

using manifest.

It must not query KIE directly.

---

# 36. Preview Deployment

Use existing working preview infrastructure.

Build versions:

```text id="p8o3br"
v1 initial generation
v2 Fix Coordinator
v3 Release Blocker Fix
```

---

# 37. QA Capture

After real images are assembled:

capture actual website.

Homepage:

```text id="u08ct1"
1440
768
390
```

Inner pages as needed.

Reuse evidence between agents where appropriate.

---

# 38. QA-A Visual + Content v2

Use approved prompt.

Independent evaluator.

Checks:

- reference/Blueprint fidelity;
- first viewport;
- regions;
- typography;
- imagery;
- composition;
- image subject;
- crop;
- negative space;
- AI artifacts;
- mobile visual identity;
- business truth;
- content.

No edits.

---

# 39. QA-B Browser + Technical v2

Use approved prompt.

Independent from QA-A.

Checks:

- page load;
- nav;
- mobile nav;
- responsive mechanics;
- keyboard;
- accessibility;
- Contact form;
- console;
- network;
- IMAGE_PLAN mappings;
- R2 assets;
- temporary KIE leakage;
- image loading;
- structured data;
- metadata;
- performance risks.

---

# 40. Technical Scanner

Before QA-B run deterministic checks.

Examples:

- unresolved IMG;
- title duplication;
- JSON-LD parse;
- image count;
- missing alt;
- temporary KIE URL;
- broken asset;
- horizontal overflow;
- console errors.

LLM should consume evidence, not redo trivial parsing.

---

# 41. Independent QA

QA-A and QA-B run separately.

Neither sees the other's report before completion.

Then both go to:

```text id="613cej"
Fix Coordinator v2
```

---

# 42. Fix Coordinator v2

Only main repair agent.

Use approved prompt.

Responsibilities:

- validate defects;
- deduplicate;
- root-cause;
- repair site;
- repair content;
- repair technical problems;
- decide image repair strategy.

---

# 43. Image Repair Types

Use:

```text id="c5mc0j"
CSS_FIX
ASSET_ROUTING_FIX
CONTENT_REMAP
IMAGE_REGENERATION
PROMPT_REPAIR_AND_REGENERATE
BLUEPRINT_REVIEW_REQUIRED
```

KIE regeneration is not the default.

---

# 44. KIE Regeneration

When required:

```text id="445hb1"
QA defect
↓
specific feedback
↓
KIE Image Prompt Generator
↓
KIE
↓
R2
↓
manifest
↓
reassemble
```

Never let Fix Coordinator bypass the Image Prompt Generator and improvise raw KIE prompts.

---

# 45. Confirmation

After Fix Coordinator:

```text id="brl7ox"
QA-A Confirmation v2
QA-B Confirmation v2
```

Both must pass.

---

# 46. Release Blocker Fix

If either confirmation fails:

run:

```text id="s0sp0w"
Release Blocker Fix v1
```

Only remaining P0/P1 defects.

Then rerun only necessary confirmation domain(s).

---

# 47. Hard Stop

If confirmation fails again:

```text id="96b8rm"
HUMAN_REVIEW_REQUIRED
```

No more automated repair cycles.

---

# 48. Human Approval

Automated PASS leads to existing human/customer approval.

Human can:

```text id="xjndqz"
APPROVE
REQUEST REVISION
```

Production publishing follows approval.

---

# 49. Revision Routing

Use selective reprocessing.

## Content

Reuse:

- reference analysis;
- Blueprint;
- unaffected imagery.

## Image

Reuse:

- site;
- Blueprint;
- Image Plan where appropriate.

Run KIE prompt/image flow only for changed slots.

## Brand

Update brand-adapted Blueprint/token values.

## Structural design

Update/rebuild Blueprint if necessary.

Do not blindly restart complete pipeline.

---

# 50. Workflow State

Final V2 states should contain no V1 terminology.

Example:

```ts id="tvkbol"
type BuilderStage =
  | "RECEIVED"
  | "NORMALIZING"
  | "REFERENCE_ACQUISITION"
  | "REFERENCE_ANALYSIS"
  | "BLUEPRINT_GENERATION"
  | "SITE_GENERATION"
  | "GENERATION_VALIDATION"
  | "IMAGE_PROMPTING"
  | "IMAGE_GENERATION"
  | "IMAGE_PERSISTENCE"
  | "SITE_ASSEMBLY"
  | "PREVIEW_DEPLOYMENT"
  | "QA_CAPTURE"
  | "QA_A"
  | "QA_B"
  | "FIX_COORDINATOR"
  | "CONFIRMATION_CAPTURE"
  | "QA_A_CONFIRMATION"
  | "QA_B_CONFIRMATION"
  | "RELEASE_BLOCKER_FIX"
  | "AUTOMATED_PASS"
  | "HUMAN_REVIEW_REQUIRED"
  | "AWAITING_APPROVAL"
  | "REVISION_REQUESTED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED";
```

---

# 51. Prompt Registry

Final V2 registry contains only V2 prompts:

```text id="uz21n3"
reference-analyzer-v2
visual-blueprint-v2
original-blueprint-v2
website-generator-v3
kie-image-prompt-v1
qa-a-v2
qa-b-v2
fix-coordinator-v2
qa-a-confirmation-v2
qa-b-confirmation-v2
release-blocker-fix-v1
```

Delete all superseded V1 prompt definitions before V2 release.

---

# 52. Prompt Versioning

```ts id="v02n0i"
const PROMPT_VERSIONS = {
  referenceAnalyzer: "2.0.0",
  visualBlueprint: "2.0.0",
  originalBlueprint: "2.0.0",
  websiteGenerator: "3.0.0",
  kieImagePrompt: "1.0.0",
  qaA: "2.0.0",
  qaB: "2.0.0",
  fixCoordinator: "2.0.0",
  qaAConfirmation: "2.0.0",
  qaBConfirmation: "2.0.0",
  releaseBlockerFix: "1.0.0"
};
```

These are product prompt versions, not indications that V1 code remains.

---

# 53. Shared Implementation Contract

Create one canonical:

```text id="bkx8z5"
prompts/shared/implementation-contract
```

or similar.

Use it for:

- Generator;
- QA-B;
- Fix Coordinator;
- confirmations.

Avoid duplicating technical requirements across prompt files.

---

# 54. Final Source Architecture

After V1 removal, target something similar to:

```text id="j2edyv"
src/
  builder/
    orchestration/
    intake/
    reference/
    blueprint/
    generation/
    images/
    qa/
    repair/
    artifacts/
    domain/
    telemetry/

  prompts/
    reference-analyzer.ts
    visual-blueprint.ts
    original-blueprint.ts
    website-generator.ts
    image-prompt.ts
    qa-a.ts
    qa-b.ts
    fix-coordinator.ts
    qa-a-confirmation.ts
    qa-b-confirmation.ts
    release-blocker-fix.ts
    shared/

  providers/
    ai/
    kie/
    browser/

  storage/
    d1/
    r2/

  deployment/

  approval/
```

Adapt to actual repo conventions.

The important point:

No:

```text id="p6tufm"
legacy/
v1/
old-generator/
```

in final V2 source.

---

# 55. Database Strategy

Because this is a fork, V2 does not need runtime compatibility with a V1 database unless deployment infrastructure explicitly shares the same production DB.

The coding agent must determine this during audit.

If V2 gets its own D1:

prefer a clean V2 schema.

If it must share an existing D1 during migration:

create migrations carefully, then consider fresh V2 DB before production cutover.

Preferred final production architecture:

```text id="zqqyuo"
V1 repo → V1 resources

V2 repo → V2 resources
```

where operationally practical.

Avoid unnecessary coupling.

---

# 56. V2 D1 Schema

Final V2 should represent current concepts clearly.

Likely entities:

```text id="tzm2a0"
builds
build_versions
agent_runs
image_generation_tasks
qa_runs
build_events
approvals
```

Do not retain obsolete V1 columns simply for historical compatibility if V2 uses its own DB.

---

# 57. R2

Likewise, decide whether:

- reuse existing bucket;
- create V2 prefix;
- create dedicated V2 bucket.

Dedicated V2 prefix/bucket is cleaner.

Example:

```text id="w032gk"
v2/builds/{buildId}/...
```

During final production cutover, choose permanent clean convention.

---

# 58. Artifact Storage

Recommended:

```text id="4skt75"
builds/{buildId}/

  intake/
  reference/
  blueprint/

  versions/
    1/
      generation/
      image-prompts/
      images/
      asset-manifest.json
      qa/

    2/
      ...

    3/
      ...

  final/
```

---

# 59. Idempotency

Use stable identities:

Agent:

```text id="xvsrcq"
buildId + stage + promptVersion + inputHash
```

Image:

```text id="6w4fg3"
buildId + version + slotId + attempt
```

Callback:

```text id="56fw1h"
providerTaskId
```

Deployment:

```text id="k6i64h"
buildId + version
```

---

# 60. Resume Safety

Workflow restart must not recreate completed expensive work.

Examples:

8/12 images completed:

reuse 8.

Blueprint completed:

reuse Blueprint.

QA-A completed:

do not rerun because QA-B failed.

---

# 61. Cost Controls

Track:

- agent cost;
- KIE cost;
- browser cost.

Operational limits:

```text id="kf0cn5"
MAX_IMAGES_PER_BUILD
MAX_KIE_ATTEMPTS_PER_SLOT
MAX_KIE_ATTEMPTS_PER_BUILD
```

Do not let cost constraints silently alter Blueprint.

---

# 62. Testing

## Unit

Test:

- intake normalization;
- schemas;
- generator parser;
- IMAGE_PLAN;
- KIE callback security;
- image manifest;
- metadata;
- Contact form.

## Integration

Mock complete V2 workflow.

Do not call paid KIE from standard CI.

## Browser

Test:

```text id="5mma3f"
1440
768
390
320
```

with:

- navigation;
- mobile menu;
- form;
- images;
- overflow;
- console.

---

# 63. Visual Fixtures

Maintain reference fixtures for:

- editorial/asymmetric;
- minimal;
- hospitality/image-rich;
- bold service;
- genuine card-heavy design.

V2 should not interpret "anti-generic" as "cards forbidden."

---

# 64. Image Fixtures

Test:

- text-safe negative space;
- right-third subject;
- portrait media;
- environmental wide shot;
- no-human scene;
- separate mobile variant.

---

# 65. QA Fixtures

Ensure QA-A catches:

- generic fallback;
- wrong hero mass;
- centered image where right-weighted required;
- poor negative space;
- inconsistent photography;
- AI artifacts.

Ensure QA-B catches:

- temporary KIE URL;
- missing R2 asset;
- unresolved IMG;
- broken nav;
- lazy hero;
- mobile variant not used.

---

# 66. Development Branch Strategy

Suggested:

```text id="kpzw2a"
main
```

always represents currently viable V2 fork state.

Feature branches:

```text id="jr9k7x"
v2/reference-pipeline
v2/blueprint
v2/generator
v2/images
v2/qa
v2/repair
v2/cleanup
```

Exact branch policy may follow existing team workflow.

---

# 67. Recommended PR Sequence

## PR 1 — V1 Fork Audit

No substantial behavior change.

Deliver:

- architecture audit;
- migration manifest;
- V1 deletion candidates.

## PR 2 — V2 Contracts

- schemas;
- build state;
- normalized intake;
- prompt registry;
- artifact store.

## PR 3 — Reference Pipeline

- acquisition;
- Analyzer.

## PR 4 — Blueprint

- Reference Blueprint;
- Original Blueprint.

## PR 5 — Website Generator v3

- new output;
- IMAGE_PLAN;
- validator.

## PR 6 — KIE Image Pipeline

- prompt generator;
- provider adapter reuse;
- task flow;
- R2;
- manifest.

## PR 7 — Preview + Browser Evidence

## PR 8 — QA-A / QA-B

## PR 9 — Fix Coordinator

## PR 10 — Confirmation + Release Blocker

## PR 11 — Approval/revision integration

## PR 12 — V1 Removal / Repository Cleanup

This final PR is mandatory.

---

# 68. V1 Removal PR

Create an explicit final cleanup PR.

Title concept:

```text id="x0obtu"
Remove superseded V1 pipeline and finalize V2 architecture
```

It should delete:

- old generator;
- old prompts;
- old QA;
- old image prompt path;
- unused sections/helpers;
- temporary compatibility flags;
- duplicate routes;
- obsolete test fixtures;
- dead env variables;
- unused dependencies.

---

# 69. Dependency Cleanup

After V1 deletion run:

```text id="5jc7rn"
package dependency audit
```

Remove packages only used by V1.

Also remove:

- unused Worker bindings;
- secrets;
- Wrangler vars;
- scripts;
- npm commands.

---

# 70. Environment Cleanup

Final V2 environment should not contain flags such as:

```text id="dtpojz"
USE_V1_GENERATOR
BUILDER_V2_ENABLED
LEGACY_IMAGE_MODE
OLD_QA_ENABLED
```

Those are migration scaffolding.

Delete them.

---

# 71. Route Cleanup

No permanent:

```text id="rrioyl"
/api/v1/generate
/api/v2/generate
```

if this product only exposes V2 after release and versioned API routing is not an intentional public API strategy.

Prefer canonical V2 route names.

Only keep versioned API paths when external backwards compatibility genuinely requires them.

---

# 72. Schema Cleanup

Before final V2 production database creation/migration:

review all fields.

Delete concepts such as:

```text id="eka6et"
legacy_generation_output
old_image_prompt
v1_review_status
```

if no current role exists.

---

# 73. Test Cleanup

Delete tests validating intentionally removed V1 behavior.

Do not retain:

```text id="oj03rp"
legacy generator should still...
```

in V2 repo.

Replace with V2 contract tests.

---

# 74. Documentation Cleanup

Final V2 README must describe V2 only.

Move historical migration docs to:

```text id="15gq9y"
docs/migration/
```

or delete them once no longer useful.

Main developer documentation should not force new engineers to understand V1.

---

# 75. Final Architecture Audit

Before release create:

```text id="0dddk3"
docs/architecture/v2-final-architecture.md
```

Document only the finished V2 system.

Then perform search for:

```text id="u9dfh4"
legacy
v1
oldGenerator
oldReview
deprecated
TODO remove after migration
```

Every hit must be reviewed.

---

# 76. Clean-Repo Acceptance Gate

V2 may not be declared complete until:

```text id="qvel3p"
No V1 generation path remains.
No V1 prompts remain.
No temporary dual-routing remains.
No legacy feature flags remain.
No obsolete image-generation path remains.
No old QA loop remains.
No dead compatibility code remains without documented reason.
```

---

# 77. Operational Separation

Ideally V1 and V2 deployments should be independently deployable.

For example:

```text id="jbz2pe"
V1 repo
→ V1 Worker/resources

V2 repo
→ V2 Worker/resources
```

during validation.

Do not make V2 development capable of accidentally breaking V1 production.

---

# 78. Cutover

Once V2 is production-ready:

1. freeze V2 release candidate;
2. run end-to-end regression set;
3. run multiple real-business builds;
4. verify KIE costs;
5. verify QA scoring;
6. verify approval flow;
7. verify domains/deployment;
8. make V2 production system;
9. retain V1 repo for rollback/reference;
10. do not retain V1 code inside V2.

---

# 79. Rollback

Because V1 remains a separate repository, rollback does not require V2 source to retain legacy code.

Operational rollback can redeploy V1 from its own repository if necessary.

This is a major advantage of the fork strategy.

It allows V2 to remain clean.

---

# 80. Definition of Done — Codebase

V2 is done when:

- V2 pipeline is sole generation pipeline;
- all V1 superseded code removed;
- no dual mode for V1/V2 remains;
- schemas describe V2 concepts;
- tests cover V2;
- README covers V2;
- dependencies are cleaned;
- deployment works standalone.

---

# 81. Definition of Done — Design

Reference mode:

- reference analyzed once;
- Blueprint generated;
- Generator implements Blueprint;
- QA-A visual score >=90.

Original mode:

- Blueprint is distinctive;
- no generic fallback;
- QA-A >=90 against generated Blueprint.

---

# 82. Definition of Done — Images

- Website Generator creates IMAGE_PLAN;
- KIE Prompt Generator creates final prompts;
- KIE runs after validation;
- prompts contain subject, shot, orientation, lighting, crop, human presence, background, colour, temperature, composition;
- accepted media persisted;
- final site uses no temporary KIE media;
- image QA exists.

---

# 83. Definition of Done — Technical

QA-B >=90.

No:

- P0;
- P1;
- broken core page;
- broken nav;
- broken mobile nav;
- critical image failure;
- unresolved IMG placeholder;
- temporary KIE release dependency;
- major accessibility blocker.

---

# 84. Definition of Done — Repair

Maximum automated mutation:

```text id="kvozwe"
Fix Coordinator
+
optional Release Blocker Fix
```

Then human escalation.

---

# 85. Definition of Done — Repository Cleanliness

Final V2 repo must be understandable without knowing V1.

A new developer should see:

```text id="4xs0ju"
one builder
one orchestration system
one image pipeline
one QA architecture
one release flow
```

not:

```text id="wbog6k"
old path
new path
compatibility path
temporary path
```

---

# 86. Final Coding-Agent Directive

You are implementing Website Builder V2 inside a fork of the existing V1 repository.

The V1 repository will remain separately available.

Therefore:

## During implementation

Reuse working V1 infrastructure aggressively.

It is acceptable to temporarily keep V1 code for:

- comparison;
- staged migration;
- keeping the fork operational.

## At completion

Remove all V1 functionality superseded by V2.

Do not preserve obsolete code for backwards compatibility.

The final repository must represent the V2 architecture directly and cleanly.

Use this conceptual migration:

```text id="e7f32v"
V1 FORK
│
├── proven infrastructure ───────────────┐
│                                        │
├── old generation intelligence ──X      │
├── old image prompts ─────────────X      │
├── old QA ────────────────────────X      │
│                                        │
└────────────────────────────────────────┤
                                         ▼
                               CLEAN V2 ARCHITECTURE
                                         │
                                         ├── Reference Analyzer
                                         ├── Blueprint
                                         ├── Website Generator
                                         ├── IMAGE_PLAN
                                         ├── KIE Prompt Generator
                                         ├── KIE/R2 Assets
                                         ├── QA-A
                                         ├── QA-B
                                         ├── Fix Coordinator
                                         ├── Confirmations
                                         ├── Release Blocker Fix
                                         └── Approval / Publish
```

The final guiding rule is:

> **Keep the proven platform code. Delete the superseded product logic.**

V1 remains safe in its own repository.

V2 should therefore be allowed to become genuinely clean.
