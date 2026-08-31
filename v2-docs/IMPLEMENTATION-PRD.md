# WAZIBIZ CF-Native Website Builder V2
## Fork-Based Implementation PRD, Architecture and AI Coding Agent Guide

**Source:** fork of the existing CF-native website builder  
**Target:** clean standalone V2 repository  
**Runtime:** Cloudflare-native  
**Images:** KIE.ai  
**Browser/reference/QA:** existing Cloudflare browser infrastructure / Browser Run  
**Strategy:** reuse proven infrastructure during construction; remove all superseded V1 product logic before V2 release.

---

## 1. Repository strategy

V1 remains preserved in its own repository. This fork becomes the future V2 product.

Development sequence:

```text
Fork V1
 -> audit
 -> identify reusable infrastructure
 -> build clean V2 pipeline
 -> validate side-by-side during development
 -> remove all superseded V1 code
 -> final V2 architecture audit
 -> V2 release
```

Temporary V1/V2 coexistence inside the fork is allowed only during implementation. The released V2 repository must not contain permanent legacy generator paths, old prompts, old QA loops, obsolete image prompting, compatibility flags or dead migration scaffolding.

Final rule:

> Keep the proven platform code. Delete the superseded product logic.

---

## 2. Reuse candidates

Audit before deciding, but strongly prefer reuse of working:

- Cloudflare Worker bootstrap and bindings;
- Wrangler/environment configuration;
- authentication and API/webhook routing;
- Cloudflare Workflows integration;
- D1/R2 utilities;
- AI Gateway/provider wrappers;
- KIE.ai client/auth/task plumbing;
- existing callback/polling helpers that remain sound;
- browser/screenshot utilities;
- preview/deployment/domain utilities;
- customer approval/revision flow;
- logging, validation and test utilities.

Do not rewrite low-level infrastructure simply because the generation pipeline is new.

---

## 3. Superseded V1 logic

Assume replacement of:

- legacy website-generation prompt;
- legacy reference/design interpretation;
- old generic layout rules;
- legacy image brief/prompt logic;
- old image-slot semantics;
- self-review or single-agent QA loops;
- legacy automatic repair loops;
- hard-coded section/hero/footer rules incompatible with Blueprint-driven generation;
- V1-only generation schemas and prompt registries.

At final cleanup, delete superseded implementations and their unused tests, dependencies, env vars and feature flags.

---

## 4. Product modes

### REFERENCE_BOUND

Inputs: normalized business intake, client brand/creative requirements, full-page reference screenshot and optionally live reference URL.

Goal: reproduce the reference design language as closely as practical while replacing all reference business content, branding and imagery.

The screenshot is primary for static homepage composition. The live URL supplements motion, interaction, responsive behavior and computed details.

### ORIGINAL_DESIGN

Inputs: normalized business intake, industry/category, audience, brand palette, visual style/design language/creative direction.

Goal: create a distinctive, non-generic site without requiring a reference.

Both modes converge on the same `VisualBlueprint` contract and then share the entire downstream implementation, image, QA, repair and release pipeline.

---

## 5. Core architecture

```text
CLIENT INTAKE
  -> NORMALIZE BUSINESS TRUTH
  -> SELECT MODE
       REFERENCE_BOUND:
         -> REFERENCE ACQUISITION
         -> REFERENCE ANALYZER v2
         -> VISUAL BLUEPRINT GENERATOR v2
       ORIGINAL_DESIGN:
         -> ORIGINAL-DESIGN BLUEPRINT GENERATOR v2
  -> VISUAL BLUEPRINT
  -> WEBSITE GENERATOR v3
  -> DETERMINISTIC VALIDATION
  -> IMAGE_PLAN
  -> KIE IMAGE PROMPT GENERATOR v1
  -> KIE IMAGE TASKS
  -> CALLBACK/COMPLETION
  -> PERSIST ACCEPTED MEDIA TO R2
  -> ASSET MANIFEST
  -> SITE ASSEMBLY
  -> PREVIEW DEPLOY
  -> BROWSER EVIDENCE
  -> QA-A v2 + QA-B v2 INDEPENDENTLY
  -> FIX COORDINATOR v2
  -> BUILD VERSION 2
  -> REDEPLOY/CAPTURE
  -> QA-A CONFIRMATION v2 + QA-B CONFIRMATION v2
  -> BOTH PASS ? HUMAN APPROVAL : OPTIONAL RELEASE BLOCKER FIX v1
  -> RERUN FAILED CONFIRMATION DOMAIN(S)
  -> PASS ? HUMAN APPROVAL : HUMAN_REVIEW_REQUIRED
```

---

## 6. Hard automation budget

Maximum autonomous mutation:

1. initial generation;
2. one Fix Coordinator batch;
3. at most one Release Blocker Fix batch.

No infinite QA/fix loop. If the final confirmation still fails, stop automated mutation and require human review.

---

## 7. Mandatory brownfield audit

Before implementation, create:

- `docs/architecture/v1-fork-audit.md`
- `docs/architecture/v2-migration-manifest.md`

Inspect:

- Worker entrypoints/routes/bindings;
- Workflow classes and current orchestration;
- current AI/model calls and parsers;
- current reference screenshot/URL/browser logic;
- KIE.ai client, models, retries, callbacks/polling, persistence;
- D1/R2/KV/DO usage;
- site assembly and preview deployment;
- customer approval/revision handling;
- security, logging and observability.

Classify each relevant V1 component:

`KEEP | KEEP_AND_RENAME | EXTEND | REFACTOR | REPLACE | DELETE_BEFORE_V2_RELEASE`

The migration manifest must map V1 component -> decision -> V2 owner -> whether V1 code is removed.

---

## 8. Target source boundaries

During development `builder-v2/` or temporary `legacy/` namespaces are acceptable. Before release, rename/move V2 into the canonical architecture and delete V1-only paths.

Conceptual final structure:

```text
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

No permanent `legacy/`, `v1/` or old-generator trees in the released V2 source.

---

## 9. Canonical normalized intake

Normalize onboarding exactly once. Include:

- business name/category/description/audience;
- services;
- location model: storefront/service-area/hybrid/appointment-only/unknown;
- public address and service areas;
- phone/email/opening hours;
- primary action;
- social URLs;
- brand primary/secondary/accent colors;
- visual style/design language/creative direction.

Every prompt agent consumes normalized data instead of raw form IDs.

---

## 10. Reference acquisition

Store the supplied screenshot unchanged. Validate reference URLs against SSRF/private-network risks and every redirect.

Recommended evidence widths: 1440, 768, 390. Use 1920/320 only where useful.

The reference package may include screenshots, rendered HTML/accessibility evidence and interaction/responsive evidence. Do not forward unnecessary reference business copy downstream.

---

## 11. Reference Analyzer v2

Forensic observation only. It outputs structured design evidence including geometry, silhouette, grid, header, hero/first viewport, region map, typography, color, surfaces, components, photographic grammar, image inventory, motion, responsive behavior and uncertainties.

Persist as an immutable build artifact and validate against schema.

---

## 12. Blueprint generation

Reference mode uses `ReferenceAnalysis -> Visual Blueprint Generator v2`.

Original mode uses normalized intake/brand/creative direction -> `Original-Design Blueprint Generator v2`.

Both output the same core `VisualBlueprint` schema.

The Blueprint is the binding downstream design contract. The Website Generator must not reanalyze the reference or redesign independently.

---

## 13. Website Generator v3

Owns:

- factual client copy;
- semantic content mapping;
- Blueprint implementation;
- HTML/CSS/JS;
- per-page metadata;
- structured IMAGE_PLAN.

It does not create final KIE prompts.

Required output blocks:

```text
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

Images use placeholders such as:

```html
<img src="IMG:home-hero-primary" alt="..." data-image-id="home-hero-primary">
```

---

## 14. IMAGE_PLAN

Each image slot defines:

- page/region/semantic role/Blueprint role;
- FIXED/OPTIONAL/REPEATABLE;
- CRITICAL/HIGH/NORMAL priority;
- subject;
- shot type;
- orientation/aspect ratio;
- camera angle/distance;
- lighting source/direction/softness/contrast/time character;
- desktop/intermediate/mobile crop;
- human requirement/count/activity/gaze/interaction/pose;
- background environment/complexity/sharpness/purpose;
- color saturation/contrast/dominant character/brand relationship;
- temperature;
- composition: subject position, balance, negative space, text-safe area, focal priority, foreground/midground/background, depth, visual weight;
- depth of field;
- realism/tone/design role;
- mobile crop/focal/placement behavior;
- avoid constraints.

---

## 15. Deterministic validation

Before KIE spend, validate with code:

- all required output blocks;
- IMAGE_PLAN valid JSON/schema;
- four pages and meaningful H1s;
- navigation and contact-form contract;
- JSON-LD parses;
- all `IMG:*` IDs unique and mapped;
- no orphan image-plan item;
- FIXED roles implemented;
- minimum three meaningful images/page;
- aspect/composition information exists.

Allow at most one targeted LLM repair for contract/schema failure.

---

## 16. KIE Image Prompt Generator v1

Runs per image slot. Input:

`business truth + Blueprint photography grammar + one IMAGE_PLAN item + KIE model/capabilities`

Output provider-ready positive prompt, negative prompt where supported, resolved aspect ratio/provider parameters, resolved photographic brief and optional separate-mobile-variant recommendation.

It must preserve slot subject/composition instead of redesigning it.

---

## 17. Reuse KIE provider infrastructure

If existing KIE low-level HTTP/auth/task code is reliable, reuse it behind a V2 domain adapter. Do not spread provider JSON throughout orchestration.

The new architecture changes what is sent to KIE and when, not necessarily the proven HTTP client itself.

Generation occurs after Website Generator + deterministic validation + image prompt generation, and before visual QA.

Fan out tasks within configured concurrency, prioritizing CRITICAL homepage imagery.

---

## 18. KIE callbacks and persistence

Prefer callback/event completion over continuous polling where the existing integration permits a clean migration.

Webhook handling must verify the configured KIE signature/HMAC contract, validate timestamp freshness, use constant-time comparison, be idempotent by provider task ID, persist normalized completion state and signal the Workflow quickly. Heavy work belongs after the webhook response.

Accepted generated media must be copied promptly into project-controlled persistent R2 storage. Final sites must never depend on temporary provider URLs.

---

## 19. Image generation records and asset manifest

Persist task attempts by build/version/slot. Record provider/model/task ID/status/prompt artifact/provider result/persistent asset/error/timestamps.

Create one canonical asset manifest mapping each slot to its accepted generation and persistent URL, dimensions and optional mobile variant.

Site assembly resolves `IMG:id` only from this manifest.

QA cannot begin until every required critical image is persisted or the build is explicitly blocked.

Suggested maximum generation attempts per slot: configurable, initially 2.

---

## 20. Site assembly and preview

Inject page-specific metadata into the shared head contract, resolve image placeholders through the manifest, add `<picture>` art direction only where required, and use the existing preview/deployment infrastructure where sound.

Keep immutable build versions:

- v1 initial generation;
- v2 Fix Coordinator;
- v3 Release Blocker Fix.

---

## 21. Browser evidence

Capture the site only after real KIE/R2 assets are assembled and previewed.

At minimum homepage desktop/intermediate/mobile evidence; capture inner pages as needed. Reuse identical screenshot evidence between QA agents where possible.

A deterministic technical scanner should produce machine evidence for mechanical checks before QA-B.

---

## 22. QA-A v2

Independent visual/content evaluator. It checks Blueprint/reference fidelity, macro composition, first viewport, signature traits, region geometry, typography, color/surface, imagery, subject/shot/composition/negative space/crop/mobile crop/AI artifacts, mobile visual identity and factual business content.

It does not edit.

Pass requires visual >=90, content >=90, no P0/P1, no fabrication and no unusable critical image.

---

## 23. QA-B v2

Independent browser/technical evaluator. It checks actual pages, navigation/mobile nav, responsive mechanics, overflow, keyboard/focus/form/accessibility, runtime/network, IMAGE_PLAN-to-HTML mapping, R2 persistence, broken/temporary image URLs, image loading/layout stability/art direction, metadata/JSON-LD/crawlability and implementation-contract compliance.

It does not inspect QA-A first and does not edit.

Pass requires technical >=90, no P0/P1 and all critical technical gates.

---

## 24. Fix Coordinator v2

The only main QA-stage mutator. It receives both independent QA reports, validates P0/P1 findings, deduplicates root causes and repairs the narrowest correct layer.

Priority: P0 -> fabrication/business facts -> macro visual P1 -> critical image P1 -> responsive/accessibility/function -> content -> systemic P2 -> local P2.

Image decisions must explicitly be one of:

`CSS_FIX | ASSET_ROUTING_FIX | CONTENT_REMAP | IMAGE_REGENERATION | PROMPT_REPAIR_AND_REGENERATE | BLUEPRINT_REVIEW_REQUIRED | NO_ACTION`

Do not regenerate when CSS/routing can solve the problem. Regenerate only affected slots, route all new KIE prompts through the Image Prompt Generator, persist new assets and update the manifest.

Create build version 2 and run only short sanity checks before confirmation QA.

---

## 25. Confirmation QA

QA-A Confirmation v2 and QA-B Confirmation v2 are narrow release checks, not fresh audits.

They recheck previous release blockers, areas deliberately changed by the Fix Coordinator, regenerated/repaired image slots and new P0/P1 regressions only. They must not reopen a P2/P3 polish backlog.

Both must pass for automated release readiness.

---

## 26. Release Blocker Fix v1

Invoke only if a confirmation still fails. It may change only the remaining P0/P1 blockers. No P2/P3 improvements or broad refactors.

After it creates build version 3, rerun only the failed confirmation domain(s), unless the repair plausibly affects the previously passing domain.

If confirmation fails again: `HUMAN_REVIEW_REQUIRED`. No third automated repair.

---

## 27. Human approval and revision

Automated PASS enters the existing approval flow. A human may approve or request revision.

Classify revisions as CONTENT, VISUAL, IMAGE, BRAND or FUNCTIONAL and selectively replay only the necessary stages. Do not restart Reference Analyzer/Blueprint/KIE unnecessarily.

---

## 28. Prompt registry and schemas

Version all prompts centrally. Initial canonical versions:

- Reference Analyzer 2.0.0
- Visual Blueprint Generator 2.0.0
- Original-Design Blueprint Generator 2.0.0
- Website Generator 3.0.0
- KIE Image Prompt Generator 1.0.0
- QA-A 2.0.0
- QA-B 2.0.0
- Fix Coordinator 2.0.0
- QA-A Confirmation 2.0.0
- QA-B Confirmation 2.0.0
- Release Blocker Fix 1.0.0

Use runtime schemas for every structured agent result. If the repo has no good schema library, add Zod. Allow at most one targeted format repair for malformed AI JSON.

Create one shared implementation-contract module for Generator/QA-B/Fix/Confirmation instead of maintaining divergent copies.

---

## 29. Workflow state and resumability

Persist a canonical build stage/state. Stages should represent V2 concepts only in the final repo: intake, reference acquisition/analysis, Blueprint, site generation/validation, image prompting/generation/persistence, assembly, preview, QA-A, QA-B, fix, confirmations, blocker fix, automated pass, human review/approval, publish and failed.

Every expensive operation requires stable idempotency keys. Workflow restart must reuse completed artifacts: do not rerun a Blueprint, completed images or completed QA unnecessarily.

---

## 30. Storage

D1 should hold searchable operational state; large prompt/output/evidence artifacts can live in R2.

Likely operational entities:

- builds;
- build_versions;
- agent_runs;
- image_generation_tasks;
- qa_runs;
- build_events;
- approvals.

Prefer V2-specific Cloudflare resources or clean V2 prefixes where operationally practical so V1 production cannot be accidentally affected.

---

## 31. Security

Reference URLs are untrusted. Block localhost, loopback, RFC1918/private/link-local/internal metadata addresses and redirect chains into private networks. Limit scheme, timeout and response size.

Reference-site content must be treated as untrusted design evidence and must not become instructions to the generator.

KIE webhooks must be authenticated and idempotent. Secrets remain Worker secrets. Final media URLs must not expose provider/API/internal tokens.

---

## 32. Copyright/reference separation

Reference inputs control design relationships, not reference copy, logos, people or copyrighted imagery. Generated content must use client facts. KIE imagery should reproduce the compositional function/photographic grammar, not duplicate the reference photograph.

---

## 33. Accessibility, SEO and performance contract

Require semantic HTML, one meaningful H1/page, labeled forms, visible focus, keyboard navigation, sufficient contrast, useful alt text, reduced-motion behavior and practical touch targets.

Require unique page titles/descriptions, factual homepage JSON-LD and correct canonical/OG behavior only when real URLs/assets are known. Never invent ratings, reviews, coordinates, years, opening hours or price ranges.

Architecture should target good Core Web Vitals. Likely LCP imagery must not be lazy-loaded; below-fold images should normally lazy/decode async; reserve image geometry to prevent CLS.

---

## 34. Deterministic vs AI responsibility

Use code for parsing/schema/link/meta/image mapping/placeholder detection/form structure/network/console/overflow measurements.

Use AI for design understanding, Blueprint creation, content mapping, image art direction, visual judgment and repair reasoning.

Do not spend LLM tokens on checks a parser/browser can establish deterministically.

---

## 35. Testing

Required unit coverage: intake normalization, prompt output schemas, generator parser, IMAGE_PLAN validation, KIE webhook validation/idempotency, asset manifest replacement, metadata, form contract.

Integration tests should mock the complete V2 pipeline. Standard CI must not call paid KIE.

Workflow-resume tests should simulate failure after Blueprint, partial images, QA-A, Fix Coordinator and publish.

Browser tests at representative 1440/768/390/320 widths should cover navigation/mobile nav, form, keyboard, overflow, images, dynamic year and console.

Maintain design fixtures for asymmetric/editorial, minimal, hospitality/image-heavy, bold service and genuine card-driven references. Also maintain deliberately generic fallback output so QA-A scoring can be regression-tested.

---

## 36. Observability and cost

Track per build:

- stage transitions;
- prompt/model/version;
- latency/token/cost where available;
- Browser Run use;
- KIE task/attempt/cost;
- first-pass and post-fix QA scores;
- release-blocker invocation;
- human revision/escalation.

High Release Blocker Fix frequency is a signal to improve upstream Analyzer/Blueprint/Generator/Image Prompt logic, not to increase loop count.

---

## 37. Implementation milestones

### M0 — Audit
Create fork audit and migration manifest. No product behavior change.

### M1 — V2 domain contracts
Normalized intake, build context/state, schemas, prompt registry/versioning, artifact paths/store, shared implementation contract.

### M2 — Reference pipeline
Secure acquisition, browser evidence, Reference Analyzer v2, artifact persistence.

### M3 — Blueprint pipeline
Reference Blueprint + Original Blueprint, shared schema and mode routing.

### M4 — Website Generator v3
New prompt/parser/IMAGE_PLAN, deterministic validator, one targeted repair.

### M5 — Image prompt layer
KIE Image Prompt Generator, model-capability mapping, prompt artifacts.

### M6 — KIE V2 orchestration
Reuse/refactor provider client, fan-out, callback/event handling, retries, R2 persistence, manifest and assembly.

### M7 — Preview/browser evidence
V2 preview deployment, screenshot/evidence helpers and deterministic technical scanner.

### M8 — Dual QA
QA-A and QA-B independently, structured reports and scoring. Initially no automated repair.

### M9 — Fix Coordinator
Bounded mutation, root-cause repairs, image regeneration routing and build v2.

### M10 — Confirmations and Release Blocker
Narrow confirmation stages, build v3, selective rerun and hard human-review stop.

### M11 — Approval/revision integration
Connect V2 automated pass to existing human approval and selective replay.

### M12 — Mandatory V1 removal/cleanup
Delete superseded V1 generation/product logic, old prompts, old QA, feature flags, dead dependencies/env vars/routes/tests. Rename/move V2 into canonical final structure.

### M13 — Final architecture audit and release
Create `docs/architecture/v2-final-architecture.md`; search all legacy/v1/deprecated/TODO migration markers; resolve every hit; run complete regression/release suite.

---

## 38. Suggested PR sequence

1. fork audit + migration manifest + schemas
2. reference acquisition + Reference Analyzer
3. Blueprint generators
4. Website Generator v3
5. image prompt + KIE V2 orchestration
6. asset assembly + preview evidence
7. QA-A + QA-B
8. Fix Coordinator
9. confirmations + Release Blocker Fix
10. approval/revision integration
11. remove superseded V1 pipeline and temporary compatibility scaffolding
12. final V2 architecture/cleanup/release validation

Avoid one giant rewrite PR.

---

## 39. Clean-repo acceptance gate

V2 is not complete until:

- V2 is the sole generation pipeline;
- no V1 generation path remains;
- no superseded V1 prompts remain;
- no old QA/fix loop remains;
- no temporary dual-routing/legacy feature flags remain;
- no obsolete image-generation path remains;
- no dead compatibility code remains without explicit current purpose;
- dependencies, Worker bindings, secrets, scripts and tests are cleaned;
- README/developer docs describe V2 directly;
- a new developer can understand V2 without learning V1 first.

V1 remains available in its separate repository for rollback/history, so V2 does not need to preserve obsolete compatibility internally.

---

## 40. Final coding-agent directive

Do not rebuild the Cloudflare application from scratch.

First understand the fork. Reuse proven platform infrastructure. Build the new intelligence as clearly separated stages. During development, temporary V1 comparison paths are permitted. Before V2 release, remove every superseded V1 product path and migration-only compatibility layer.

The permanent product boundary is:

```text
BUSINESS / REFERENCE EVIDENCE
 -> DESIGN UNDERSTANDING
 -> DESIGN CONTRACT
 -> WEBSITE IMPLEMENTATION
 -> IMAGE ART DIRECTION
 -> REAL GENERATED MEDIA
 -> INDEPENDENT VISUAL + TECHNICAL REVIEW
 -> CONTROLLED ROOT-CAUSE REPAIR
 -> CONFIRMATION
 -> HUMAN APPROVAL
```

Do not let V2 collapse back into one mega-agent.
