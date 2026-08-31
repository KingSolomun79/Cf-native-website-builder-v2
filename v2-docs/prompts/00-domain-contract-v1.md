# WAZIBIZ Website Builder V2 — Prompt Domain Contract v1

This contract is prepended to every V2 runtime stage prompt. It is authoritative over any contradictory clause in the retained detailed stage-prompt body.

## Canonical language

Use `CONTEXT.md` as the vocabulary authority. Do not introduce Client Account, Client User, mutable Client Profile, or another competing lifecycle term.

## Input and lifecycle rules

- A new Site Generation starts from one immutable Onboarding Submission.
- Replacing the Reference or changing Build Mode creates a new Site Generation, not a Revision Request.
- Human content/fact/design changes within the same Reference and Build Mode create a Revision Request and therefore a new Build.
- A Fact Update carried by a Revision Request can supersede Business Facts for the new Build without mutating the historical Onboarding Submission.
- Automated Repair creates a new Build Version inside the same Build and may only repair realization against already-fixed Business inputs, Visual Blueprint and Implementation Contract.
- Automated Repair must never introduce new human intent, change Business Facts, replace the Reference, switch Build Mode or mutate the Visual Blueprint.
- A Blueprint defect emits `BLUEPRINT_REVIEW_REQUIRED`, which leads to `HUMAN_REVIEW_REQUIRED`; never silently redesign through implementation repair.

## Release rules

- `Release Ready` is the automated quality state for one exact Build Version.
- `Approval` is explicit human acceptance and authorization to publish that exact Release Ready Build Version.
- `Publication` is a separate operational act. Approval does not itself make a version live.
- Publication deploys the exact approved Build Version without regeneration.
- An operational publication failure may be retried for the unchanged approved Build Version without fresh Approval.
- A later human revision starts a new Build and requires fresh Release Ready + Approval.
- Rollback restores the exact retained prior Published Version without creating a new Build, Build Version or Approval.
- Site Configuration does not roll back unless explicitly requested.

## Reference rules

- Reference Screenshot is authoritative for static composition.
- Reference URL supplements interaction, responsive and computed/runtime evidence.
- Reference Evidence records observations and measurements only.
- Reference Analysis interprets Reference Evidence.
- Visual Blueprint is the binding design contract.
- Implementation Contract realizes the Blueprint and cannot alter its topology, signature traits, first viewport, image roles or visual thesis.
- Reference content, branding, trademarks, proprietary images and code are never Business truth and are never copied as content/assets.
- `SUPPORTED_WITH_LIMITATIONS` requires an Adaptation Contract fixed before generation.

## Image rules

- Image Slot is the stable semantic/compositional requirement.
- Image Attempt is one generated candidate for a slot.
- Accepted Image is the candidate selected for an exact Build Version.
- Use two-wave generation and preserve repair budget.
- Hard KIE spend gate is USD 3.00 per completed site.
- CSS crop/object-position, routing and remapping precede regeneration where viable.
- No temporary provider URL may ship.

## QA and repair rules

- QA-A owns rendered visual/content judgment and hard composition gates.
- QA-B owns browser/source/DOM/network/accessibility/SEO/form-contract verification.
- Release Ready requires no P0/P1 Release Blocker and all mandatory gates passing.
- One main Fix Coordinator batch and at most one narrow Release Blocker Fix are allowed.
- A material automated repair produces a new Build Version and must be re-evaluated as a new Release Candidate.
- No unbounded retries or mutation loops.
- `Degraded` means a useful partial/Preview exists but the Build cannot be Release Ready.
- `Failed` means no genuinely useful candidate/partial result remains.

## Form and email rules

- Generated sites use the central WAZIBIZ Form Service; any older rule saying forms are presentation-only or must not submit is obsolete.
- Browser code may send public site/form identity, visitor fields, Turnstile token and client-safe metadata only.
- Browser code must never control recipient, From sender, sender domain, template, credentials or internal routing.
- Form Destination and Sender Identity are mutable Site Configuration, not Build artifacts.
- V2 defaults to a verified WAZIBIZ platform Sender Identity.
- Visitor email may be validated and used as Reply-To; it must never be transactional From.
- A Form Submission becomes an Accepted Submission only when the platform validates and durably accepts responsibility for it.
- Email Delivery is downstream of acceptance. Transient delivery failure uses bounded server-side retry and does not require visitor resubmission.

## Benchmark rules

- Five Benchmark Sites are fixed; do not swap failed references.
- Benchmark Pass means the exact result reaches Release Ready automatically, with zero manual source edits and within the KIE hard budget.
- Human Approval and Publication are not required for Benchmark Pass.
- At least 3/5 Benchmark Pass unlocks ORIGINAL_DESIGN implementation work.

## Prompt provenance

Every runtime invocation persists prompt id/version, this domain-contract version, model, schema version, attempt and input artifact identities.
