# CSO Review — V2 Final Secret Hygiene & Research Branch Retirement

**Date:** 2026-09-12
**Branch:** `chore/v2-final-secret-hygiene` (from main @ `69b1a3b`)
**Scope:** canonical Coding Plan credential (ZAI_CODING_API_KEY only), legacy alias/fallback removal, obsolete secret deletion, research branch retirement.
**Verdict: SECURITY OK WITH WATCH ITEMS**

## 1. What was audited

- `src/lib/zai-coding-plan.ts`: `apiKeyOf()` now returns `env.ZAI_CODING_API_KEY` ONLY — no alias, no fallback, no environment-specific secret-name logic. Missing key fails closed inside the transport BEFORE any network call (guard precedes fetch; bounded retries classify a missing credential as a non-outbound fault).
- `src/env.d.ts` / wrangler configs / policy docs: every `ZHIPU_API_KEY` reference removed from live surface (historical evidence docs retain context only).
- `scripts/verify-llm-model-routing.mjs`: new negatives — the retired alias must not appear in the transport, either wrangler config.
- `scripts/verify-v2-secrets.mjs`: production/sandbox profiles; `ZHIPU_API_KEY`, `CF_AIG_TOKEN`, `EXP_BENCHMARK_SECRET` moved to the RETIRED set; sandbox deliberately runs without `OPERATOR_CAPABILITY_SECRET` (release routes deny-by-default — fail-closed preserved).
- Tests: fail-closed credential tests added (transport seam + routing suite); legacy-name acceptance tests replaced.

## 2. Security scope

Secrets handling and credential routing only. No auth model, route table, trust boundary, or generation-path behavior changed (suite 469/469; generation architecture untouched per operator freeze).

## 3. Findings

**No Critical or High findings.**

- **Fail-closed verified:** with no `ZAI_CODING_API_KEY`, the transport rejects with "no Coding Plan API key configured" and never performs an outbound call (new tests assert this at the transport seam and the routing suite).
- **Live canary evidence (canonical-only build):** sandbox live deploy — text `glm-5.3` PASS (1.5s), vision `glm-5.3-flash` PASS (7.7s); production PREVIEW version (traffic untouched) — text PASS (2.6s), vision PASS (1.3s); all responses carried `zaiConfigured: true`, provider-echoed models, zero credential material.
- **Temporary canary route:** added and REMOVED within this branch (commits `1f67b7c`/`5b1c0b5`); it was gated by an ephemeral random token injected as a version var (the sandbox `WEBHOOK_SECRET` predates the local V2 `.dev.vars` and was deliberately not mutated); merged main carries no canary surface.
- **Secret deletions sequenced:** production `ZHIPU_API_KEY`/`CF_AIG_TOKEN` and the sandbox legacy set are deleted only after the canonical-only build is deployed and canaried, each with a zero-consumer reachability check (source + config) immediately before deletion.

## 4. Watch items

- The sandbox `WEBHOOK_SECRET` value differs from the local `.dev.vars` value (V1-era carryover). Name remains REQUIRED and intake stays HMAC-gated; value alignment is operator housekeeping if sandbox smoke scripts are ever needed.
- Historical evidence docs still NAME retired secrets; no values anywhere (name-only policy preserved).

## 5. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — the change strictly reduces credential surface (one provider, one secret name, fail-closed), keeps every deletion behind zero-consumer proof and post-change canaries, and leaves the production route table and generation architecture byte-equivalent.
