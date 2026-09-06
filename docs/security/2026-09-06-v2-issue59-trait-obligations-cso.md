# CSO — #59 Reference Analysis / Blueprint Trait Obligation Contract

Date: 2026-09-06 · Scope: uncommitted #59 diff (dedicated commit follows)

### 1. What was audited

`reference-analysis/2` schema cap (3–8 signature traits), `visual-blueprint/2`
trait obligation ledger + rewritten identity validator + clause-authority
check, `evaluateBlueprintCoverage` ledger read, runtime prompt v5 changes,
`stripEmptyStrings` boundary normalization, frozen production fixtures, test
updates, canonical doc updates.

### 2. Security scope

No auth, secrets, payments, webhooks, public endpoints, routes, D1 query
surfaces, or R2 access patterns are touched. The change sits entirely inside
the AI-output trust boundary (schema validation / normalization of untrusted
model output) and its canonical documentation.

### 3. Attack-surface summary

The only attacker-controllable input in scope is the LLM response consumed by
`runSchemaValidatedAiStage`. #59 changes how that untrusted payload is
normalized (empty-string stripping) and which deterministic gates it must
satisfy (obligation ledger with exact coverage, region-reference existence,
clause authority).

### 4. Findings

1. **Verified-safe — `stripEmptyStrings` is fail-closed.** It removes only
   empty-string values from model JSON (same philosophy as the existing
   null-strip). A `""` supplied for a REQUIRED field becomes "required
   property missing" and still fails validation; for optionals it converts to
   canonical absence. No value is invented; nothing unread is trusted.
2. **Verified-safe — ledger cannot be satisfied by fabrication.**
   `sourceTraitId`s must equal the frozen analysis identity-trait set exactly
   (no unknowns, no duplicates, no extras); PRESERVED requires
   `realizedByRegionIds` that resolve to real canonical regions; ADAPTED
   requires an `adaptationClauseId` that exists in the frozen Adaptation
   Contract. The model chooses only among frozen authorities.
3. **Watch item (Low) — clause authority is lexical.** The clause↔trait
   relation check is token overlap between the frozen clause id and the
   frozen analysis trait description/evidence text. A trait description
   sharing a generic token with an unrelated clause could be "authorized"
   deterministically. Exposure is bounded: the contract is frozen
   pre-generation with a handful of clauses, and the downstream #42 coverage
   gates, region provenance, QA-A hard gates and macro-fidelity gate remain
   unchanged and authoritative. Accepted for #59; revisit only if production
   shows abused dispositions.
4. **Verified-safe — fixtures.** Frozen RankForge production analysis/evidence
   contain public reference-site measurements only; no credentials, no
   business-secret data, no PII beyond the already-public fixture business.
5. **No new denial-of-service surface.** `traitObligations` is capped
   (maxItems 16) consistent with existing stage-schema conventions; provider
   responses remain bounded by existing gateway limits.

### 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 1 (watch item above)

### 6. Required remediation

None for this commit.

### 7. Watch items

Lexical clause-authority anchoring (finding 3) — observe production
dispositions after the remediation retest; tighten only on evidence.

### 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE**

### 9. Next best action

Commit #59 as delivered; proceed to #60 (Blueprint repair convergence) under
the operator's standing GO, then stop before production.
