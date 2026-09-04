# CSO Review — #38 Confirmation QA Resolution Semantics

Date: 2026-09-04
Scope: uncommitted working tree for issue #38 (confirmation ACTIVE/RESOLVED finding status)
Files: `src/domain/qa-stages.ts`, `src/domain/automated-repair.ts`, plus tests
(`tests/helpers/pipeline-scripts.ts`, `tests/v2-automated-repair.test.ts`,
`tests/v2-build-pipeline.test.ts`, `tests/v2-release-qa.test.ts`).

## 1. What was audited

The #38 change set: confirmation QA reports now carry a REQUIRED structured
`status: "ACTIVE" | "RESOLVED"` on every finding; the release evaluators
(`evaluateQaARelease`/`evaluateQaBRelease`/`isReleaseBlocker`) count only
non-RESOLVED P0/P1 findings as Release Blockers; the confirmation stage prompt
instructs explicit classification (RESOLVED = fixed prior defect with ORIGINAL
severity, ACTIVE = unfixed / partially fixed prior blocker / NEW defect);
confirmation schemas version separately (`qa-a-confirmation/2`,
`qa-b-confirmation/2`). Fresh QA-A/QA-B schemas are byte-identical to before
(additionalProperties: false — they cannot carry `status`).

## 2. Security scope

Domain-layer QA/repair semantics only. No auth, no secrets, no public
endpoints, no payment, no data deletion, no new external input surface. The
only "untrusted" input is LLM output at the confirmation seam, already behind
the schema-validation boundary. `build-pipeline.ts` remains the sole
production caller of `runConfirmationQa`/`resolveAfterConfirmation`.

## 3. Attack-surface summary

Model-controlled confirmation output → schema validation boundary → release
evaluation → Release Ready / repair / human review. The question is whether
the new RESOLVED classification widens what a misbehaving (or prompted) model
can push to Release Ready.

## 4. Findings (PART 14 focus areas)

### 4.1 Fail-open confirmation parsing — VERIFIED SAFE
`status` is a required closed union on confirmation findings. Missing status
(including `null`, stripped by the boundary's `stripNulls`), unknown values
(`"resolved"`, `"fixed"`, natural-language variants) all fail
`Value.Check` → one targeted structural repair → still invalid →
`AiStageSchemaInvalidError` → the pipeline's FAILED terminal. No path parses
unvalidated confirmation data. Regression-tested: the exact production
legacy shape (P1 note without status) fails the stage with NO release record
(seam test) and is rejected at the schema level (unit test).

### 4.2 Severity suppression — VERIFIED SAFE (no regression)
A finding marked RESOLVED is excluded ONLY from the P0/P1 blocker count. All
other release conjuncts are untouched and independent: visual/content/technical
score thresholds (>=90), fabrication, hard composition gates, mandatory QA-B
gates. A resolution note can never average away a failed gate or a low score.

### 4.3 Model-controlled status manipulation — WATCH ITEM (pre-existing trust boundary, not widened)
A misbehaving confirmation model could mark a genuinely-present defect as
RESOLVED with healthy scores. Backstops: scores/gates/fabrication remain
independent conjuncts; the stored `qa_report` artifact and the immutable
`ai_stage_runs` R2 artifacts retain the full status-carrying findings for
audit. Critically, this trust surface is IDENTICAL to fresh QA, where the
model already assigns severities (a P2 mis-classification suppresses a
blocker identically). #38 does not widen it: RESOLVED status only stops
resolution RECORDS from being counted as active blockers — it adds no
authority to skip scores or gates.

### 4.4 Malformed schema handling — VERIFIED SAFE
Parse → validate → one structural repair → fail is unchanged
(`runSchemaValidatedAiStage`). No new tolerant parsing was added anywhere.

### 4.5 Release Ready bypass — VERIFIED SAFE
`assignReleaseReady` uses the SAME evaluators as `resolveAfterConfirmation`
(single evaluation path — no divergence possible). Thresholds, gate lists,
P0/P1 definitions for fresh QA are byte-identical. The `resolved` bucket is
informational: it never enters `blockers`, never produces a reason, and
cannot be re-counted later. Repair budgets (one Fix Coordinator batch + one
Release Blocker Fix) are untouched — the #34 retry tests still enforce the
ceiling (release_blocker_fix still blocks when a genuine ACTIVE blocker
remains).

### 4.6 Prompt/resolver disagreement — VERIFIED ALIGNED
Prompt: RESOLVED = fixed prior defect, original severity, never blocks;
ACTIVE = present (incl. partially fixed) or NEW; do not claim RESOLVED
without evidence. Resolver: `status !== "RESOLVED"` fails closed as ACTIVE;
only `status === "RESOLVED"` is exempt. The fail-closed default matches the
"do not assume resolved" rule: absent/ambiguous status can never produce
Release Ready.

### 4.7 New blocker handling — VERIFIED SAFE
New defects discovered during confirmation are instructed ACTIVE and counted
(unit tests E/F) → RELEASE_BLOCKER_FIX_ALLOWED → the one narrow Release
Blocker Fix → terminal HUMAN_REVIEW_REQUIRED if still blocked (lifecycle
test). No new defect can be dismissed via RESOLVED without the model also
asserting scores/gates — the pre-existing trust model.

## 5. Severity summary

- Critical: none.
- High: none.
- Medium: none.
- Low / watch items: 4.3 (model-controlled status manipulation — pre-existing
  LLM-evaluator trust boundary, unchanged by #38, mitigated by independent
  score/gate conjuncts and immutable evidence artifacts).

## 6. Required remediation

None blocking.

## 7. Watch items

- If a production confirmation ever marks a defect RESOLVED while its
  measured evidence (scores/gates) degrades, treat it as a QA-integrity
  incident: the `qa_report` artifact + `ai_stage_runs` R2 records carry the
  full status-bearing findings to support that audit.
- The retained prompt bodies (09/10) still describe a richer legacy output
  contract; the runtime output contract (JSON Schema in the user prompt)
  governs. If the bodies are ever reconciled, keep the ACTIVE/RESOLVED rule
  verbatim.

## 8. Final security verdict

SECURITY OK FOR CURRENT SCOPE

## 9. Next best action

Commit the implementation, deploy the exact SHA, and resume #30 with exactly
one new Revision Request to prove the fix on the real repaired candidate
(production confirmation should now report the prior first-viewport P1 as
RESOLVED without consuming the Release Blocker Fix budget).

---

## Addendum (final #30 CSO gate, 2026-09-04T22:0xZ) — production verification

Post-deployment production run (worker version 257ea70c, code SHA b604354):

- **Resolved-status semantics held in production**: the repaired candidate's
  confirmation emitted four findings, all original-P1 severity with
  `status: RESOLVED` (the exact #38 pattern); the release record shows
  `releaseBlockers: 0`, verdict RELEASE_READY, visual 92 / content 94 /
  technical 92, no failed gates. The Release Blocker Fix budget was not
  consumed.
- **Capability flows exercised and denied correctly**: an `approve` capability
  against the publication endpoint → 403 CAPABILITY_INSUFFICIENT; a separate
  `publish` capability published the exact approved hash
  (4ade328b…7ec); a rollback capability stale relative to the now-current
  publication state → 403 CAPABILITY_INSUFFICIENT (no redirect to an
  unintended version). Token contents were never recorded in evidence.
- **Form Service origin enforcement** verified fail-closed live (403
  ORIGIN_NOT_ALLOWED without an allowed Origin; 202 Accepted Submission with
  it) and production Email Delivery returned `delivered` (attempt 1, platform
  sender identity notifications@wazibiz.ke).
- **No V1 fallback**: V2 route table only; V1 worker (cf-website-factory),
  D1 (website_factory_v1) and R2 (website-factory-assets) identities unchanged
  (V1 last deployed 2026-08-19, version dc99fb34, predating all V2 work).
- No secrets, capability tokens or visitor PII recorded in this report or the
  issue evidence.

### Final verdict (incl. addendum)

SECURITY OK FOR CURRENT SCOPE
