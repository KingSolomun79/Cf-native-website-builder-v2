# WAZIBIZ Website Builder V2

Cloudflare-native Website Builder V2 for high-fidelity four-page Business websites.

This repository is a brownfield fork of the earlier builder. Existing V1 code may remain temporarily for infrastructure reuse, but V1 product behavior is not authoritative.

## Read this first

Canonical source order:

1. `CONTEXT.md` — domain vocabulary and semantics.
2. `v2-docs/IMPLEMENTATION-PRD.md` — normative implementation specification.
3. `v2-docs/CAPABILITY-ENVELOPE.md` + `v2-docs/capability-envelope.json`.
4. `v2-docs/FINAL-DECISION-RECORD.md`.
5. `v2-docs/prompts/PROMPT-MANIFEST.md`.
6. `v2-docs/prompts/00-domain-contract-v1.md` + retained detailed stage-prompt body.

Older code/docs are brownfield context only where the migration audit explicitly retains them.

## Product modes

```text
REFERENCE_BOUND
  -> prove on fixed five-site benchmark
  -> minimum 3/5 Benchmark Pass
  -> then ORIGINAL_DESIGN
```

`REFERENCE_BOUND` recreates visual architecture from an external Reference while replacing content, branding, imagery and Business Facts.

`ORIGINAL_DESIGN` creates a distinctive design from Business, audience, brand, offer, conversion and creative-direction inputs without a Reference.

## Domain model

V2 has no Client Account or Client User domain.

```text
Business
  -> Site
      -> Site Generation
          -> Build
              -> Build Version
```

- Every new Site Generation starts from one fresh immutable Onboarding Submission.
- Changing Reference or Build Mode starts a new Site Generation.
- Human changes within the same design origin use Revision Request -> new Build.
- Business Fact changes use Fact Update without mutating historical intake.
- Automated Repair creates a new Build Version inside the same Build only while Business/design contracts remain fixed.

## Release lifecycle

```text
Build Version
  -> Release Candidate
  -> Release Ready
  -> Approval
  -> Publication
  -> Published Version
```

Approval and Publication are separate. Publication deploys the exact approved Build Version without regeneration.

The immediately previous Published Version may be retained temporarily as Rollback Version. Rollback restores that exact version without a new Build or Approval and does not implicitly revert Site Configuration.

## Generated Site contract

Initial V2 produces exactly:

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

Generated output is semantic, static/framework-light HTML/CSS/minimal JS. The platform standardizes technical interfaces, not visual composition.

## Reference fidelity

Reference Screenshot is authoritative for static composition. Reference URL supplements interaction, responsive and computed/runtime evidence.

Pipeline:

```text
Onboarding Submission
-> Business Facts
-> Reference Suitability
-> Reference Evidence
-> Reference Analysis
-> Visual Blueprint
-> Implementation Contract
-> incremental Site generation
-> Image Plan
-> image waves
-> assembly
-> Technical Preflight
-> Preview
-> QA-A + QA-B
-> bounded Automated Repair
-> Release Ready OR HUMAN_REVIEW_REQUIRED
```

A Blueprint-root defect emits `BLUEPRINT_REVIEW_REQUIRED`; implementation QA must never silently redesign the Blueprint.

## Quality gates

QA-A:

- visual >=90;
- content >=90;
- zero P0/P1;
- no fabrication;
- all hard visual composition gates.

QA-B:

- technical >=90;
- zero P0/P1;
- browser/runtime/source/DOM/network/accessibility/SEO/form gates.

Automation limit:

1. initial generation;
2. one Fix Coordinator repair batch;
3. at most one Release Blocker Fix;
4. then `HUMAN_REVIEW_REQUIRED` if blockers remain.

## Images

- Normal target: 12 Accepted Images per completed Site.
- Wave 1: CRITICAL + HIGH homepage Image Slots.
- Wave 2: NORMAL/supporting Image Slots.
- Hard KIE image-generation spend gate: USD 3.00 per completed Site.
- Preserve repair reserve.
- CSS crop/object-position/routing/remap before regeneration where viable.
- Never ship temporary provider URLs.

## Contact form

Every generated Contact form uses the central multi-tenant WAZIBIZ Form Service.

```text
visitor
-> static form
-> validation + Turnstile + rate limit
-> Accepted Submission
-> Site Configuration
-> Form Destination + verified Sender Identity
-> Cloudflare-native Email Delivery
```

Browser code never controls recipient, From sender, sender domain, template or credentials. Visitor email may be validated Reply-To, never transactional From.

Form Destination and Sender Identity are mutable Site Configuration and can change without rebuilding/reapproving the Site.

## Benchmark

Exactly five Benchmark Sites are fixed. Do not swap failures for easier references.

Benchmark Pass requires:

- exact candidate reaches Release Ready automatically;
- zero manual source-code edits;
- hard QA gates pass;
- KIE spend <= USD 3.00/Site;
- four valid pages;
- working form capability where exercised.

Human Approval and Publication are not benchmark requirements.

At least 3/5 Benchmark Pass unlocks `ORIGINAL_DESIGN` implementation.

## Prompt runtime

Canonical prompt versions are listed in `v2-docs/prompts/PROMPT-MANIFEST.md`.

Each runtime prompt is composed from:

```text
v2-docs/prompts/00-domain-contract-v1.md
+
retained full detailed stage-prompt body
```

This preserves the long detailed prompt bodies while superseding obsolete rules through one shared canonical domain contract.

## Brownfield migration

Before final V2 release:

- audit existing V1 infrastructure;
- retain only proven reusable platform code;
- remove superseded V1 generator intelligence;
- remove V1/V2 runtime switches;
- remove obsolete prompt registry entries;
- remove dead schemas/types/tests/routes/docs;
- ensure no production route can invoke V1.

See the normative implementation phases in `v2-docs/IMPLEMENTATION-PRD.md`.
