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
