# WAZIBIZ Website Builder V2 — Domain Glossary

This file defines the canonical domain vocabulary for Website Builder V2.

It is intentionally implementation-free. Architecture, storage, provider and runtime decisions belong in the PRD and ADRs, not here.

## Onboarding Submission

An **Onboarding Submission** is the immutable input package and fact snapshot submitted through the website-generation onboarding form for one Site Generation. It records what is known or declared about the Business for that generation and is never rewritten when later facts change.

A Site may have multiple Onboarding Submissions over time when replacement Site Generations are started. Later submissions may supersede earlier facts for future generations without changing the historical inputs that governed earlier Builds. V2 has no Client Account or Client User concept.

_Avoid_: Client Account, Customer Account, User Profile, mutable Business profile.

## Site Generation

A **Site Generation** is a fresh design-origin attempt to produce the same intended Site from one immutable Onboarding Submission. Changing the Reference or switching Build Mode starts a new Site Generation for that Site rather than a Revision Request, and that replacement Site Generation begins from a fresh Onboarding Submission.

Each Site Generation is bound to exactly one Onboarding Submission. Only one Site Generation ultimately supplies the accepted/published Site; abandoned generations may be physically cleaned up while their lightweight Build Records remain.

_Avoid_: a second Site, Revision when the design origin itself changes.

## Revision Request

A **Revision Request** is a human-requested change to an existing Site that preserves its Build Mode and Reference. It contains only the requested delta and starts a new Build derived from the previous Build's approved inputs.

A Revision Request may update Business Facts, Derived Content or implementation details without requiring a new Onboarding Submission. Changing the Reference or Build Mode is not a Revision Request.

_Avoid_: treating a Revision Request as an automated Build Version or using it to replace the Reference/Build Mode.

## Fact Update

A **Fact Update** is an explicit human-provided change to one or more Business Facts carried by a Revision Request into a new Build while the governing Onboarding Submission remains immutable.

A Fact Update supersedes the affected fact for that Build and later Builds derived from it unless changed again, but it does not rewrite the historical Onboarding Submission or the facts that governed earlier Builds.

_Avoid_: mutating an Onboarding Submission, silently changing historical Business Facts.

## Business

A **Business** is the stable real-world entity represented by a Site across Site Generations. Its facts may change over time; V2 evaluates each Site Generation against the immutable Onboarding Submission that governed that generation together with any explicit Fact Updates applied through later Revision Requests.

_Avoid_: Client, Account, Customer when referring to the business represented by the Site; treating one submission as the permanent Business record.

## Business Fact

A **Business Fact** is a concrete claim about the Business that is directly supported by the governing Onboarding Submission or by an explicit Fact Update applied through a later Revision Request. Its validity is scoped to the Build inputs that govern the relevant Build.

Later Onboarding Submissions or Fact Updates may supersede earlier facts for future Builds without rewriting historical Builds or Build Records. Missing facts must remain unknown rather than being invented.

Examples include prices, locations, certifications, awards, years of experience, service coverage and quantitative claims.

## Derived Content

**Derived Content** is non-factual marketing language created from the governing Onboarding Submission and any applicable Revision Request, such as headlines, section labels, positioning language, summaries, SEO copy and image concepts.

Derived Content may interpret or generalize safely, but it must never introduce unsupported Business Facts.

## Site

A **Site** is the stable identity of the single intended customer-facing four-page website for one Business. Multiple Site Generations, each potentially based on a different Onboarding Submission, may attempt to produce or replace that same Site without creating multiple Sites.

A Site has one current Published Version at most. The Onboarding Submission belonging to the currently accepted Site Generation is authoritative for that generation; earlier submissions remain historical inputs to their own generations rather than defining the Site permanently.

_Avoid_: Site Generation, Build, Build Version, Deployment, treating one Onboarding Submission as the permanent identity of the Site.

## Site Configuration

**Site Configuration** is mutable operational state that belongs to the Site but is not part of an immutable Build Version. It contains runtime settings that may change independently of website generation, such as the current Form Destination.

Changing Site Configuration does not create a Build, Revision Request or Site Generation and does not require rebuilding or republishing the Site unless the configuration change itself affects generated content or design.

_Avoid_: embedding mutable operational routing as authoritative state inside a Build Version.

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

A **Deployment** is a runnable instance of one exact Build Version. A Deployment may be a Preview, Published Version or temporarily retained Rollback Version; failed or superseded Deployments that have no active rollback role are disposable and should not be treated as permanent Build history.

_Avoid_: Build Record, Site.

## Preview

A **Preview** is the inspectable pre-publication Deployment of one exact Build Version used for automated QA and human review.

A Preview may be replaced or deleted when superseded; Approval promotes that same Build Version toward publication rather than regenerating it.

_Avoid_: Published Version, a regenerated copy of an approved Build Version.

## Published Version

A **Published Version** is the specific approved Build Version currently serving as the live Site.

Publishing a newer Build Version does not change the identity of the Site and must not regenerate the approved Build Version. When replaced, the immediately previous Published Version may become the temporary Rollback Version.

## Rollback Version

A **Rollback Version** is the immediately previous Published Version retained temporarily so the Site can be restored to that exact approved Build Version without regeneration if the current Published Version has a production problem.

A Rollback Version is not active publication and is retained only for the defined rollback window. Older superseded published Deployments may be removed once they no longer hold the rollback role; failed previews and never-published superseded Deployments do not receive rollback retention.

_Avoid_: regenerated fallback, arbitrary historical Build Version, permanent archive of every published Deployment.

## Rollback

A **Rollback** is the operational restoration of the Rollback Version as the Site's active Published Version. It reactivates that exact previously approved Build Version without creating a new Build, Build Version or Approval and without regenerating source.

Rollback changes current publication state but never rewrites history: the replaced version remains recorded as a Build Version that was previously approved and published. Mutable Site Configuration does not roll back with the Build Version unless explicitly requested.

_Avoid_: new Build, new Approval, regeneration, erasing prior publication history.

## Build Mode

A **Build Mode** is the design-origin strategy used for a Site Generation.

There are exactly two V2 modes:

- **REFERENCE_BOUND** — the Site's visual architecture is derived from an external Reference.
- **ORIGINAL_DESIGN** — the Site's visual architecture is created from Business, audience, brand and creative direction without a Reference.

Changing Build Mode starts a new Site Generation for the same Site.

## Reference

A **Reference** is the external design source used to define the target visual architecture for a REFERENCE_BOUND Site Generation. It may contain a Reference Screenshot, a Reference URL, or both.

A Reference is a design source, not a source of Business Facts, copy, branding, trademarks or imagery. Replacing the Reference starts a new Site Generation for the same Site.

## Reference Screenshot

A **Reference Screenshot** is the frozen visual representation of a Reference and is authoritative for static composition, geometry, hierarchy, section order, proportions, image placement and whitespace.

A user-supplied full-page screenshot or a canonical screenshot captured from a Reference URL may serve this role.

## Reference URL

A **Reference URL** is the live website address that supplements a Reference Screenshot with behavioral and runtime evidence such as hover, motion, sticky behavior, typography and responsive transformations.

A URL-only Reference is valid only after a canonical Reference Screenshot and associated evidence have been captured and frozen for that Site Generation.

## Reference Suitability

**Reference Suitability** is the classification of whether V2 can reproduce the Reference within its supported design capability while preserving the Reference's core visual identity.

Canonical outcomes:

- **SUPPORTED** — the target can be reproduced within normal V2 capabilities without material approximation.
- **SUPPORTED_WITH_LIMITATIONS** — the core visual identity can be preserved, but specific non-essential behaviors or effects require explicit approximations recorded in an Adaptation Contract.
- **UNSUPPORTED** — one or more capabilities outside V2 are materially essential to the Reference's visual identity, so approximation would change the target rather than faithfully adapt it.

_Avoid_: hiding an identity-defining unsupported feature inside a limitation.

## Adaptation Contract

An **Adaptation Contract** is the explicit, concrete set of accepted approximations for a SUPPORTED_WITH_LIMITATIONS Reference, fixed before generation begins.

Each adaptation must state what unsupported behavior is being replaced and the intended substitute outcome; vague instructions such as “simplify animation” are insufficient. QA evaluates the Build against the Reference plus this contract and must not treat an explicitly accepted difference as a defect.

An Adaptation Contract cannot legalize removal of a capability that is essential to the Reference's visual identity; that case requires Reference Suitability to be UNSUPPORTED.

_Avoid_: vague limitation note, post-hoc excuse for QA failure.

## Reference Evidence

**Reference Evidence** is the descriptive record of observable or measurable facts, captures and behaviors collected from a Reference before interpretation. It records what is present without deciding why it matters or what the generated Site should do.

Reference Evidence is never rewritten to match a later interpretation.

_Avoid_: inferred importance, design intent, signature-trait judgments.

## Reference Analysis

A **Reference Analysis** is the structured interpretation of Reference Evidence that identifies hierarchy, relationships, signature traits, likely design intent and which observed characteristics carry the Reference's visual identity.

It may rank or contextualize Evidence, but it must not overwrite, contradict or fabricate Reference Evidence.

_Avoid_: raw measurements or invented observations presented as evidence.

## Visual Blueprint

A **Visual Blueprint** is the binding design contract that translates the chosen design origin into the intended Site for the Business.

For a REFERENCE_BOUND Build, it carries forward the Reference Analysis's identity-defining structural and signature traits while adapting branding, content, imagery and permitted implementation details to the Business. For an ORIGINAL_DESIGN Build, it is created directly from Business and creative inputs.

Once generation begins, automated repair may correct implementation against the Visual Blueprint but must not silently redefine it. If the Visual Blueprint itself is wrong or impossible, human review or a new Build/Site Generation is required.

_Avoid_: Implementation Plan, generated source, mutable repair target.

## Implementation Contract

An **Implementation Contract** is the binding realization plan for expressing a Visual Blueprint and the Business content across the four pages of the Site.

It may choose page structure, content allocation, component boundaries, responsive realization, image-slot mapping and other implementation-facing details, but it must not change the Visual Blueprint's topology, signature traits, first-viewport composition, image roles or visual thesis.

If the Visual Blueprint cannot be realized within V2 capability, the Implementation Contract must surface an explicit blocker rather than silently simplify or reinterpret the design.

_Avoid_: alternate design direction, Blueprint rewrite, silent simplification.

## Image Slot

An **Image Slot** is a stable visual requirement within a Build, defined by its semantic purpose and compositional role before image generation begins.

Cropping, object-position changes, remapping or generating another candidate do not create a new Image Slot. If the semantic or compositional role itself changes, that change belongs in a new Build/Blueprint path rather than silently repurposing the existing slot.

_Avoid_: generated image candidate, arbitrary asset placeholder.

## Image Attempt

An **Image Attempt** is one generated candidate created to satisfy a specific Image Slot.

Multiple Image Attempts may exist for the same Image Slot; creating another attempt does not change the Image Slot's identity or requirements.

_Avoid_: Image Slot, Accepted Image.

## Accepted Image

An **Accepted Image** is the Image Attempt selected to fulfill an Image Slot for a specific Build Version because it satisfies that slot's semantic and compositional requirements.

A later repair may select or generate another Image Attempt without changing the underlying Image Slot.

_Avoid_: any generated image regardless of fit.

## Release Candidate

A **Release Candidate** is one exact Build Version that has completed generation and required preflight checks and is undergoing automated release QA.

A Release Candidate may still contain defects and may enter the bounded repair process. Any repair that changes the candidate produces a new immutable Build Version, which becomes a new Release Candidate and must be evaluated on its own.

_Avoid_: treating a repaired candidate as the same Build Version.

## Release Blocker

A **Release Blocker** is a concrete P0 or P1 defect that prevents a Release Candidate from being considered Release Ready. A Release Blocker may be automatically repairable within the bounded repair process or may ultimately require human escalation.

P2/P3 imperfections and optional polish are not Release Blockers when all mandatory release gates pass.

_Avoid_: HUMAN_REVIEW_REQUIRED, minor polish issue.

## Release Ready

A Build Version is **Release Ready** only when that exact Build Version has passed all automated release gates and no Release Blocker remains.

Release Ready is an automated quality state, not human Approval or publication. A Blueprint-level defect cannot be converted into Release Ready through implementation-only repair; it requires the explicit Blueprint-review path or a new Build/Site Generation.

_Avoid_: Approved, Published, or “good enough after repair” without re-evaluating the new Build Version.

## Approval

**Approval** is the explicit human acceptance of one exact Release Ready Build Version for publication. Approval belongs only to that Build Version and never carries forward to another Build or superseded candidate.

A Revision Request after Approval creates a new Build that requires its own Approval before it can replace the Published Version.

_Avoid_: approving a Site generally or reusing Approval across Build Versions.

## Human Review Required

**HUMAN_REVIEW_REQUIRED** is the escalation outcome when the bounded automated process cannot safely resolve the remaining Release Blocker, has exhausted its permitted repair path, or requires human judgment about the Visual Blueprint, Reference assumptions or another non-automatable decision.

It is not a defect severity or a normal technical failure and must not trigger an unbounded automatic retry loop.

_Avoid_: Release Blocker category, generic failure status, another retry instruction.

## Degraded

A **Degraded** Build is one that produced a genuinely usable Preview or partial result, but one or more non-optional parts of the normal Build/release contract were not satisfied.

A Degraded Build is never Release Ready and must never publish automatically. It may be surfaced to a human for inspection, diagnosis or salvage only when the remaining result is still useful.

_Avoid_: silent success, Release Ready, unusable failure.

## Failed

A **Failed** Build is one that could not produce a usable candidate or meaningful partial result for its intended contract.

If the remaining output is not genuinely useful for human inspection, diagnosis or salvage, the Build is Failed rather than Degraded.

_Avoid_: Degraded when no useful result remains.

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

A **Form Destination** is the currently approved recipient for contact messages from a Site and is part of mutable Site Configuration rather than an immutable Build Version.

Changing the Form Destination does not create a Build, Revision Request or Site Generation and does not require rebuilding or republishing the Site. The visitor can never choose or override the Form Destination, and Rollback does not change it unless explicitly requested.

_Avoid_: browser-controlled recipient, Build-embedded authoritative destination, automatic rollback of recipient configuration.
