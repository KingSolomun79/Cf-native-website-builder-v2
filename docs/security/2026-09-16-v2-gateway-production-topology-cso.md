# CSO follow-up — #48 production gateway topology (2026-09-16)

Follow-up to `2026-09-16-v2-site-address-gateway-cso.md` (SECURITY OK WITH WATCH ITEMS, commit `d0a14e5`). Scope: the LIVE production topology after the 2026-09-16 GO run — commits `f060a58`, `6e89d41`, `e20bfbd`, `e69a4e0`; platform worker `7517d420`; gateway `7c1ce682`.

### 1. What was audited

The deployed-but-unrouted wildcard gateway, the three live no-script exclusion routes, the Custom-Domain exclusion path, the reserved-name corrections, the capability-gated backfill surface, and the staged wildcard-activation plan — against the live wazibiz.co.ke zone (id `12493a8c…`, account `c1c0f6b1…`, verified same-account).

### 2. Security scope

Public serving path (wildcard gateway), zone routing/DNS mutation, hostname takeover, capability-gated operator tooling. No payment, no auth flows, no generated-site code changes.

### 3. Attack-surface summary

- `cf-site-gateway-v2` (live, workers.dev only, NO zone route): public `/__gateway-health` → 200 `ok`; everything else 404 via host validation. No Site content on workers.dev (verified live).
- Zone: three no-script routes (`www`, `wazigarden`, `wbdesign`), zero script-bearing routes; two Workers Custom Domains on the zone (`factory` → V1 platform worker, `baharini-coral-lodge` → V1 published customer site); zone-wide redirect rule 301s every wazibiz.co.ke hostname to `wazibiz.ke` BEFORE Workers (empirically confirmed on six hosts + two never-allocated `--resolve` probes).
- Backfill route: capability-gated (HMAC, action-scoped, TTL ≤ 60m), live 401 fail-closed re-verified.
- Platform worker `cf-website-factory-v2` at reserved-set commit `e20bfbd`.

### 4. Findings

**F1 (Verified, Low, resolved this run): hostname-inventory blind spot produced a real near-miss.** The earlier DNS+CT sweep missed `baharini-coral-lodge.wazibiz.co.ke` (live V1 customer site). The account Custom Domain inventory caught it; it is now reserved (`e20bfbd`, test-pinned) and excluded via its Custom Domain binding. Lesson: the Custom Domains list is the authoritative enumeration for worker-attached hostnames; DNS sweeps alone are insufficient.

**F2 (Verified, Medium, currently gated): the staged wildcard activation is the risk-bearing step.** With the catch-all redirect standing, activation would be inert (everything shadows the gateway). Once the operator narrows the redirect rule, any UNKNOWN live first-level hostname outside the six known would fall to the gateway (404) instead of its redirect — a takeover-shaped regression. The DNS record list is unreadable from the automation environment (no `dns_records` scope), so completeness rests on the Custom Domain inventory (authoritative for worker-attached hosts) + name sweep + CT. Mitigations already in place: byte-identical baseline fingerprints for all six hosts as an immediate rollback gate; rollback is two API calls (delete wildcard route, delete wildcard DNS) plus re-widening the rule. This remains an explicit operator decision (HOLD honored) — no wildcard DNS record and no gateway route exist today.

**F3 (Verified, pass): exclusion routes cannot be used to route traffic.** Created with `script: null` (the API's no-script form; empty string is rejected 10019). They negate only. Post-creation probes: all six hosts byte-identical (F GATE PASS). No route for `factory`/`baharini-coral-lodge` was created because a same-hostname route takes precedence over a Custom Domain and would bypass the V1 workers — the correct exclusion there is the Custom Domain's exact-hostname precedence over the wildcard pattern.

**F4 (Verified, pass): gateway keeps its trust boundaries live.** Host validation is exact `{one-label}.{SITES_BASE_DOMAIN}` with URL-host authority and Host-header mismatch rejection (workers.dev edge additionally rejects mismatched Host with 403 before the Worker). Origin is constructed only from `worker_name` (naming-contract regex) + configured suffix; persisted `published_url` disagreement fails closed; an origin exchange that lands off-origin is refused; only SELECT statements exist in the gateway code path; cross-Site resolution is blocked by the site_id/version/status triple cross-check. No finding.

**F5 (Verified, pass): reserved set now covers every known live hostname.** `www`, `factory`, `wazigarden`, `wbdesign`, `baharini-coral-lodge` — allocation tests pin the deterministic `business-{shortSiteId}` fallbacks. The set stays an explicit central constant (not dynamic) per operator decision.

**F6 (Verified, pass): secret hygiene maintained.** `OPERATOR_CAPABILITY_SECRET` was never printed, logged, committed, or requested; only its presence (Worker secret list name, env absence) was checked. The mint command set is documented in the runbook without exposing the secret; capability tokens stay in the operator shell.

### 5. Severity summary

Critical: 0 · High: 0 · Medium: 1 (F2 — gated behind an operator decision, mitigations staged) · Low: 1 (F1 — resolved).

### 6. Required remediation

None now. F2 remediation IS the staged activation plan: narrow the redirect rule to the six live hostnames, then DNS → route → immediate six-host fingerprint comparison, with the documented two-call rollback.

### 7. Watch items

- W1 (retained): disable the gateway's workers.dev endpoint after the wildcard route cutover is verified (it currently serves only 404s + health).
- W2: the gateway D1 binding is not read-only at the binding level (D1 has no read-only binding); the SELECT-only property lives in code review. Re-assert on any gateway change.
- W3: after any future zone or Custom Domain change, re-run the account Custom Domain inventory before assuming the six-host set is complete; extend the reserved set + exclusion strategy if a new live hostname appears.
- W4: unknown-host 404 (§J) must be re-verified immediately after activation — under the current catch-all it is unverifiable, and it is the canary for F2.

### 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — the live topology is inert-safe (no wildcard DNS, no gateway route, exclusions active, six hosts byte-identical to baseline, gateway serves nothing on workers.dev). The only Medium finding is the activation step itself, which is correctly held for an explicit operator decision with staged, fingerprint-gated commands.

### 9. Next best action

Operator: (1) run the backfill from a trusted shell (runbook command set), (2) make the redirect-rule narrowing decision, then execute the staged activation with the §I fingerprint gate immediately after the route lands.
