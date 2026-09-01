# CSO Security Sign-Off — Issue #28 follow-up (native Cloudflare Email Service transport)

**Date:** 2026-09-01
**Scope:** Working tree vs `65e87a2`: `src/domain/form-service.ts` (EMAIL binding transport + documented `E_*` error-code classification), `src/env.d.ts` (`CloudflareEmailSender` structural type, `EMAIL?` binding), `wrangler.jsonc` (`send_email` binding at top level and in `env.staging`; `services`/`WAZIBIZ_EMAIL_TRANSPORT_URL` removed), deleted `src/email-router/index.ts`, `wrangler.email-router.jsonc`, `tests/v2-email-router.test.ts`, `deploy:email-router` script, transport-token entries in `.dev.vars.example`; rewritten transport tests in `tests/v2-form-service.test.ts` and `tests/v2-final-verification.test.ts` (binding double, classification, retry, idempotency, fail-closed). Live operations: staging worker redeployed with `env.EMAIL`; controlled probe recorded `transient_failure / E_SENDER_DOMAIN_NOT_AVAILABLE`; obsolete `wazibiz-email-router` Worker and staging `WAZIBIZ_EMAIL_TRANSPORT_TOKEN` secret deleted.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.
**Supersedes:** the transport architecture audited in `2026-09-01-v2-issue-28-cso.md` (interim SMTP2Go router — kept as history).

## 1. What was audited

The replacement of the interim outbound transport (bearer-authenticated
`wazibiz-email-router` Worker → SMTP2Go) with the native Cloudflare Email
Service `send_email` binding, per the #28 follow-up specification: one
authoritative outbound channel, no provider API key, no shared transport
secret, no HTTP email-router hop, fail-closed when the binding is
unavailable, documented-code-only failure classification.

## 2. Security scope

High-sensitivity by classification: **the entire outbound mail trust
boundary** changed. Secrets handling (two secrets eliminated), sender
identity governance, recipient control, background retry mutations, and
new account-level capability (Email Service binding) were re-audited.

## 3. Attack-surface summary

- **Removed:** the only public email endpoint (`POST /send` on
  `wazibiz-email-router`), its bearer-token auth path, the shared
  `WAZIBIZ_EMAIL_TRANSPORT_TOKEN`, the SMTP2Go provider-key handling, and
  the same-account service-binding channel. Nothing outside the Worker
  can invoke outbound mail anymore — the binding is an account-internal
  capability with no HTTP surface.
- **Added:** `env.EMAIL.send({to, from, replyTo, subject, text})` behind
  the existing `attemptEmailDelivery` boundary — the message is composed
  exclusively from platform-resolved values (Form Destination and Sender
  Identity from `site_configurations`, Reply-To from the parse-validated
  visitor email). No headers, no `html`, no cc/bcc, no attachments are
  ever set by the Form Service.
- Unchanged: browser → Form Service contract (allowlist keys, forbidden
  control keys, CRLF rejection, origin/Turnstile/rate gates), delivery
  ledger, bounded retry sweep (`*/10` cron), Accepted Submission
  durability before delivery.

## 4. Findings

### Verified properties (no finding)

- **Secret elimination (verified):** grep audit of the diff shows no
  credential material; `.dev.vars.example` documents that the binding
  needs no secret; the local `.dev.vars` token and the live staging
  secret were deleted; the router Worker (which held the shared token)
  was deleted ("Successfully deleted", verified this session). Outbound
  email now has **zero secret surface**.
- **Fail-closed (live-verified):** with no sending domain onboarded, the
  real Email Service answered `E_SENDER_DOMAIN_NOT_AVAILABLE`; the
  ledger recorded `transient_failure` with bounded retry scheduled and
  acceptance remained durable (202 + `form_submissions` row). Unit tests
  pin the no-binding case (`transient / "email transport not configured"`).
- **Classification is narrow and documented (test-verified):** only the
  Cloudflare-documented `E_*` codes are mapped; quota/service/availability
  codes → transient; validation/sender/recipient/header codes →
  permanent; undocumented or code-less errors → transient (permanence
  unproven, retry capped at `MAX_DELIVERY_ATTEMPTS = 5`, so the cost of a
  wrong guess is a few bounded attempts, never lost mail and never an
  infinite loop). The mapping table and rationale live beside the
  transport code.
- **Sender/recipient governance preserved and platform-enforced:** the
  browser cannot influence `to`/`from`/transport (payload contract tests
  re-run green); Email Service itself enforces that `from` belongs to an
  onboarded domain — a stronger backstop than the interim router, since
  even a compromised `site_configurations` write cannot spoof arbitrary
  sender domains.
- **Idempotency (test-verified):** delivered ledger rows are never
  re-selected by the sweep; the binding is invoked exactly once per
  submission lifecycle (attempt-1 acceptance path or bounded retries);
  completed deliveries are not resent.
- **Retry semantics (test-verified):** a transient `E_RATE_LIMIT_EXCEEDED`
  acceptance is retried by the cron sweep through a recovered binding,
  producing `["transient_failure", "delivered"]` on the same Accepted
  Submission with no new submission row.

### W-28g — Binding is unrestricted (Low, watch → tighten at onboarding)
`send_email: [{name: "EMAIL"}]` permits any sender/recipient the Email
Service itself allows. Application-level governance (Site Configuration)
is the current control; once the platform sender domain is onboarded,
tighten with `allowed_sender_addresses` to the approved platform senders
(recommended in the wrangler comment and runbook).

### W-28h — Domain onboarding gates production delivery (operational, replaces W-28d/W-28f)
Production `delivered` rows require the dashboard onboarding: Compute >
Email Service > Email Sending > Onboard Domain on a Cloudflare-DNS zone
in the account (Cloudflare writes the `cf-bounce` MX/SPF/DKIM and DMARC
records; DMARC should start at `p=none` per the docs), then Site
Configuration sender identities must use addresses on that domain
(`noreply@mail.wazibiz.example` is a placeholder and will be rejected
until then — `E_SENDER_NOT_VERIFIED`, permanent). Until onboarding,
submissions fail closed `E_SENDER_DOMAIN_NOT_AVAILABLE` (transient,
bounded). Note the W-28d secret steps are **gone**: the production deploy
needs no email secret at all.

### W-28i — Provider message id is discarded (Low, watch)
`send()` returns `{messageId}` which the transport ignores; the delivery
ledger cannot be correlated with the Email Service activity log
(`emailSendingAdaptive`). A future schema addition could persist it.

### W-28j — Quota/reputation monitoring (Low, watch)
Account-level sending quotas (3,000/month included, conservative daily
limits for new accounts) and bounce/reputation handling are observable in
the Email Service dashboard; operational monitoring should watch them
once production traffic flows. `E_RATE_LIMIT_EXCEEDED`/
`E_DAILY_LIMIT_EXCEEDED` already classify transient.

### Residual from the interim audit
W-28a (no explicit timeout on the transport call) remains technically
true for the binding call, but the binding is a platform-managed RPC
rather than an arbitrary HTTP fetch — residual risk accepted, revisit
only if the API grows timeout semantics. W-28b (router rate limiting) and
W-28d/W-28e are moot (endpoint and secret deleted; no HTTP hop). W-28f
folds into W-28h. The same-account `*.workers.dev` fetch gotcha (W-28e)
remains a valid platform lesson for any future Worker-to-Worker HTTP.

## 5. Severity summary

No Critical, High, or Medium findings. Watch items: W-28g, W-28i, W-28j
(Low/hardening), W-28h (operational gate for production delivery).

## 6. Required remediation

None blocking. W-28h is a mandatory production-release step (dashboard
onboarding + real sender identity), tracked in the runbook and issue
evidence; W-28g is a one-line config tightening recommended immediately
after onboarding.

## 7. Watch items

W-28g, W-28h, W-28i, W-28j; residual W-28a note above.

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE** — the architecture change strictly
reduces attack surface (no public endpoint, no secrets, no provider
credential handling) while preserving every domain security rule; the
remaining production gate is a dashboard-only configuration step.

## 9. Next best action

Land this diff (28 files / 186 tests, typecheck clean, dry-runs pass,
live fail-closed evidence recorded), post SHA + evidence on #28, then
execute the dashboard domain onboarding and the #27 release runbook
(which no longer has any email-secret step).
