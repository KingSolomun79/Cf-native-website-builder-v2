# CSO addendum — #48 first stable-host Publication E2E (2026-09-16)

Closes the watch items from `2026-09-16-v2-gateway-live-routing-cso.md` after the first canonical Revision → RELEASE_READY → Approval → Publication → stable-host E2E (Site `5fafbc96…`, publication `9dea1619…`).

### Scope of this addendum

- Stable-host publication resolution and `current_publication_id` authority (live).
- Stable form Origin provisioning + enforcement (W3).
- workers.dev leakage (§9 of the closure directive).
- No architecture, QA, repair, prompt/model or benchmark changes occurred (`git diff` surface: docs only).

### Findings

**F1 (Verified, pass): canonical-state resolution serves the exact approved artifact.** `site_published_state.current_publication_id = 9dea1619-fe15-4040-a5c9-6e6b3a9ea789` → `current_build_version_id = 3ef4f866…` (the exact approved version) → publications row manifest `c30d2c38…` matches the approval- and capability-bound hash. The stable host served all four pages plus assets with 200s; deep links and refreshes hold; navigation links are all relative to the stable host.

**F2 (Verified, pass): W3 closed — form-origin provisioning is exact.** `site_configurations.form_allowed_origins_json = ["https://wazibiz-gateway-smoke-test.wazibiz.co.ke"]` — exactly the stable origin, no wildcard, written by the publication provisioning hook. Enforcement proven live: an unrelated Origin → `403 ORIGIN_NOT_ALLOWED`; the exact origin → accepted.

**F3 (Verified, pass): visitor cannot control delivery.** A payload carrying `recipient`/`from` is rejected at the contract layer (`BROWSER_PAYLOAD_CONTRACT`: "Browser code must not control delivery"). Accepted submission `f8f7d147…` persisted with platform-controlled `destination: hello@wazibiz.ke` and `sender_identity: notifications@wazibiz.ke`; the visitor address appears only as `reply_to`. Delivery: attempt 1, status `delivered`. Visitor-facing 202 followed durable acceptance.

**F4 (Verified, pass): workers.dev stays internal where designed.** The internal origin (`pub-567e35b5b6-v2…`) appears nowhere in navigation or page assets; the only workers.dev string in page bodies is the central Form Service endpoint (`cf-website-factory-v2…/api/v2/forms/submit`) — a deliberate platform-service contract (issue #11), not a published-origin leak. Gateway responses contain no origin information.

**F5 (Verified, accepted/retained): the internal origin's workers.dev URL is directly reachable** if a party learns it — pre-existing #15 platform behavior, unchanged by #48; canonical/crawlability QA gates prevent discovery through the site itself. Retained as the existing W-series hardening item (per-site workers.dev disablement is a future platform decision, not a #48 defect).

**F6 (Verified, pass): gateway state battery post-publication.** unknown → 404; grandfathered historical hosts (incl. rankforge-kenya, wazibiz-30-smoke-business — no rows, never lazily allocated) → 404; allocated published → exact current publication; orphan fail-closed remains test-pinned; health endpoint clean.

### Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 (F5 retained, pre-existing).

### Final security verdict

**SECURITY OK WITH WATCH ITEMS** (no new findings; W1 disable-gateway-workers.dev and F5 hardening remain platform follow-ups, neither blocks #48 closure).

### Next best action

Close #48 as PUBLIC SITE GATEWAY LIVE; resume #19.
