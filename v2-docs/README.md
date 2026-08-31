# WAZIBIZ Website Builder V2 Documentation

This folder is the canonical implementation package for Website Builder V2.

## Source-of-truth order

The coding agent must read these documents in this order:

1. `IMPLEMENTATION-PRD.md` — **normative implementation specification**. This wins if any older file or prompt conflicts with it.
2. `CAPABILITY-ENVELOPE.md` — human-readable product support boundary.
3. `capability-envelope.json` — machine-readable support boundary.
4. `FINAL-DECISION-RECORD.md` — locked decisions from the final grilling session and their rationale.
5. `prompts/*` — stage prompts. These remain important, but must be reconciled with the final PRD before runtime use.

Older root documentation and V1 implementation are historical/infrastructure context only unless explicitly retained by the V1 fork audit.

## Repository strategy

This repository is a fork of the original V1 builder. V1 remains preserved in its own repository. During V2 implementation, proven infrastructure may be reused from the fork, but all superseded V1 product logic must be removed before V2 release.

Final rule:

> Keep the proven platform code. Delete the superseded product logic.

## Locked implementation sequence

V2 is developed in this order:

```text
REFERENCE_BOUND
  -> fixed five-site benchmark
  -> minimum 3/5 fully automated PASS
  -> then ORIGINAL_DESIGN
```

A benchmark PASS allows no manual source-code edits and must stay inside the hard KIE generation budget of USD 3.00/site.

## Canonical REFERENCE_BOUND workflow

```text
Client Intake
  -> Normalize Business Truth
  -> Reference Suitability Gate
  -> Reference acquisition
  -> deterministic ReferenceEvidence extraction
  -> Reference Analyzer
  -> Visual Blueprint Generator
  -> Implementation Planner
  -> incremental shared-contract site generation
  -> runtime schema validation + deterministic validation
  -> IMAGE_PLAN
  -> KIE image generation Wave 1
  -> KIE image generation Wave 2
  -> persist accepted assets to project-controlled storage
  -> site assembly
  -> Technical Preflight
  -> preview deployment
  -> standardized QA evidence capture
  -> Visual Geometry Comparator
  -> QA-A + QA-B independently
  -> Fix Coordinator (one batch maximum)
  -> QA-A/QA-B Confirmation
  -> optional single Release Blocker Fix
  -> failed confirmation domain(s) once more
  -> READY_FOR_APPROVAL or HUMAN_REVIEW_REQUIRED
  -> explicit human approval
  -> immutable build publication
```

## Important final changes versus earlier prompt drafts

The final grilling introduced several requirements that older prompt files do not all contain yet:

- Reference Suitability Gate.
- Versioned deterministic `ReferenceEvidence` contract.
- Implementation Planner between Blueprint and Website Generator.
- Incremental file generation under one shared Implementation Contract.
- Runtime validation at every AI boundary.
- Hard visual composition gates in addition to QA-A score >=90.
- Two-wave KIE generation with hard USD 3.00/site ceiling.
- Immutable stage/build artifacts and provenance.
- Visual Geometry Comparator.
- Fixed five-site benchmark with 3/5 automatic PASS threshold.
- Design archetypes are non-authoritative.
- Generated customer sites remain framework-light/static.
- Central multi-tenant WAZIBIZ Form Service using Cloudflare-native outbound email.
- Turnstile, origin validation and rate limiting for public Contact forms.
- V1 cleanup as a V2 acceptance gate.

### Form prompt conflict

Any older prompt clause saying the Contact form has no backend, must not submit, or must not contain real submission behavior is **obsolete**.

The final architecture is:

```text
static Contact form
  -> central WAZIBIZ Form Service
  -> validation + Turnstile + rate limit
  -> SiteFormConfig recipient lookup
  -> Cloudflare-native outbound email
```

Generated browser code must never choose the email recipient or sender.

## Existing stage prompts

- `prompts/01-reference-analyzer-v2.md`
- `prompts/02-visual-blueprint-generator-v2.md`
- `prompts/03-original-design-blueprint-generator-v2.md`
- `prompts/04-website-generator-v3.md`
- `prompts/05-kie-image-prompt-generator-v1.md`
- `prompts/06-qa-a-visual-content-v2.md`
- `prompts/07-qa-b-browser-technical-v2.md`
- `prompts/08-fix-coordinator-v2.md`
- `prompts/09-qa-a-confirmation-v2.md`
- `prompts/10-qa-b-confirmation-v2.md`
- `prompts/11-release-blocker-fix-v1.md`

Before these prompts are wired into V2 runtime, reconcile them with `IMPLEMENTATION-PRD.md`. The PRD contains the mandatory reconciliation list.

## Hard automation limit

The mutation budget remains deliberately bounded:

1. Initial generation.
2. One Fix Coordinator batch.
3. At most one Release Blocker Fix batch.

If confirmation still fails, automated mutation stops and the build becomes `HUMAN_REVIEW_REQUIRED`.

## First coding milestone

Start with the brownfield audit and migration manifest. Do not begin by rewriting working Cloudflare/KIE/browser infrastructure. Identify what is reusable, then build the V2 contracts and pipeline cleanly around it.
