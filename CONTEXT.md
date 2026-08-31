# WAZIBIZ Website Builder V2 — Domain Glossary

This file defines the canonical domain vocabulary for Website Builder V2.

It is intentionally implementation-free. Architecture, storage, provider and runtime decisions belong in the PRD and ADRs, not here.

## Onboarding Submission

An **Onboarding Submission** is the immutable input package submitted through the website-generation onboarding form and is the authoritative starting point for a new Site Generation.

V2 has no Client Account or Client User concept.

_Avoid_: Client Account, Customer Account, User Profile.

## Site Generation

A **Site Generation** is a fresh design-origin attempt to produce the same intended Site from an Onboarding Submission. Changing the Reference or switching Build Mode starts a new Site Generation for that Site rather than a Revision Request.

Only one Site Generation ultimately supplies the accepted/published Site; abandoned generations may be physically cleaned up while their lightweight Build Records remain.

_Avoid_: a second Site, Revision when the design origin itself changes.

## Revision Request

A **Revision Request** is a human-requested change to an existing Site that preserves its Build Mode and Reference. It contains only the requested delta and starts a new Build derived from the previous Build's approved inputs.

A Revision Request does not require a new Onboarding Submission.

_Avoid_: treating a Revision Request as an automated Build Version or using it to replace the Reference/Build Mode.

## Business

A **Business** is the real business described by an Onboarding Submission and represented by the generated Site. Its factual identity is limited to what the Onboarding Submission supports.

_Avoid_: Client, Account, Customer when referring to the business represented by the Site.

## Business Fact

A **Business Fact** is a concrete claim about the Business that is directly supported by the Onboarding Submission. Missing facts must remain unknown rather than being invented.

Examples include prices, locations, certifications, awards, years of experience, service coverage and quantitative claims.

## Derived Content

**Derived Content** is non-factual marketing language created from the Onboarding Submission, such as headlines, section labels, positioning language, summaries, SEO copy and image concepts.

Derived Content may interpret or generalize safely, but it must never introduce unsupported Business Facts.

## Site

A **Site** is the single intended customer-facing four-page website for one Business and Onboarding Submission. Multiple Site Generations may attempt to produce it, but they do not create multiple Sites.

A Site has one current Published Version at most and may have multiple Builds during generation and revision.

_Avoid_: Site Generation, Build, Build Version, Deployment.

## Build

A **Build** is one end-to-end attempt to create or revise a Site from one fixed approved set of business, content and design inputs. A new human-requested content or creative change starts a new Build, even when derived from a previous Build.

_Avoid_: using Build for an automated repair revision.

## Build Version

A **Build Version** is an immutable candidate state within one Build, created only by the bounded automated generation/repair lifecycle. Human-requested creative or content changes do not create another Build Version; they start a new Build.

_Avoid_: Revision, iteration when referring to the canonical automated candidate states.

## Build Record

A **Build Record** is the compact retained history of a Build's outcome and diagnostic facts, including pass/fail state, QA outcome, failure cause and relevant cost/version provenance.

A Build Record may remain after superseded or failed generated artifacts and Deployments are removed.

_Avoid_: Deployment, Build Version.

## Deployment

A **Deployment** is a runnable instance of one exact Build Version. A Deployment may be a Preview or the Published Version; failed or superseded Deployments are disposable and should not be treated as permanent Build history.

_Avoid_: Build Record, Site.

## Preview

A **Preview** is the inspectable pre-publication Deployment of one exact Build Version used for automated QA and human review.

A Preview may be replaced or deleted when superseded; Approval promotes that same Build Version toward publication rather than regenerating it.

_Avoid_: Published Version, a regenerated copy of an approved Build Version.

## Published Version

A **Published Version** is the specific approved Build Version currently serving as the live Site.

Publishing a newer Build Version does not change the identity of the Site and must not regenerate the approved Build Version.

## Build Mode

A **Build Mode** is the design-origin strategy used for a Site Generation.

There are exactly two V2 modes:

- **REFERENCE_BOUND** — the Site's visual architecture is derived from an external Reference.
- **ORIGINAL_DESIGN** — the Site's visual architecture is created from Business, audience, brand and creative direction without a Reference.

Changing Build Mode starts a new Site Generation for the same Site.

## Reference

A **Reference** is an external website and/or supplied visual evidence used only to define the target visual architecture for a REFERENCE_BOUND Site Generation.

A Reference is a design source, not a source of Business Facts, copy, branding, trademarks or imagery. Replacing the Reference starts a new Site Generation for the same Site.

## Reference Suitability

**Reference Suitability** describes whether a Reference falls within the design-reproduction capability of V2.

Canonical outcomes:

- **SUPPORTED** — the target can be reproduced within normal V2 capabilities.
- **SUPPORTED_WITH_LIMITATIONS** — the target can be reproduced only with declared approximations.
- **UNSUPPORTED** — the target depends materially on capabilities outside V2's supported design envelope.

## Adaptation Contract

An **Adaptation Contract** is the explicit set of known approximations accepted for a SUPPORTED_WITH_LIMITATIONS Reference before generation begins.

QA evaluates the resulting Site against the Reference plus this declared contract, not against unsupported behavior that V2 already said it would not reproduce.

## Reference Evidence

**Reference Evidence** is the observed visual and behavioral evidence collected from a Reference before interpretation.

It may contain measurements, captures and observations, but it does not decide what the generated Site should do.

## Reference Analysis

A **Reference Analysis** is the structured interpretation of Reference Evidence that explains what makes the Reference visually and behaviorally distinctive.

It describes the Reference; it does not yet specify the new Site.

## Visual Blueprint

A **Visual Blueprint** is the binding design contract for a Build.

It defines the intended visual thesis, signature traits, composition, typography, spacing, surfaces, image system, motion language, responsive behavior and inner-page design vocabulary.

For REFERENCE_BOUND Builds, it translates the Reference Analysis into a design contract for the new Business. For ORIGINAL_DESIGN Builds, it is created directly from Business and creative inputs.

_Avoid_: Implementation Plan, generated source.

## Implementation Contract

An **Implementation Contract** is the agreed mapping from a Visual Blueprint and Business content into a coherent Site implementation plan.

It determines how the committed design and content are expressed across the four pages without changing the Visual Blueprint itself.

## Image Slot

An **Image Slot** is one planned visual role within a Site.

Each Image Slot has a semantic purpose and compositional role. A generated image is successful only if it fulfills that role, not merely because it is visually attractive.

## Accepted Image

An **Accepted Image** is the image currently selected to fulfill an Image Slot for a specific Build Version.

A later repair may produce a new image attempt without changing the identity or purpose of the Image Slot.

## Release Candidate

A **Release Candidate** is a Build Version that has completed generation and required preflight checks and is undergoing or has completed release QA.

A Release Candidate is not yet approved for publication.

## Release Blocker

A **Release Blocker** is a P0 or P1 defect that prevents a Release Candidate from being considered Release Ready.

Minor imperfections and optional polish are not Release Blockers.

## Release Ready

A Build Version is **Release Ready** when all automated release gates have passed and no Release Blocker remains.

Release Ready does not mean Published; human Approval is still required.

## Approval

**Approval** is the explicit human acceptance of one exact Release Ready Build Version for publication. Approval belongs only to that Build Version and never carries forward to another Build or superseded candidate.

A Revision Request after Approval creates a new Build that requires its own Approval before it can replace the Published Version.

_Avoid_: approving a Site generally or reusing Approval across Build Versions.

## Human Review Required

**HUMAN_REVIEW_REQUIRED** means the bounded automated process cannot safely resolve the remaining release issue without human judgment or intervention.

It is not equivalent to a normal technical failure and must not trigger an unbounded automatic retry loop.

## Degraded

A **Degraded** Build is one that completed enough processing to produce a usable preview or partial result, but did not satisfy the normal completion/release contract.

Degradation must always be explicit; it is never a silent success state.

## Benchmark Site

A **Benchmark Site** is one fixed reference-and-replacement-business test case in the REFERENCE_BOUND proof suite.

A Benchmark Site counts as PASS only when the automated pipeline reaches the agreed release gates without manual source-code edits and within the agreed image-generation spend limit.

## Benchmark Pass

A **Benchmark Pass** is a successful automated result for one Benchmark Site.

The REFERENCE_BOUND proof milestone is reached when at least 3 of the fixed 5 Benchmark Sites achieve Benchmark Pass.

## Design Archetype

A **Design Archetype** is non-binding inspiration vocabulary only.

It must never select, constrain or determine a Visual Blueprint based solely on industry/category.

## Form Submission

A **Form Submission** is a visitor's attempt to send the Site's contact form data to the Business.

A Form Submission is not successful merely because the browser accepted the click; it must be accepted by the platform's form-delivery process.

## Form Destination

A **Form Destination** is the Business-approved recipient for contact messages from a Site.

The visitor cannot choose or override the Form Destination.
