# CSO — Issue #30 final release verification

**Date:** 2026-09-02/03 · **Scope:** full #30 execution — canonical glm-5.3-flash
model routing, production REFERENCE_BOUND pipeline run, Approval/Publication
capability flow, live Form Service delivery, rollback surface, V1 absence,
security negative tests, final gates.

## What was audited

Live production verification against Worker `cf-website-factory-v2`
(final code SHA `f5ca46b`, Worker version at execution time `95904162` →
`8d0f3697`), D1 `website_factory_v2`, R2 `website-factory-v2-assets`, plus the
committed hardening series `9853eb2..f5ca46b` (18 scoped commits).

## Verified live

- **Model routing:** every production AI-stage row for the Release Ready build
  records `provider=zhipu model=glm-5.3-flash` (the only distinct value);
  `scripts/verify-llm-model-routing.mjs` gates `npm test`; no legacy model
  literal remains in executable routing; unavailable-model behavior fails
  closed (tested at the gateway seam and observed live: the AI Gateway compat
  leg 400s rather than substituting a model).
- **Operator capability security (live negatives):** absent token → 401
  `CAPABILITY_REQUIRED`; approve-capability on the Publication route → 403;
  publish-capability on the Approval route → 403; wrong build/version/hash
  binding → 403; correctly-signed but expired token (forged past `exp`) → 401.
  Approval and Publication each verified with exact manifest-hash binding
  (`7faf8a69…d9bce`); Publication deployed the exact approved artifact with no
  regeneration.
- **Rollback refusal:** with no prior Published Version the rollback route
  denies (fail-closed capability guard; the domain would report
  `NO_ROLLBACK_VERSION` — the route guard fires first).
- **Form/email contract:** controlled submission through the published site's
  browser contract → Accepted → **delivered** on attempt 1 via the native
  Cloudflare Email Service; ledger proves From=`notifications@wazibiz.ke`
  (configured sender), Reply-To=visitor address only, To=configured Form
  Destination. No credentials in browser payloads; the published site is an
  assets-only worker with no bindings.
- **V1 isolation:** all retired V1 routes 404 on the V2 worker; preserved V1
  Worker still serves version `dc99fb34` (unchanged since the #27 baseline);
  no command in this execution targeted V1 resources.

## Findings

- **W-30a (watch):** the ZAI leg requires `thinking: disabled` and a raised
  token floor to serve schema-bound stages within the provider's ~100s edge
  window; this is recorded in code and provenance unaffected.
- **W-30b (watch):** platform transients (D1 "Durable Object no longer
  active", workflow DO resets on code update) can kill long-running steps.
  Mitigations shipped: per-stage durable steps with bounded engine retries,
  frozen-artifact reuse at the orchestration seam, tolerant deterministic
  re-freezes, and KIE spend-resume. Deploying while workflow instances run
  remains an operational hazard — deploy between runs.
- **L-30d (low):** the build-view state label can lag terminal durable truth
  after an engine-replayed instance (labels are cosmetic; release records,
  approvals and publications are immutable rows and authoritative).
- **L-30e (low):** the rollback route reports the generic capability
  insufficient message when no prior Published Version exists (functionally
  fail-closed; `NO_ROLLBACK_VERSION` semantics preserved in the domain).

## Final gates

Hygiene gate pass, 30 files / 209 tests pass, typecheck clean,
`wrangler deploy --dry-run` pass at `f5ca46b`.

## Final security verdict

**SECURITY OK FOR CURRENT SCOPE** (watch items W-30a/W-30b recorded).
