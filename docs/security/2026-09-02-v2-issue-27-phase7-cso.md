# CSO Security Sign-Off — Issue #27 Phase 7 (Production identity re-point + LLM routing plan)

**Date:** 2026-09-02
**Scope:** Working tree vs `4f7e641`: `wrangler.jsonc` (top-level `name` → `cf-website-factory-v2`; D1 → `website_factory_v2` `9e2597d1-9598-4c50-adcf-764c1b6319da`; R2 → `website-factory-v2-assets`; `PUBLIC_APP_URL` → v2; production `WAZIBIZ_SENDER_EMAIL=notifications@wazibiz.ke`; `PRIMARY_PROVIDER`/vision vars → ZAI-primary plan), `src/env.d.ts` (`OPENROUTER_API_KEY` → optional), this report. Operational (already executed, positively identified as V2): creation of D1 `website_factory_v2` and R2 `website-factory-v2-assets`.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited
The deployment-identity fix that unblocks #27: no repository command may target preserved V1 anymore, plus the operator-approved production sender var and the ZAI-primary LLM routing decision (OpenRouter key intentionally absent).

## 2. Security scope
Deployment targeting safety (the standing "inherited V1 deployment identity" hazard), production configuration boundary, provider-credential surface.

## 3. Attack-surface summary
- `wrangler deploy` / `npm run deploy` now resolve to `cf-website-factory-v2` with V2-only bindings (dry-run verified: `website_factory_v2`, `website-factory-v2-assets`, Send Email, v2 URL, sender var).
- `db:migrate:remote` resolves binding `DB` → `website_factory_v2` (never `website_factory_v1`).
- `env.staging` (`cf-website-factory-staging` + `website_factory_staging`) and `wrangler.test.jsonc` (`cf-website-factory-test`) remain separate; the staging environment block does not inherit the new top-level changes.
- No secret values in the diff; the sender address is configuration by design (#32).

## 4. Findings

### Verified properties (no finding)
- **V1 unreachable by repo tooling:** every deploy/migrate path from the repository resolves to V2 names; the preserved V1 Worker (`cf-website-factory`), D1 (`website_factory_v1`) and bucket (`website-factory-assets`) appear nowhere in the active config. Before-inventory recorded read-only (V1 live version `dc99fb34…`, 10 secret names) for the post-deploy untouched proof.
- **Fresh resources verified as V2:** `website_factory_v2` (new ID) and `website-factory-v2-assets` (new bucket) created this session; no reuse of V1 persistence.
- **Migration path safe on a fresh DB:** `0030_v2_contract_v1_removal.sql` uses `DROP TABLE IF EXISTS` guards throughout; the full 0001–0030 chain was already proven on the fresh staging database.
- **Sender var:** `notifications@wazibiz.ke` — matches the onboarded domain (#33 evidence); delivery without it fails closed (#32), so no dangling misconfiguration is possible.
- **OpenRouter absence is a skip, not a failure:** `resolveProviderChain` and `canUseVisionProvider` are key-driven; the OpenRouter leg is skipped with a recorded `configuration_error` and the AI Gateway fallback serves. `env.d.ts` now types the key optional, matching runtime reality.

### F1 — Vision primary model unproven live (Low — watch, verified at #30)
`glm-4v` is the repository's sanctioned ZAI vision model default, but live availability on the operator's Z.ai account is unproven. If it fails, vision degrades to the AI Gateway (`openai/gpt-4o`) after bounded attempts — functional, costlier. #30's generation smoke must confirm which leg actually serves.

### F2 — CF_DEPLOY_API_TOKEN reused from V1 (Low — accepted, tracked)
Operator chose to reuse the existing (broader) deploy token. It reaches only Cloudflare deploy APIs from Worker code; blast radius is Workers-script management in the account. Recommendation stands to migrate to a least-privilege `Workers Scripts:Edit` token post-release (recorded in #33 evidence).

### F3 — Two accounts on the wrangler OAuth login (Low — mitigated by pinning)
`wrangler` is logged into two accounts; account-level commands without a config pin fail or could select the wrong account. Mitigation in use: `account_id` pinned in `wrangler.jsonc` and `CLOUDFLARE_ACCOUNT_ID` exported for non-config commands. Documented in the runbook flow.

## 5. Severity summary
Critical 0 · High 0 · Medium 0 · Low 3 (F1 live-proof at #30; F2 token breadth, operator-accepted; F3 account pinning discipline). No unresolved blocking findings.

## 6. Required remediation
None blocking. Deploy may proceed from the committed config.

## 7. Watch items
- **W-27a:** #30 must confirm the ZAI vision leg (`glm-4v`) actually serves, or record the AI-Gateway fallback as the effective vision route.
- **W-27b:** migrate `CF_DEPLOY_API_TOKEN` to a least-privilege custom token post-release.
- **W-27c:** keep `CLOUDFLARE_ACCOUNT_ID` pinned for every account-level command during #27/#30.

## 8. Final security verdict
**SECURITY OK FOR CURRENT SCOPE** — the production identity re-point may be committed and deployed.

## 9. Next best action
Dedicated #27 commit, apply migrations to `website_factory_v2`, deploy `cf-website-factory-v2`, then operator secret provisioning with explicit `--name` guardrails.
