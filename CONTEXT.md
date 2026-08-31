# WAZIBIZ Website Builder V2

Canonical implementation-free domain language for Website Builder V2. Architecture, storage, providers, schemas and runtime mechanics belong in the implementation specification or ADRs; this file defines what domain terms mean.

## Language

**Onboarding Submission**: The immutable input package and Business fact snapshot submitted through the onboarding form for one Site Generation. A Site can have later submissions for replacement Site Generations, but an existing submission is never rewritten.
_Avoid_: Client Account, Customer Account, User Profile, mutable Business profile.

**Site Generation**: A fresh design-origin attempt to produce the same intended Site from exactly one immutable Onboarding Submission. Replacing the Reference or changing Build Mode starts a new Site Generation and fresh Onboarding Submission, not a Revision Request.
_Avoid_: second Site, Revision when design origin changes.

**Revision Request**: A human-requested delta to an existing Site that preserves its Reference and Build Mode and starts a new Build derived from prior approved inputs. It may change Business Facts, Derived Content or generated implementation, but not the design origin.
_Avoid_: Automated Repair, Build Version, Reference replacement.

**Fact Update**: An explicit human-provided Business Fact change carried by a Revision Request into a new Build. It supersedes that fact for the new Build lineage without mutating the historical Onboarding Submission or earlier Builds.
_Avoid_: editing historical intake, silent fact mutation.

**Business**: The stable real-world entity represented by a Site across Site Generations. Each Build evaluates the Business through the governing Onboarding Submission plus any applicable Fact Updates rather than through a persistent client account.
_Avoid_: Client Account, Customer Account, User Profile.

**Business Fact**: A concrete claim supported by the Build's governing Onboarding Submission or explicit Fact Update. Unsupported factual claims remain unknown rather than being invented.
_Avoid_: inferred price, certification, award, location, service coverage or quantitative claim.

**Derived Content**: Non-factual marketing language created from supported Business inputs, such as headlines, summaries, positioning, SEO copy and image concepts. It may interpret safely but cannot introduce unsupported Business Facts.
_Avoid_: fabricated fact presented as marketing copy.

**Site**: The stable identity of one intended customer-facing four-page website for one Business. Multiple Site Generations and Builds may attempt to produce or replace it, while at most one Published Version is active.
_Avoid_: Site Generation, Build, Build Version, Deployment.

**Site Configuration**: Mutable operational state for a Site whose effect can be applied without changing generated Build artifacts, such as Form Destination and Sender Identity. A change that alters generated content, design or page behavior is not Site Configuration.
_Avoid_: Build-immutability bypass, generated-content setting.

**Build**: One end-to-end attempt to create or revise a Site from one fixed approved set of Business, content and design inputs. New human intent starts a new Build.
_Avoid_: automated repair iteration.

**Build Version**: An immutable candidate state within one Build, created by the bounded automated generation or repair lifecycle. Human-requested changes start a new Build rather than another Build Version.
_Avoid_: Revision Request, human creative iteration.

**Automated Repair**: A bounded machine-directed change that brings a Build Version into compliance with already-fixed Business inputs, Visual Blueprint and Implementation Contract. A material repair creates a new Build Version and cannot change Business Facts, Reference, Build Mode or Visual Blueprint.
_Avoid_: Revision Request, Blueprint rewrite, new creative direction.

**Build Record**: The compact retained diagnostic history of a Build, including outcome, QA, failure cause, cost and relevant prompt/model/schema provenance. It may remain after disposable artifacts and Deployments are removed.
_Avoid_: Deployment, Build Version.

**Deployment**: A runnable instance of one exact Build Version. It can serve as a Preview, Published Version or temporarily retained Rollback Version; deployments with no active role are disposable.
_Avoid_: Build Record, Site.

**Preview**: The inspectable pre-publication Deployment of one exact Build Version used for automated QA and human review. Approval and Publication operate on that same immutable Build Version rather than regenerating it.
_Avoid_: Published Version, regenerated approval copy.

**Publication**: The explicit operational act of making one exact approved Build Version the live Site. Approval authorizes Publication but is distinct from it; an operational publication failure can be retried for the unchanged approved Build Version.
_Avoid_: Approval, regeneration during publish.

**Published Version**: The exact approved Build Version currently serving as the live Site after successful Publication. Replacing it does not change Site identity.
_Avoid_: latest mutable Build, Preview.

**Rollback Version**: The immediately previous Published Version retained temporarily so the Site can be restored without regeneration. It is not active publication and exists only for the defined rollback window.
_Avoid_: arbitrary historical version, permanent archive.

**Rollback**: The operational restoration of the Rollback Version as the active Published Version without a new Build, Build Version, Approval or regeneration. Publication history is preserved and mutable Site Configuration does not roll back unless explicitly requested.
_Avoid_: new release, history rewrite.

**Build Mode**: The design-origin strategy for a Site Generation: `REFERENCE_BOUND` or `ORIGINAL_DESIGN`. Changing mode starts a new Site Generation.
_Avoid_: style preset, industry archetype.

**Reference**: The external design source for a `REFERENCE_BOUND` Site Generation, consisting of a Reference Screenshot, Reference URL or both. It is a design source only and never a source of Business Facts, copied branding, trademarks, imagery or copy.
_Avoid_: content source, brand source.

**Reference Screenshot**: The frozen visual evidence authoritative for static composition, geometry, hierarchy, section order, proportions, image placement and whitespace. It may be user supplied or canonically captured from the Reference URL.
_Avoid_: live behavioral evidence.

**Reference URL**: The live address that supplements the Reference Screenshot with behavioral and runtime evidence such as fonts, hover, motion, sticky behavior and responsive transformations. URL-only input becomes valid only after canonical screenshot/evidence capture.
_Avoid_: static-composition authority when it conflicts with the frozen screenshot.

**Reference Suitability**: The pre-generation classification of whether V2 can preserve the Reference's core visual identity: `SUPPORTED`, `SUPPORTED_WITH_LIMITATIONS`, or `UNSUPPORTED`. Identity-defining unsupported behavior cannot be hidden as a limitation.
_Avoid_: post-hoc suitability excuse.

**Adaptation Contract**: The concrete set of accepted approximations fixed before generation for a `SUPPORTED_WITH_LIMITATIONS` Reference. QA treats these declared differences as intentional, but the contract cannot legalize removal of identity-defining features.
_Avoid_: vague limitation, post-hoc QA exemption.

**Reference Evidence**: The descriptive record of observed or measured Reference facts, captures and behaviors before interpretation. It records what exists without inferring importance or design intent and is never rewritten to fit later analysis.
_Avoid_: inferred intent presented as evidence.

**Reference Analysis**: The structured interpretation of Reference Evidence that identifies hierarchy, relationships, signature traits, likely design intent and identity-defining characteristics. It may interpret Evidence but cannot overwrite or fabricate it.
_Avoid_: raw measurement, invented observation.

**Visual Blueprint**: The binding design contract translating the chosen design origin into the intended Site for the Business. Automated Repair may correct implementation against it but cannot silently redefine it.
_Avoid_: Implementation Contract, generated source, mutable repair target.

**Blueprint Review Required**: `BLUEPRINT_REVIEW_REQUIRED` is the specific escalation signal that the Visual Blueprint itself is materially wrong, contradictory, impossible or inconsistent with the design-origin contract. It leads to human review rather than implementation-only repair.
_Avoid_: normal implementation defect, automatic Blueprint mutation.

**Implementation Contract**: The binding realization plan for expressing the Visual Blueprint and Business content across the four pages. It may choose technical structure and responsive realization but cannot change topology, signature traits, first viewport, image roles or visual thesis.
_Avoid_: alternate design direction, Blueprint rewrite.

**Image Slot**: A stable visual requirement inside a Build, defined by semantic purpose and compositional role before image generation. Crop, remapping or another generated candidate does not create a new slot; changing the role does.
_Avoid_: generated image candidate, arbitrary placeholder.

**Image Attempt**: One generated candidate created to satisfy a specific Image Slot. Multiple attempts may exist for the same slot.
_Avoid_: Image Slot, Accepted Image.

**Accepted Image**: The Image Attempt selected to fulfill an Image Slot for an exact Build Version because it satisfies the slot's semantic and compositional requirements.
_Avoid_: any generated image regardless of fit.

**Release Candidate**: One exact Build Version that completed generation and required preflight and is undergoing automated release QA. A repair that changes it creates a new Build Version and therefore a new Release Candidate.
_Avoid_: mutated candidate treated as the same version.

**Release Blocker**: A concrete P0 or P1 defect that prevents Release Ready. P2/P3 imperfections and optional polish are not Release Blockers when mandatory release gates pass.
_Avoid_: HUMAN_REVIEW_REQUIRED, minor polish issue.

**Release Ready**: The automated quality state of an exact Build Version that passed every required release gate and has no Release Blocker. It is distinct from Approval and Publication.
_Avoid_: Approved, Published, good-enough unrechecked repair.

**Approval**: Explicit human acceptance of one exact Release Ready Build Version and authorization to publish it. Approval does not itself make the Site live, remains valid through an operational publication retry of the unchanged version, and never carries to another Build Version.
_Avoid_: Site-wide approval, automatic publication, inherited approval.

**Human Review Required**: `HUMAN_REVIEW_REQUIRED` is the escalation outcome when bounded automation cannot safely resolve a Release Blocker, has exhausted its permitted repair path, or requires human judgment. It is not a defect severity and cannot trigger an unbounded retry loop.
_Avoid_: Release Blocker category, generic failure, retry instruction.

**Degraded**: A Build outcome where a genuinely useful Preview or partial result exists but one or more non-optional Build/release requirements remain unsatisfied. It is never Release Ready or automatically publishable.
_Avoid_: silent success, unusable failure.

**Failed**: A Build outcome where no usable candidate or meaningful partial result remains for the intended contract. If the output is not genuinely useful for inspection, diagnosis or salvage, it is Failed rather than Degraded.
_Avoid_: Degraded without useful output.

**Benchmark Site**: One fixed Reference-and-replacement-Business test case in the `REFERENCE_BOUND` proof suite, with frozen screenshot/evidence and stable replacement inputs. It cannot be swapped merely because it is difficult or fails.
_Avoid_: moving benchmark target, easier replacement reference.

**Benchmark Pass**: A Benchmark Site reaching Release Ready through the automated pipeline without manual source-code edits and within the agreed image-generation spend limit. Human Approval and Publication are not required because the benchmark measures automated generation/release quality.
_Avoid_: manually corrected result, approval as benchmark criterion.

**Design Archetype**: Non-binding inspiration vocabulary only. It must never automatically select or constrain a Visual Blueprint based on industry.
_Avoid_: industry-to-layout rule, design authority.

**Form Submission**: One visitor-submitted contact message and its processing lifecycle. Browser success or client-side validation alone does not make it accepted.
_Avoid_: button click treated as delivery success.

**Accepted Submission**: A Form Submission the platform has validated and durably accepted responsibility for processing. Temporary downstream Email Delivery failure does not require visitor resubmission.
_Avoid_: email delivery as prerequisite for submission existence.

**Email Delivery**: One outbound attempt to deliver an Accepted Submission to the current Form Destination. Temporary failures may receive bounded server-side retry; permanent failure is recorded without erasing the Accepted Submission.
_Avoid_: unbounded retry, rewriting submission history.

**Form Destination**: The currently approved recipient for a Site's contact messages, stored as mutable Site Configuration. The visitor cannot control it, and changing it requires no Build or Publication.
_Avoid_: browser-controlled recipient, Build-embedded authoritative recipient.

**Sender Identity**: The authenticated address or domain the platform is authorized to use as the outbound `From` identity. V2 defaults to a verified WAZIBIZ platform sender; a Business-owned domain is optional only after verification and remains Site Configuration.
_Avoid_: visitor-controlled From, unverified Business domain.

**Reply-To**: The validated visitor email attached to Email Delivery so the Business can reply directly without using that visitor address as the authenticated Sender Identity.
_Avoid_: visitor email as From, Sender Identity.
