# WAZIBIZ Website Builder V2 — Capability Envelope

**Status:** FINAL / APPROVED  
**Purpose:** Define what V2 supports, what it approximates, and what it rejects so the Suitability Gate, Implementation Planner, QA and benchmark runner share one product boundary.

## Supported core product

- Four-page local-business websites: Home, About, Services, Contact.
- Framework-light/static output using semantic HTML, shared CSS, and minimal JavaScript.
- Cloudflare-native build, preview, artifact and deployment workflow.
- REFERENCE_BOUND mode first; ORIGINAL_DESIGN is implemented after the reference proof milestone.
- Real Contact form delivery through the centralized WAZIBIZ Form Service using Cloudflare-native outbound email.
- Generated site imagery via KIE.ai, with a normal target of 12 accepted images per completed site.
- Hard KIE spend ceiling: USD 3.00 per completed site.

## Reference-bound fidelity target

REFERENCE_BOUND reproduces visual architecture, not merely mood. Supported targets include:

- section/region order and proportions;
- first-viewport structure;
- dominant text/image mass;
- grid/container relationships;
- whitespace rhythm;
- surface/light-dark sequence;
- component geometry;
- typography character using legal/available fonts or declared substitutes;
- image role, mass and crop logic using new business-appropriate imagery;
- responsive transformations;
- ordinary interaction and motion behavior.

The supplied full-page screenshot controls static homepage composition. The live URL supplements computed/interactive/responsive evidence.

## Supported motion / interaction

Supported when practical with native CSS/JS or approved lightweight dependencies:

- hover/focus/active transitions;
- menu transitions;
- scroll reveals;
- sticky/fixed UI behavior;
- simple parallax;
- modest scroll-linked effects;
- lightweight sliders/carousels where the reference genuinely requires them;
- ordinary responsive state transitions.

## Supported with limitations

A reference may be classified `SUPPORTED_WITH_LIMITATIONS` when most visual identity can be preserved while a bounded unsupported behavior is approximated.

The limitation must be declared before generation in an adaptation contract. Examples:

- one isolated WebGL flourish replaced with static/CSS behavior;
- proprietary font replaced by a declared legal substitute;
- inaccessible reference interaction adapted to an accessible equivalent;
- unsupported video-heavy treatment approximated by a still/image sequence when video is not the core identity.

QA evaluates against the declared adaptation contract rather than silently moving the goalposts.

## Unsupported / reject in V2

Normally classify `UNSUPPORTED` when the site’s identity fundamentally depends on:

- WebGL/Three.js/canvas rendering as the primary experience;
- physics-heavy interactions;
- complex scroll choreography that cannot be represented without a specialized runtime;
- authenticated/application-grade UI rather than a marketing website;
- product configurators or rich application state machines;
- video as the dominant unavoidable design medium when no bounded approximation preserves the design;
- huge ecommerce/catalog architecture outside the four-page local-business product;
- CMS/blog requirements as a core dependency;
- arbitrary page-count requirements.

## Generated-site technical constraints

Default output:

- semantic static HTML;
- one shared `site.css`;
- one shared `site.js`;
- small site-specific token/component layer;
- no React/Tailwind/GSAP or comparable large framework by default;
- approved lightweight dependencies only when a specific requirement justifies them;
- no JS-only crawlable navigation;
- no proprietary reference code copying.

The platform standardizes technical interfaces, not page composition. Unique reference-specific grids, overlaps, clipping, wrappers and CSS are allowed.

## Design authority constraints

Industry archetypes do **not** choose the design.

Original design direction must derive from:

- business facts;
- audience;
- offer/service model;
- physical/service environment;
- brand requirements;
- conversion goal;
- client creative direction;
- professional design reasoning.

Any retained archetype file is inspiration vocabulary only.

## Accessibility adaptation

Exact reference fidelity does not justify reproducing clearly inaccessible behavior.

V2 may adapt:

- insufficient contrast;
- missing focus indicators;
- materially undersized touch targets;
- hover-only critical interaction;
- motion incompatible with `prefers-reduced-motion`.

The adaptation must preserve design character and be recorded.

## Brand and IP boundary

Never reuse from a reference:

- logo;
- trademark;
- proprietary graphics;
- copyrighted photography;
- proprietary font files;
- source HTML/CSS/JS implementation wholesale.

The system may measure visual roles, geometry, computed styles and behavior and then recreate the visual architecture independently.

Client brand colors override reference brand identity while preserving reference color roles/distribution where relevant.

## Images

Normal target: 12 accepted images per four-page site.

Generation occurs in two waves:

1. CRITICAL/HIGH homepage imagery.
2. NORMAL/supporting imagery.

Requirements:

- preserve repair reserve inside USD 3.00 hard cap;
- CSS crop/remapping/routing before regeneration;
- mobile-specific variant only when one master cannot satisfy required composition;
- never ship temporary provider URLs;
- accepted final assets are persisted to project-controlled storage;
- no unsupported business claims may be implied visually.

## Contact form capability

Every generated Contact form is backed by the central WAZIBIZ Form Service.

Generated site responsibilities:

- semantic form UI;
- public site/form identifier;
- Turnstile client integration where configured;
- pending/success/error UX;
- no recipient/sender control in browser payload;
- no email/service credentials.

Platform form service responsibilities:

- allowed-origin validation;
- field/schema/length validation;
- Turnstile verification;
- rate limiting/abuse controls;
- `site_id -> SiteFormConfig` resolution;
- approved sender and destination resolution;
- Cloudflare-native outbound email submission;
- visitor address used as Reply-To rather than arbitrary From;
- minimal delivery/audit metadata;
- bounded retry for transient delivery errors.

Visitor autoresponder is off by default in V2.

## SEO capability

V2 guarantees technical/on-page foundations only:

- unique titles;
- unique meta descriptions;
- canonical when final URL is known;
- semantic heading structure;
- crawlable anchors;
- truthful JSON-LD;
- suitable Open Graph metadata;
- correct alt semantics.

Full SEO strategy, keyword research, ongoing content, blog/CMS, link building or campaign work are separate capabilities.

## Human approval

Automated QA can declare a build release-ready, but production publication remains human-approved in V2.

Approval must identify an immutable build version; later revisions require a new approval.

## Proof milestone

REFERENCE_BOUND is sufficiently proven to begin ORIGINAL_DESIGN after a fixed five-site benchmark achieves at least 3/5 automated passes with:

- zero manual source-code edits;
- QA-A >= 90 plus hard composition gates;
- QA-B >= 90 and no P0/P1;
- bounded automated repair only;
- KIE <= USD 3.00/site;
- valid four-page output and working form capability where exercised.
