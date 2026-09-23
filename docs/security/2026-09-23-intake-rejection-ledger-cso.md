# CSO — Intake rejection ledger (incident remediation Step 1)

**Date:** 2026-09-23 · **Scope:** uncommitted working tree for the operator-approved intake-remediation plan, Step 1 (rejected-attempt durability). Audited files: `migrations/0041_rejected_intake_attempts.sql`, `src/routes/public-client-intake.ts`, `src/domain/intake-draft.ts`, `src/routes/admin-pages.tsx`, `tests/v2-client-intake.test.ts`, `v2-docs/CLIENT-INTAKE-PUBLIC-CONTRACT.md`.

## 1. What was audited

The public client-intake endpoint gained a bounded REJECTED ledger: parsed submissions rejected by the rate limiter, schema validation or Turnstile now persist a `client_intake_drafts` row (raw body minus the Turnstile token, best-effort labels, `rejection_reason`) instead of vanishing without trace. The rate limiter moved BEFORE validation/Turnstile so ledger writes are budget-bounded. Admin surfaces gained a rejected badge, a diagnostic page for malformed rejected bodies, and a rescue path for valid rejected payloads.

## 2. Attack-surface summary

- `POST /api/public/client-intakes` (unauthenticated, origin-allowlisted, Turnstile-gated for acceptance)
- New durable write path on rejection (D1, parameterized)
- Admin rendering of raw stored payloads (Cloudflare Access-gated Worker pages)

## 3. Findings

**F1 — Write amplification via the ledger (Low, mitigated).** Every parsed, origin-valid attempt may now cost one durable write (≤5 validation/turnstile rejection rows + ≤1 boundary `RATE_LIMITED` row per source per window; blocked windows record once). Bounded by the unchanged 5/hour hashed-IP window; unparseable/oversize/foreign-origin traffic still earns zero writes. Distributed abuse has per-IP bounds exactly like the pre-existing accepted-draft write. No unbounded path introduced.

**F2 — Raw unvalidated payloads at rest (Low).** Rejected bodies (≤64 KB, capped before parse) are stored verbatim minus `turnstileToken`. Rendered only on Access-gated admin pages through hono JSX text interpolation (auto-escaped; the diagnostic `<pre>` renders `JSON.stringify` as escaped text; `dangerouslySetInnerHTML` carries only the static editor script with a server-generated id — pre-existing pattern). No public surface exposes rejected rows.

**F3 — Turnstile token handling (pass).** The token is deleted before storage; a regression test asserts `payload_json` never contains it. siteverify secret is never logged; `persistRejection` logs only the D1 error message with quotes stripped, no payload, no secrets.

**F4 — Platform-misconfiguration recording (Watch).** A missing `CLIENT_INTAKE_TURNSTILE_SECRET_KEY` records `TURNSTILE_FAILED` rows for genuine submissions. Intentional (the 2026-09-23 incident class is exactly this), bounded by the rate window, and visible to the operator — acceptable.

**F5 — Rejected-draft lifecycle (pass).** Rejected rows can never start generation by themselves: conversion still requires the explicit admin `validate-and-generate` action over a payload that passes full canonical validation. Rejected rows carry no `converted_*` markers (test-enforced). `editIntakeDraft`'s REJECTED→IN_REVIEW transition is admin-gated and pre-conversion only.

**F6 — Migration safety (pass).** 0041 rebuilds `client_intake_drafts` (no FK/trigger dependencies per 0037), preserves all rows/columns, and is re-runnable by construction (the final `CREATE INDEX` succeeds because the old index died with the dropped table).

## 4. Watch items

- `client_intake_drafts` (now including REJECTED rows with submitter PII) still has no retention/cleanup policy — pre-existing gap, slightly enlarged surface; candidate for a future retention issue.
- Operator visibility of ledger rows depends on the `/admin/intakes` list (limit 200); high rejection volume could push old accepted drafts off the list. Acceptable at current volumes; revisit if abused.

## 5. Verdict

**SECURITY OK WITH WATCH ITEMS** — no Critical/High findings. Proceed to commit and deployment behind the standard gates.
