# WAZIBIZ Website Builder V2 — Capability Envelope

**Status:** FINAL / APPROVED  
**Purpose:** Define what V2 supports, approximates and rejects so Reference Suitability, Implementation Contract, QA and benchmark execution share one product boundary. Domain terms use `../CONTEXT.md` exactly.

## Supported core product

- One stable Site per Business, generated as exactly four pages: Home, About, Services, Contact.
- Every new Site Generation begins from one immutable Onboarding Submission.
- No Client Account, Client User, CMS or mutable client-profile domain.
- Normal later Business/content changes that preserve Reference and Build Mode use Revision Request -> new Build.
- Static/framework-light output using semantic HTML, shared CSS and minimal JavaScript.
- Cloudflare-native build, Preview, artifact, Publication and Deployment lifecycle.
- `REFERENCE_BOUND` first; `ORIGINAL_DESIGN` after the 3/5 benchmark proof milestone.
- Real Contact form delivery through the central WAZIBIZ Form Service and Cloudflare-native outbound email.
- KIE-generated imagery with a normal target of 12 Accepted Images per completed Site.
- Hard KIE image-generation spend ceiling: USD 3.00 per completed Site.

## Reference-bound fidelity

`REFERENCE_BOUND` reproduces visual architecture rather than merely mood. Supported targets include section/region order and proportions, first-viewport topology, dominant text/image mass, grid/container relationships, whitespace rhythm, surface sequence, component geometry, typography character using legal fonts/substitutes, image roles/crop logic, responsive transformations and ordinary interaction/motion.

The Reference Screenshot is authoritative for static composition. The Reference URL supplements behavioral, responsive and computed/runtime evidence.

Reference content, logo, branding, trademarks, proprietary graphics, photography, font files and source implementation are never reused as Business content/assets.

## Supported motion and interaction

Supported when practical with native CSS/JS or approved lightweight dependencies:

- hover/focus/active transitions;
- menu transitions;
- scroll reveals;
- sticky/fixed behavior;
- simple parallax;
- modest scroll-linked effects;
- lightweight sliders/carousels when the Reference genuinely requires them;
- ordinary responsive state transitions.

## Supported with limitations

`SUPPORTED_WITH_LIMITATIONS` is allowed only when core visual identity remains intact and every approximation is declared before generation in an Adaptation Contract. Examples include isolated WebGL flourish -> static/CSS equivalent, proprietary font -> declared legal substitute, inaccessible interaction -> accessible equivalent, or non-essential video treatment -> bounded still/image approximation.

QA judges against Reference + Adaptation Contract. The contract cannot legalize removal of an identity-defining unsupported feature.

## Unsupported

Normally classify `UNSUPPORTED` when visual identity fundamentally depends on:

- WebGL/Three.js/canvas as the primary experience;
- physics-heavy interaction;
- complex specialized scroll choreography;
- authenticated/application-grade UI;
- product configurators or rich state machines;
- unavoidable dominant video where approximation destroys identity;
- huge ecommerce/catalog architecture;
- CMS/blog as a core dependency;
- arbitrary page-count requirements.

## Generated-site technical constraints

Default output:

- `index.html`, `about.html`, `services.html`, `contact.html`;
- one shared `site.css`;
- one shared `site.js`;
- `assets/` + manifest;
- semantic HTML;
- small Site-specific token/component layer;
- no React/Tailwind/GSAP or comparable large framework by default;
- crawlable links and minimal JavaScript;
- no proprietary Reference implementation copying.

The platform standardizes technical interfaces, not page composition. Reference-specific grids, overlaps, clipping, wrappers and custom CSS remain allowed.

## Design authority

Design Archetypes are non-binding inspiration vocabulary only. `ORIGINAL_DESIGN` must derive from Business Facts, audience, offer/service model, physical/service environment, brand, conversion goal, explicit creative direction and design reasoning. Industry must never deterministically choose a layout/style.

## Accessibility

Reference fidelity does not justify reproducing clear accessibility failures. V2 may adapt insufficient contrast, missing focus, undersized touch targets, hover-only critical functionality and motion incompatible with reduced-motion preferences. Such differences are recorded in the Visual Blueprint or Adaptation Contract.

## Images

Normal target: 12 Accepted Images per four-page Site.

Generation:

1. Wave 1: CRITICAL + HIGH homepage Image Slots.
2. Wave 2: remaining NORMAL/supporting Image Slots.

Rules:

- preserve 20–25% repair reserve where practical;
- CSS crop/object-position, asset routing and remapping before regeneration;
- mobile-specific variant only when one master cannot satisfy composition;
- every Image Attempt remains tied to one Image Slot;
- no temporary provider URL in Release Ready output;
- Accepted Images persist to project-controlled storage;
- images may not imply unsupported Business Facts.

## Automated Repair boundary

Automated Repair may fix implementation, CSS, content mapping, asset selection and other realization details only within fixed Business inputs, Visual Blueprint and Implementation Contract. A material repair creates a new Build Version. It may not change Business Facts, Reference, Build Mode or Visual Blueprint.

A Blueprint-level root defect emits `BLUEPRINT_REVIEW_REQUIRED` and proceeds to human review rather than silent redesign.

## Contact form capability

Every generated Contact form uses the central WAZIBIZ Form Service.

Generated Site responsibilities:

- semantic form UI;
- public Site/form identifier;
- Turnstile client integration where configured;
- pending/success/error UX;
- no recipient/sender/template/credential control in browser payload.

Platform responsibilities:

- allowed-origin validation;
- server-side field/schema/length validation;
- Turnstile verification;
- rate limiting/abuse controls;
- Accepted Submission persistence sufficient for reliable processing;
- current Site Configuration resolution;
- Form Destination resolution;
- verified Sender Identity resolution;
- Cloudflare-native Email Delivery;
- visitor address as validated Reply-To, never transactional From;
- bounded retry for transient Email Delivery failure;
- explicit permanent delivery-failure recording;
- minimal/configurable message retention.

V2 defaults to a verified WAZIBIZ platform Sender Identity. A Business-owned sender domain may be added later only after verification and remains mutable Site Configuration.

## SEO capability

V2 guarantees foundations only: unique titles/meta descriptions, canonical when known, semantic headings, crawlable anchors, truthful JSON-LD, suitable Open Graph metadata and correct alt semantics. Full SEO strategy, keyword research, ongoing content, blog/CMS, link building and campaign work are separate.

## Release capability

Release Ready is an automated quality state for one exact Build Version. Human Approval is mandatory before Publication, but Approval itself does not make the Site live. Publication deploys the exact approved Build Version without regeneration and may be retried after operational failure while that version remains unchanged.

The immediately previous Published Version may be retained temporarily as Rollback Version. Rollback restores that exact Build Version and does not roll back mutable Site Configuration unless explicitly requested.

## Proof milestone

`REFERENCE_BOUND` is sufficiently proven to begin `ORIGINAL_DESIGN` after at least 3 of the fixed 5 Benchmark Sites achieve Benchmark Pass:

- exact candidate reaches Release Ready automatically;
- zero manual source-code edits;
- QA-A visual >=90 and content >=90;
- all hard composition gates pass;
- QA-B >=90;
- P0/P1 = 0;
- no fabrication;
- bounded Automated Repair only;
- KIE <= USD 3.00/Site;
- valid four-page output;
- working form capability where exercised.

Human Approval and Publication are not required for Benchmark Pass.
