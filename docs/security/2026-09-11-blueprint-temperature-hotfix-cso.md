# CSO sign-off — blueprint sampling hotfix (2026-09-11)

## What was audited

Working-tree diff during the V2 production rollout generation smoke:

- `src/simple-design/vision.ts` — `createSimpleVisionGenerate` options gain an
  optional `temperature`, forwarded to the Coding Plan request body.
- `src/simple-design/design-blueprint.ts` — the blueprint stage pins
  `temperature: 0.3` (hardcoded constant).
- `tests/v2-zai-coding-plan.test.ts` — contract test: default 0.7, override
  honored.

## Context (failure evidence)

First production generation smoke: blueprint stage failed
`SCHEMA_INVALID` on both allowed attempts (attempt 1: unexpected
`globalChrome/states`; attempt 2: missing required
`imagery/pageHeroes/contact/altText`) at the provider-default temperature 0.7.
Domain behavior was correct (`BLUEPRINT_REVIEW_REQUIRED` →
`HUMAN_REVIEW_REQUIRED`, immutable `ai_stage_runs` rows). Fix targets sampling
determinism only.

## Security scope

- No auth, authorization, secrets, webhooks, payment, D1 access, or route changes.
- No gate, repair ceiling, schema, or threshold changes (verification: diff).
- The value is a compile-time constant from caller code; no user-controlled
  input reaches the request body through this path.

## Findings

None blocking. All model output continues to pass the strict TypeBox schema
(`additionalProperties: false`) plus the existing normalization pipeline before
any use; the change alters sampling randomness only, not validation strength.

### Watch items

1. `ai_stage_runs` provenance records model/provider/attempt but not sampling
   parameters; future provenance work may want to record them.
2. The new option is available to all `createSimpleVisionGenerate` callers;
   visual-qa intentionally keeps the provider default for now.

## Verdict

**SECURITY OK WITH WATCH ITEMS**

---

# Addendum: builder invented-structure review mapping (2026-09-11, later)

## What was audited

Second production smoke exposed a second defect class: the Website Builder's
DOM-first selector gate (`cssSelectorFailures`) threw
`SimpleWebsiteBuilderError("SOURCE_INCOMPLETE")`, which the pipeline did not
map in-step — the non-transient error escaped, killed the Workflow instance,
and the build was recorded `FAILED`/`WORKFLOW_EXECUTION_EXHAUSTED` instead of
reaching a domain terminal. Changes:

- `website-builder.ts` — the invented-structure gate throws a dedicated
  `INVENTED_STRUCTURE` code; the builder's six Coding Plan coding calls pin
  `temperature: 0.3` (same rationale as the blueprint fix).
- `pipeline.ts` — deterministic builder gates (`CRITICAL_IMAGE_COVERAGE`,
  `INVENTED_STRUCTURE`) now return the in-step review terminal (the #62 §7
  pattern); other codes unchanged.
- Tests: stale §19e assertion updated to the new code; new pipeline-level
  test proves the review terminal with one Build Version, no repair, no
  bundle.

## Security scope

No auth, secrets, webhooks, routes, or data-access changes. The gate itself
(validated selector anchors) is unchanged — only its failure ROUTING, which
moves from an instance-level error to the domain's designed
HUMAN_REVIEW_REQUIRED terminal. Human review of a review-required build is
already capability-gated (`OPERATOR_CAPABILITY_SECRET`).

## Findings

None blocking. Watch items from the main note stand (sampling params in
provenance).

## Verdict

**SECURITY OK WITH WATCH ITEMS**

