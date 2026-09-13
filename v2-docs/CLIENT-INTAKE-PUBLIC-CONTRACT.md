# WAZIBIZ Client Intake — Public Contract

**Status: AUTHORITATIVE for the wazibiz.ke website form mapper** (operator GO 2026-09-12; business-hours midnight rule corrected per the 2026-09-12 integration blocker correction).

This document is the single source of truth for the payload the public WAZIBIZ website form sends to the builder's public intake endpoint. Where any other document, example code or mapper implementation disagrees with this file, **this file wins**.

## Endpoint

`POST /api/public/client-intakes` (served by the V2 builder Worker)

- Requires header `Origin: https://wazibiz.ke` (strict allowlist; no other origin is accepted).
- Body: JSON, max 64 KB.
- `turnstileToken` is verified server-side against Cloudflare Turnstile BEFORE any durable write (fail closed when the token is missing or the secret is unconfigured).
- Rate limit: 5 accepted submissions per source per rolling hour (keyed by a salted hash of the remote address; the raw IP is never persisted).
- A successful call creates a MUTABLE Intake Draft only. It can NEVER start a Site Generation, Build or workflow — canonical generation starts exclusively through the operator admin surface.

## CORS (browser preflight)

The wazibiz.ke mapper posts JSON cross-origin, so the endpoint answers CORS preflights:

- `OPTIONS /api/public/client-intakes` with an allowlisted `Origin` answers `204` with `Access-Control-Allow-Origin: https://wazibiz.ke`, `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: content-type` (cached 24h via `Access-Control-Max-Age`).
- Any other origin: `403` with no CORS headers.
- Successful AND error responses to the allowlisted origin carry `Access-Control-Allow-Origin: https://wazibiz.ke`, so the mapper can read the JSON verdict in every case. No credentials are used or allowed (the endpoint is cookie-less).

## Request shape

```json
{
  "submitter": { "name": "...", "email": "..." },
  "business": { "…Business Facts, see below…" },
  "designPreferences": { "…all fields optional…" },
  "turnstileToken": "…"
}
```

### `submitter` (REQUIRED — private, never published)

| field  | type              | rules                    |
| ------ | ----------------- | ------------------------ |
| `name` | string, REQUIRED  | 1–200 chars after trim   |
| `email`| string, REQUIRED  | email-shaped, ≤320 chars |

The person filling the form is not necessarily the site's public contact; submitter data labels the draft and the admin notification only.

### `business` — canonical Business Facts (REQUIRED)

- `businessName` — REQUIRED, 1–200 chars after trim.
- `contactEmail` — REQUIRED, email-shaped, ≤320 chars. This becomes the site's public contact.
- OPTIONAL strings (absent stays absent, never fabricated): `businessType` (≤200), `businessDescription` (≤5000), `idealClientProfile` (≤2000), `addressLine1` (≤300), `city` (≤120), `country` (≤120), `phoneNumber` (≤60), `whatsappNumber` (≤60), `logoUrl` (http(s) URL, ≤2048), `extraInformation` (≤5000).
- `socials` — OPTIONAL object: `facebook`, `instagram`, `twitter`, `linkedin`, `other` (each an optional string ≤2048).
- `services` — REQUIRED. Array of 3–20 items, each exactly `{ "name": string (1–200), "description"?: string (≤1000) }`. Duplicate names (case-insensitive) are rejected. The platform never invents services.
- `competitiveDifferentiator` — OPTIONAL string ≤2000. Absent stays absent.
- `businessHours` — REQUIRED. See next section.

Unknown fields inside `business` or `submitter` are rejected (`400 DRAFT_INVALID`).

### `designPreferences` (OPTIONAL — draft-only client notes)

All fields optional free-text: `direction`, `audience`, `conversionGoal`, `serviceEnvironment`, `inspirationNotes`, `preferredPalette`, `visualStyle`, `tone`, `avoidances`. These never enter the canonical submission directly — the operator authors the canonical creative intent during review.

## `businessHours` — canonical contract

Exactly seven keys: `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday` (all REQUIRED). Each day is EXACTLY one of:

CLOSED:

```json
{ "status": "CLOSED" }
```

OPEN:

```json
{
  "status": "OPEN",
  "open": "HH:MM",
  "close": "HH:MM"
}
```

Rules:

- `open` and `close` are REQUIRED on OPEN and must be canonical 24-hour `HH:MM` strings (`00:00`–`23:59`).
- **Opening intervals MAY cross midnight.** There is NO `open < close` constraint; the chronological order of the two values is never compared or validated.
- Valid examples: `08:00 → 17:00`, `18:00 → 02:00`, `22:00 → 06:00`.
- Storage is EXACTLY the supplied canonical pair — no timezone calculation, no overnight conversion, no second interval model. What the form sends is what the platform stores and what the website renders from.
- `CLOSED` carries no times.
- OPEN carries exactly `status`, `open`, `close` (no extra fields).

## Responses

| status | body | meaning |
| ------ | ---- | ------- |
| `201`  | `{ "draftId", "status", "receivedAt", "message" }` | Draft accepted |
| `400`  | `{ "error": { "code": "DRAFT_INVALID", "issues": [{ "path", "message" }] } }` | Shape violations: unknown fields, malformed `HH:MM`, OPEN missing `open`/`close`, missing day, fewer than 3 services, … |
| `403`  | `Origin not allowed` or `{ "error": { "code": "TURNSTILE_FAILED" } }` | Origin outside the allowlist / Turnstile rejected |
| `413`  | `Body size out of allowed range` | Body over 64 KB |
| `429`  | `{ "error": { "code": "RATE_LIMITED" } }` | Rate limit exceeded |

## Mapper notes

- Send the times EXACTLY as the business entered them. Do NOT reorder, normalize or "fix" overnight windows — `18:00 → 02:00` is a valid, first-class interval.
- The platform does not validate `open`/`close` ordering; the mapper must not either.
- The only ordering-independent requirement is the `HH:MM` format itself.
