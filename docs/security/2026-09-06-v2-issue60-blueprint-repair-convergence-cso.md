# CSO — #60 Blueprint Repair Convergence

Date: 2026-09-06 · Scope: uncommitted #60 diff (dedicated commit follows)

### 1. What was audited

Informed-constrained Blueprint repair (rejected blueprint verbatim +
deterministic findings + binding trait set + preservation set in the repair
prompt), `deriveBlueprintPreservationSet`, terminal escalation
(`BLUEPRINT_REVIEW_REQUIRED` → `HUMAN_REVIEW_REQUIRED` after the single
informed repair, caught inside the durable step so no engine retry storm),
frozen seven-candidate replay fixtures, whack-a-mole and RankForge
convergence tests.

### 2. Security scope

No auth, secrets, payments, webhooks, public endpoints, routes, D1 query
surfaces or R2 access patterns change. The change is pipeline control flow
around the AI-output trust boundary established in #59.

### 3. Attack-surface summary

The model-controlled repair response now additionally receives the rejected
blueprint verbatim in the prompt. Prompt-injection theoretically flows
model-output → next prompt; the exposure is unchanged in kind (the repair
prompt already carried model-influenced rejection messages), and the output
remains fully gated by the deterministic validators: nothing a repair
response says can bypass the ledger, provenance, lint, or consistency gates.
Escalation is fail-closed: a second rejection routes to human review and
produces no downstream artifacts.

### 4. Findings

1. **Verified-safe — escalation is fail-closed.** The step resolves with a
   domain marker only for `VisualBlueprintError` (deterministic validation
   codes). Every other error (transient platform faults, schema-invalid
   boundary runs) keeps the existing retry semantics; a resolved marker
   emits the `HUMAN_REVIEW_REQUIRED` event and returns before any
   implementation, image or QA work runs (asserted by test: zero contract
   artifacts after escalation).
2. **Verified-safe — bounded spend.** Exactly two semantic blueprint calls
   are possible per step execution (initial + one informed repair); the
   escalation removes the 8-attempt × 2-call retry storm observed in
   production on 2026-09-06. Cost ceiling is enforced by control flow, not
   by model goodwill.
3. **Verified-safe — preservation set is advisory-to-model,
   deterministic-to-gate.** The preservation set constrains the prompt, but
   compliance is enforced by re-running the full deterministic gate suite on
   the repair output; a rotating repair is rejected and escalates
   (whack-a-mole test).
4. **No new injection or data exposure.** Frozen production candidate
   fixtures contain public reference-site measurements only.

### 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0

### 6. Required remediation

None.

### 7. Watch items

None new. The #59 lexical clause-authority watch item stands.

### 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

### 9. Next best action

Commit #60 as delivered; stop before production per the operator directive
(no deploy, no RankForge until operator review).
