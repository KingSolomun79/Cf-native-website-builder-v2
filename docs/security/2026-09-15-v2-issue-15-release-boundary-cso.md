# CSO — Issue #15: Approval, Publication and Rollback (privileged release boundary), 2026-09-15

Scope: the #15 release-lifecycle surface as merged — `POST
/api/v2/build-versions/:buildVersionId/approval`, `POST
/api/v2/build-versions/:buildVersionId/publication`, `POST
/api/v2/sites/:siteId/rollback`, `src/domain/publication.ts`,
`src/lib/operator-capability.ts`, retention interplay — audited against the
#15 acceptance criteria and the privileged-operation trust boundary. The #15
diff under review is TEST-ONLY evidence hardening in
`tests/v2-publication.test.ts` (see §4.3); the audit additionally re-reviewed
the production boundary those tests pin, because this surface performs
privileged release operations. Gates: `npm test` 48 files / 542 tests passed,
`npm run typecheck` clean.

## 1. What was audited

- The three operator routes: fixed denial order (401 absent/invalid/expired
  token → 403 wrong action / wrong build / wrong version / manifest mismatch
  → domain 404/409), authorization fully preceding mutation.
- The capability-token model: HMAC over `OPERATOR_CAPABILITY_SECRET`,
  action-bound (`approve` / `publish` / `rollback` are mutually
  structurally insufficient), resource-bound (buildId + buildVersionId +
  artifactManifestHash, or siteId + fromBuildVersionId), short-lived with an
  expiry ceiling, fail-closed when the secret is unset (sandbox denies all).
- `publishApprovedBuildVersion`: approval-for-this-exact-version requirement,
  approval-hash drift guard, `expectedArtifactManifestHash` mutation-boundary
  TOCTOU guard, exact bytes loaded from immutable R2 via manifest (no
  regeneration path), attempt ledger, idempotent current-version
  short-circuit, single retained rollback slot, `ROLLBACK_WINDOW_DAYS`
  enforcement.
- `rollbackPublication`: window check, conditional state flip bound to the
  authorized current version, no Build/Build Version/Approval creation, site
  configuration untouched.
- The test diff: real `APPROVAL_HASH_MISMATCH` regression (previously the
  drift test had degraded into no-op assertions — a genuine evidence gap on a
  privileged path, now closed), three-version rollback-candidate rotation,
  retry-cannot-drift-to-latest, no-new-Build assertions.

## 2. Security scope

Privileged release operations: authorization, capability integrity,
exact-artifact identity, auditability of state transitions, destructive-ish
operational actions (publish/rollback swap live state). No payment flows. No
public endpoints. No secrets handling changes.

## 3. Attack-surface summary

- Three bearer-token operator routes; the only callers are holders of a
  capability minted offline with the operator secret. Tokens cannot be
  self-minted, are expired+ceilinged, pinned known-answer vectors agree with
  the offline mint script, delimiter-smuggling in bound values is rejected,
  and verification is timing-safe (prior #29/#31 CSOs; regression suites).
- Cross-cutting drift defenses at TWO layers: the route re-derives the
  version's current manifest and compares it to the token; the domain
  re-enforces both the authorized hash and the standing approval hash at the
  mutation boundary. A publication or rollback landing between authorization
  and mutation cannot redirect the deploy (tested both directions).
- The default publish deployer is the assets-only Worker path — no main
  module, no bindings, no secrets in published artifacts (H1-remediated
  path, re-verified by `tests/v2-static-deploy.test.ts`).
- Auditability: every approval, publication attempt (including failures with
  bounded error text ≤500 chars) and rollback appends immutable workflow
  events / `publications` rows; approvals are trigger-immutable.

## 4. Findings

None blocking.

1. **Watch item (Low, pre-existing):** the `PUBLISH_FAILED` route response
   embeds the deployer error text (≤500 chars, also persisted). Caller must
   already hold a publish capability, so this is operator-to-operator
   diagnostics, not an exposure boundary. No action.
2. **Watch item (Low, pre-existing):** the operator routes have no rate
   limiting; the capability's short expiry and HMAC gating bound brute-force
   value, and D1 verification cost per attempt is trivial. Consistent with
   the accepted #29/#31 posture. No action.
3. **Positive finding (this diff):** the domain-level
   `APPROVAL_HASH_MISMATCH` guard previously had NO real regression test (the
   old drift test asserted nothing after the immutable-artifact constraint
   made its simulation impossible). The new test constructs the drifted state
   by direct seeded approval row and proves refusal with zero deployment and
   zero publication records — the privileged path's evidence is now real.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 2 (both pre-existing watch items).

## 6. Required remediation

None.

## 7. Watch items

Findings 1–2, recorded; both inherit the accepted posture of the #29/#31
CSOs. Cloudflare Access remains operator AUTHENTICATION for the admin surface
only; release AUTHORITY stays exclusively the action-bound capability tokens —
the authority model was not weakened (nothing in #15 touched it).

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** (no new findings; the diff strictly improves
regression evidence on the privileged boundary).

## 9. Next best action

Commit #15 (test-evidence hardening; no production code change), record the
SHA + CSO disposition on the issue, close #15, then proceed to #16 per
AGENTS.md.
