# Issue #52 CSO — Idempotent Informed Assembly Repair

Date: 2026-09-06 · Scope: working-tree diff for issue #52 · Verdict: **SECURITY OK**

## 1. What was audited

- `src/domain/site-generator.ts` — the informed assembly-repair block now reuses a stored
  `{pageId}.assembly-repair-1` artifact only when its provenance fingerprint matches the current
  deterministic repair request; mismatch throws a terminal `StageArtifactError("REPAIR_ARTIFACT_MISMATCH")`.
  `runOrReuse` now returns the immutable stage-artifact key on both execution paths.
- `src/domain/stage-artifacts.ts` — `sha256Hex` exported; new `REPAIR_ARTIFACT_MISMATCH` error code.
- `src/domain/ai-boundary.ts` — optional `AiProvenance.repairRequestFingerprint`.
- `tests/v2-site-generator.test.ts` — four regression tests (store-once + provenance binding,
  zero-call engine re-entry with identical result, terminal mismatch, generate-exactly-once with no
  attempt escalation and no repair-budget touch).

## 2. Security scope

No auth, authorization, secrets, payment, webhook, or public-endpoint surface is touched. The change
is internal to the Build workflow's generation stage and its artifact store. No new routes, no new
external inputs, no new provider surfaces.

## 3. Attack-surface summary

The only trust-relevant transition is artifact reuse: a stored repair artifact is now trusted as the
outcome of a replayed stage **only** when a sha256 fingerprint over the full deterministic request
(build/version/page/attempt, directive-set hash, immutable input checksums, blueprint/contract keys)
matches. All fingerprint inputs are server-side (UUIDs, frozen artifact checksums, findings derived
from frozen artifacts); none are attacker-controlled. D1 access remains parameterized.

## 4. Findings

No Critical/High/Medium findings.

- Fail-closed behavior verified: provenance mismatch → terminal domain error, no overwrite, no
  regeneration, no budget consumption (covered by test).
- Integrity improvement: the production wedge (~22 redundant provider calls per retry cycle) is
  structurally impossible; reuse requires cryptographic request identity.

## 5. Severity summary

None new. Prior #50 CSO watch items (2 low) are untouched by this diff.

## 6. Required remediation

None.

## 7. Watch items

- `provenance_json` now mixes AI-run provenance with the request fingerprint. Structured and typed;
  acceptable. If more binding classes appear later, consider a namespaced `binding` sub-object
  (the fingerprint payload already carries `binding: "assembly-repair/1"` internally).

## 8. Final security verdict

**SECURITY OK**

## 9. Next best action

Commit as the dedicated issue #52 commit; proceed to issue #53 (trust-lint semantics), which must
reuse this same fingerprint/contract seam when the truth contract is propagated into repair prompts.
