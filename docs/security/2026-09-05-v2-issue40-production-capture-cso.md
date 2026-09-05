# CSO — Issue #40: Production Reference Capture + Modern Capture Contract

**Date:** 2026-09-05
**Scope:** env/BROWSER threading into the production reference capture, bounded multi-signal capture sequence, `unreliable_scroll_flattening` suitability hook.
**Verdict:** SECURITY OK FOR CURRENT SCOPE

## 1. What was audited

- `src/domain/reference-intake.ts`: `createProductionReferenceCapture(env)` replaces the zero-env `defaultProductionCapture` (`launch(undefined)` unreachable by construction; pre-launch BROWSER guard with a precise error). New bounded capture sequence: overlay-dismissal probes, real scroll sweep with settles, viewport checkpoints, post-sweep layout, canonical full page, bounded mobile pass. `flatteningSignal` exported for tests.
- `src/domain/reference-evidence-schema.ts`: new limitation kind `unreliable_scroll_flattening` (flows into Reference Suitability; SUPPORTED_WITH_LIMITATIONS semantics with mandatory Adaptation Contract).
- `tests/helpers/browser-fixtures.ts`: optional `sections` scenario override (defaults unchanged).
- `tests/v2-reference-capture.test.ts`: production-wiring seam tests (launch receives the env; missing BROWSER fails closed pre-launch; intake default path is env-bound).

## 2. Security scope

Touches: use of the BROWSER binding (Worker-scoped), automated interaction with EXTERNAL reference sites (clicks), D1/R2 evidence writes. No auth, secrets, payments, webhooks, or new public endpoints.

## 3. Attack-surface summary

The capture performs up to `MAX_OVERLAY_DISMISSALS = 3` clicks on external pages, each gated by a typed `countMatches` probe and restricted to cookie/consent/close selectors. No credentials or platform data are sent to reference sites; the browser session is the Cloudflare BROWSER isolate. Failure notes and dismissals are recorded in evidence discrepancies (auditability). The BROWSER binding value never enters logs or error messages — the guard error is static text.

## 4. Findings

None Critical/High/Medium.

Watch items:

1. **Automated clicks on third-party pages (Low).** The dismissal heuristic may click an "accept" control on a reference site. Bounded (≤3), selector-restricted, recorded per-click in evidence discrepancies, and never targets forms or navigation (safe-form controls excluded by selector construction). Acceptable for evidence capture; monitor if selectors are ever broadened.
2. **Capture fan-out cost (Low, operational).** Each URL intake now persists up to 8 checkpoints + canonical + mobile captures to R2 (build-scoped evidence keys, private bucket, retention-managed). No public exposure; disposal handled by existing retention enumeration.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 · Watch items 2 (low, operational).

## 6. Required remediation

None for this scope.

## 7. Watch items

See findings 1–2. The P0 reliability defect (production URL capture crash) is closed; staging verification of the real Playwright path remains part of the #46 production retest.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE.**

## 9. Next best action

Proceed to #41 (Reference Visual Package + deterministic evidence extraction).
