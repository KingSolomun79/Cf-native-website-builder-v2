# WAZIBIZ Website Builder V2 — Agent Guidelines

This repository is a brownfield V2 fork. Existing V1 code may remain temporarily for infrastructure reuse, but V1 product semantics are not authoritative.

## Mandatory reading order

Before coding, read:

1. `CONTEXT.md` — canonical domain language and semantics.
2. `v2-docs/IMPLEMENTATION-PRD.md` — normative V2 implementation specification.
3. `v2-docs/CAPABILITY-ENVELOPE.md` + `v2-docs/capability-envelope.json`.
4. `v2-docs/FINAL-DECISION-RECORD.md`.
5. `v2-docs/prompts/PROMPT-MANIFEST.md` and `v2-docs/prompts/00-domain-contract-v1.md`.

If existing code, tests, migrations, root docs or retained prompt bodies conflict with those sources, treat the conflicting V1 behavior as migration work, not as V2 authority.

## Canonical V2 domain rules

- No Client Account or Client User domain.
- A Business has one stable Site identity.
- Every new Site Generation begins from one fresh immutable Onboarding Submission.
- Changing Reference or Build Mode starts a new Site Generation.
- Human changes that preserve Reference/Build Mode use Revision Request -> new Build.
- Business Fact changes use Fact Update; historical Onboarding Submissions remain immutable.
- Human new intent creates a new Build.
- Bounded Automated Repair creates a new immutable Build Version inside the same Build.
- Automated Repair cannot change Business Facts, Reference, Build Mode or Visual Blueprint.
- Blueprint-root defects emit `BLUEPRINT_REVIEW_REQUIRED` -> `HUMAN_REVIEW_REQUIRED`.

## Release lifecycle

```text
Build Version
  -> Release Candidate
  -> Release Ready
  -> Approval
  -> Publication
  -> Published Version
```

Approval and Publication are separate. Publication deploys the exact approved Build Version without regeneration. Operational publication failure may be retried under the same Approval while that Build Version is unchanged.

Retain the immediately previous Published Version temporarily as Rollback Version. Rollback restores that exact version without a new Build/Approval and does not implicitly revert Site Configuration.

## Generated Site contract

- Exactly Home, About, Services, Contact for initial V2.
- Static/framework-light semantic HTML + CSS + minimal JS.
- Prefer shared `site.css` + `site.js`.
- No universal WAZIBIZ layout template.
- Reference-specific grids/overlaps/clipping/topology remain possible.
- React/Tailwind/GSAP are not default generated-site dependencies.

## REFERENCE_BOUND pipeline

```text
Onboarding Submission
-> Business Fact normalization
-> Reference Suitability
-> Reference Evidence
-> Reference Analysis
-> Visual Blueprint
-> Implementation Contract
-> incremental Site generation
-> Image Plan / Image Slots
-> KIE waves
-> assembly
-> Technical Preflight
-> Preview
-> QA-A + QA-B
-> bounded Automated Repair
-> Release Ready OR HUMAN_REVIEW_REQUIRED
-> Approval
-> Publication
```

Reference Screenshot controls static composition. Reference URL supplements runtime/interaction/responsive evidence. Reference content/branding/assets/source are not copied as Business content.

## Image rules

- Normal target: 12 Accepted Images per completed Site.
- Two waves: CRITICAL/HIGH homepage, then NORMAL/supporting.
- Hard KIE image spend gate: USD 3.00/Site.
- CSS crop/object-position, routing and remapping before regeneration where possible.
- No temporary provider URL may ship.

## QA and repair

- QA-A: rendered visual/content quality + hard composition gates.
- QA-B: browser/source/DOM/network/accessibility/SEO/form contract.
- Release Ready requires zero P0/P1 Release Blocker and all mandatory gates.
- One Fix Coordinator batch + at most one Release Blocker Fix.
- Every material repair creates a new Build Version that must be re-evaluated.
- Never create an unbounded retry/mutation loop.

## Contact form and email

V2 generated Sites use one central WAZIBIZ Form Service.

Browser code never controls recipient, From sender, sender domain, template or credentials.

- Form Destination and Sender Identity are mutable Site Configuration.
- Default Sender Identity is a verified WAZIBIZ platform sender.
- Visitor email may be validated Reply-To only.
- A Form Submission becomes Accepted Submission when the platform validates and durably accepts responsibility.
- Email Delivery happens downstream with bounded server-side retry.

Any existing SMTP2Go/per-Site mail-worker implementation is V1 brownfield code unless explicitly retained by the V2 migration audit.

## Prompt rules

Do not invoke retained detailed prompt files directly by filename version. Runtime prompt IDs/versions come from `v2-docs/prompts/PROMPT-MANIFEST.md` and are composed as:

```text
00-domain-contract-v1.md
+
retained full detailed stage body
```

The domain contract supersedes contradictory legacy clauses.

## Brownfield implementation rule

Audit before deleting infrastructure, but do not preserve obsolete V1 product architecture for compatibility. Classify modules as KEEP, KEEP+RENAME, EXTEND, REFACTOR, REPLACE or DELETE BEFORE V2 RELEASE.

Final V2 release must remove superseded V1 generator paths, feature flags, prompt registry entries, dead schemas/types/tests/routes and production V1 invocation paths.

## Engineering conventions

- TypeScript/Hono/Cloudflare-native where existing infrastructure remains suitable.
- Secrets only through Cloudflare bindings/secrets; never generated assets.
- AI returns structured schema-validated outputs; application services perform idempotent writes.
- Prefer deterministic extraction/validation for machine-measurable facts.
- Persist Build-centric provenance, cost and error classification.
