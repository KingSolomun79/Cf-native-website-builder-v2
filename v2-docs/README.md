# WAZIBIZ Website Builder V2 Documentation

This folder is the canonical implementation package for Website Builder V2.

## Repository strategy

This repository is a fork of the original V1 builder. V1 remains preserved in its own repository. During V2 implementation, proven infrastructure may be reused from the fork, but all superseded V1 product logic must be removed before V2 release.

Final rule:

> Keep the proven platform code. Delete the superseded product logic.

## Documents

- `IMPLEMENTATION-PRD.md` — complete V2 product requirements, architecture, workflow, migration and rollout guide.
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

## Canonical workflow

```text
Client Intake
  -> Normalize Business Truth
  -> Select REFERENCE_BOUND or ORIGINAL_DESIGN
  -> Reference acquisition/analyzer when applicable
  -> Visual Blueprint
  -> Website Generator v3
  -> Deterministic validation
  -> IMAGE_PLAN
  -> KIE Image Prompt Generator
  -> KIE.ai generation
  -> Persist accepted assets to R2
  -> Site assembly
  -> Preview deployment
  -> Browser evidence
  -> QA-A + QA-B independently
  -> Fix Coordinator
  -> QA-A Confirmation + QA-B Confirmation
  -> optional one Release Blocker Fix
  -> failed confirmation domain(s) once more
  -> Human approval or HUMAN_REVIEW_REQUIRED
```

## Hard automation limit

The automated mutation budget is intentionally bounded:

1. Initial generation.
2. One Fix Coordinator batch.
3. At most one Release Blocker Fix batch.

If confirmation still fails after that, stop automated mutation and require human review.

## Implementation note

The first implementation milestone is a brownfield audit of this fork. Reuse infrastructure only after inspection. Do not preserve old V1 generation intelligence merely for compatibility; V1 already exists as a separate repository.
