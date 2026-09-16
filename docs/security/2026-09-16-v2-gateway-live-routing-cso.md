# CSO follow-up — #48 wildcard gateway LIVE routing (2026-09-16)

Third #48 sign-off, after the production topology report (`2026-09-16-v2-gateway-production-topology-cso.md`). Audits the LIVE-routed state: proxied wildcard `AAAA * → 100::` (operator-created), Worker Route `*.wazibiz.co.ke/*` → `cf-site-gateway-v2` (`98f2189c…`), three no-script exclusions, gateway `6f34cca5` (incl. `949c363` orphan fail-closed), decision 133 grandfathering (commit `9e83955`), first canonical new-Site run.

### 1. What was audited

The activated wildcard serving path, its host-validation and fail-closed behavior against live production probes, the accepted Custom-Domain drift, the grandfathering invariant, and the unchanged approval/publication/backfill trust boundaries.

### 2. Security scope

Public wildcard serving, hostname takeover, cross-Site resolution, orphan publications, form-origin provisioning. No payment/auth-flow code changed; no generation/benchmark code touched (frozen baseline verified in the activation runbook).

### 3. Attack-surface summary

- Gateway: every first-level `*.wazibiz.co.ke` hostname, all paths/methods.
- Known-live responses: gateway 404 `Not found` (unknown/grandfathered/unpublished hosts — verified for `unknown-3b8dfae5…` and `wazibiz-gateway-smoke-test…` pre-publication), generic 502/503 fail-closed (tested). No other bodies.
- Unchanged capability-gated operator routes (approve/publish/rollback/backfill) remain HMAC-bound, TTL ≤ 60m, 401 fail-closed.

### 4. Findings

**F1 (Verified, accepted — recorded, not a defect): wildcard Worker Route takes precedence over Workers Custom Domains.** After route creation, `factory` and `baharini-coral-lodge` (Custom Domains of V1-era workers) are served by the gateway (generic 404) instead of their workers; `baharini` had served live content minutes earlier. This is Cloudflare routing behavior, not a gateway flaw — the gateway responds with a clean, information-free 404 and cannot serve anything for them (no address rows, reserved names). The operator's decision 133 / GO §4 explicitly pre-accepted old-test-hostname unavailability. Rollback lever documented: deleting route `98f2189c…` instantly restores Custom-Domain serving.

**F2 (Verified, pass): unknown-host and grandfathered-host serving is information-free.** 404 body is exactly `Not found`; no workers.dev string, no origin, no site-state detail in body or headers (probed live). Unpublished allocated host (state B) behaves identically — allocation existence is not disclosed differentially beyond 404-equality with unknown hosts (a deliberate, good property).

**F3 (Verified, pass): origin construction and orphan fail-closed hold.** The only fetch destination is the constructed `https://{worker_name}.{suffix}` origin under the naming-contract regex; off-origin exchanges refused; orphaned-origin edge errors (`error code: 1042`) return generic 502 (pinned by tests, `949c363`). Cross-Site resolution is structurally blocked by the host→address→state→publication site/version/status cross-check chain (unit-tested; live state currently has exactly one address row, unpublished).

**F4 (Verified, pass): decision-133 grandfathering introduces no lazy-allocation path.** Reads return null without writes (new test); allocation happens only in canonical Site creation (proven live: `wazibiz-gateway-smoke-test` allocated exactly one row at creation, before any build). Reserved set still blocks infrastructure names. The cancelled global backfill leaves no standing bulk-write surface beyond the still-capability-gated route.

**F5 (Verified, pass): host validation under live routing.** URL-host authority + Host-header mismatch rejection remain; apex never matches `*.wazibiz.co.ke/*`; deep hosts fail TLS pre-gateway (Universal SSL covers first level only — matches the documented scope).

**F6 (Verified, pass): secrets hygiene in the activation run.** All capability minting and intake signing ran from the local checkout's `.dev.vars`; secret values never printed, logged, or committed; capability tokens existed only inside single shell commands. The new fixture contains no secrets.

### 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low/accepted: 1 (F1 — operator-accepted consequence, rollback lever documented).

### 6. Required remediation

None.

### 7. Watch items

- W1 (retained): disable the gateway's workers.dev endpoint once the first Publication E2E completes (it currently serves only health + 404s).
- W2 (retained): gateway D1 binding is SELECT-only by code convention — re-assert on gateway changes.
- W3: when the first Site publishes, verify the form-origin provisioning writes exactly `https://{stable-host}` (no wildcard) before the contact-form E2E is declared PASS.
- W4: if `baharini-coral-lodge` needs to serve again, that is an operator routing decision (delete route `98f2189c…` or attach a same-hostname serving route); do not re-add custom-domain exceptions silently.

### 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — the live wildcard gateway responds only with information-free 404s/fail-closed errors today, cannot serve cross-Site or orphaned content, allocates only at canonical creation, and its one accepted behavioral change (Custom-Domain interception) is operator-sanctioned with a one-call rollback.

### 9. Next best action

Operator human review of Build `25508915…` (P1: mobile visual-identity composition), then the canonical Revision → RELEASE_READY → Approval → Publication path completes the first live state-C E2E and the contact-form check (W3 applies).
