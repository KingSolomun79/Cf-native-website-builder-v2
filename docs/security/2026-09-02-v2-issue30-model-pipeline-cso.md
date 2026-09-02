# CSO — Issue #30 Part 5: canonical LLM model routing + production pipeline wiring

**Date:** 2026-09-02 · **Scope:** pre-commit gate for the #30 prerequisite changes
(canonical `glm-5.3-flash` model routing; REFERENCE_BOUND production pipeline
orchestration, KIE v2 adapter, QA capture, workflow wiring, pipeline-start
route, screenshot-only evidence anchor, repair-loop image reuse).

## What was audited

Working-tree diff against `7246f34` touching: `src/lib/ai-gateway.ts`,
`src/lib/kie-v2.ts` (new), `src/domain/build-pipeline.ts` (new),
`src/domain/qa-capture.ts` (new), `src/workflows/website-build-workflow.ts`,
`src/routes/v2.pipeline-start.ts` (new), `src/index.ts`,
`src/domain/reference-intake.ts`, `src/domain/site-generator.ts`,
`src/domain/qa-evidence.ts` / `benchmark-runner.ts` (helper move),
`wrangler.jsonc` / `wrangler.test.jsonc` / `src/env.d.ts` / `src/types.ts`,
`scripts/verify-llm-model-routing.mjs` (new gate), tests + shared scripts.

## Attack-surface summary

- One new operator-facing route: `POST /api/v2/builds/:buildId/pipeline`
  (HMAC `X-Signature` with `WEBHOOK_SECRET`, same as all V2 intake routes).
- Outbound provider calls: ZAI/AI-Gateway chat completions (existing seam),
  KIE createTask/recordInfo/image download (new adapter, existing key),
  Cloudflare browser binding page loads of platform-deployed previews.
- No new secrets, no new bindings, no schema changes, no capability-route
  changes (Approval/Publication/Rollback untouched).

## Findings

- **Verified safe:** new route verifies the HMAC signature before any read or
  write and denies terminal-state Builds with 409; it only creates a workflow
  instance and never writes lifecycle rows. All pipeline SQL is
  parameterized (`reuseAcceptedImages` uses bound `INSERT ... SELECT ON
  CONFLICT DO NOTHING`). KIE `taskId` is URL-encoded; no key material is
  logged (only `charge`, `failMsg`, truncated `recordInfo`). The repair loop
  is structurally bounded: `repair_batches` UNIQUE(build_id, kind) caps one
  Fix Coordinator batch + one Release Blocker Fix; `resolveAfterConfirmation`
  escalates to `HUMAN_REVIEW_REQUIRED` once the budget is consumed; pipeline
  errors terminate in a recorded `FAILED` state instead of retry-spinning.
- **Model routing:** one canonical `LLM_MODEL` seam resolves `glm-5.3-flash`
  on every provider leg; provider failover keeps the exact same model (no
  model substitution path exists — `resolveModel` ignores the provider);
  provider-reported model identity is preferred in provenance; the hygiene
  gate (`scripts/verify-llm-model-routing.mjs`, wired into `npm test`) fails
  the build on any legacy model literal in executable routing. Tests pin
  request bodies, failure behavior (all-retry bodies carry the canonical
  model; total failure throws), and `ai_stage_runs.model`.
- **W-30a (watch, budget):** the USD 3.00 hard spend gate debits KIE tasks at
  the configured estimate (`KIE_TASK_COST_USD`, default $0.05). If real
  z-image pricing exceeds the estimate, the ledger under-counts. Mitigation:
  the operator verifies KIE pricing before the smoke and sets the var
  accordingly; KIE's `charge` field is logged for reconciliation.
- **W-30b (watch, operational):** the entire pipeline runs as one workflow
  step. A mid-flight platform eviction retries the step; evidence freeze and
  image generation are resume-idempotent (frozen package reuse; only slots
  without an acceptance regenerate), but AI stages re-run (token spend, new
  immutable artifacts appended). No correctness risk; bounded cost exposure.
- **L-30c (low):** `repairDirectives` are schema-validated, regex-guarded
  (`assertRepairPlanWithinBounds`) model text appended to generation prompts.
  The deterministic boundary (assembly validation + Technical Preflight +
  assets-only static deploy with no scripts) remains the actual containment;
  unchanged trust model.

## Severity summary

No Critical or High findings. One Low (L-30c), two Watch items (W-30a,
W-30b).

## Required remediation before commit

None blocking.

## Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

## Next best action

Commit the model-routing + pipeline-wiring changes, deploy the exact SHA to
`cf-website-factory-v2`, then begin the #30 production smoke (S1).
