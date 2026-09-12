# CSO Review — V2 Post-Rollout Hardening & Experiment Infra Retirement

**Date:** 2026-09-12
**Branch:** `chore/v2-post-rollout-hardening` (from main @ `15785ab`)
**Scope:** workflow resource isolation; benchmark driver retirement; dead provider seam removal; env/secret-name hygiene; new static isolation/routing gates.
**Verdict: SECURITY OK WITH WATCH ITEMS**

## 1. What was audited

Full working-tree diff on the branch (~6,100 insertions / ~3,880 deletions across 29 files):

- `wrangler.exp.jsonc`: sandbox Workflow resource renamed `website-build-workflow-sandbox`; experiment vars/binding removed.
- Deleted: `src/routes/v2.exp-benchmark-driver.ts`, `src/lib/ai-gateway.ts`, `src/lib/ai-streaming.ts`, `scripts/exp-benchmark-driver.mjs`, `tests/v2-simple-streaming-transport.test.ts`.
- `src/index.ts`: driver route removed; `WebsiteAgent` DO-compat export retained (see watch items).
- `src/domain/ai-boundary.ts`: `repairTruncatedJson` relocated verbatim from the deleted gateway; `generate` seam now REQUIRED (no default provider path); dead `model`/`temperature`/`maxTokens` option fields removed.
- `src/domain/qa-stages.ts`: dead `createProductionQaVisionGenerate` factory (zero callers) removed.
- `src/env.d.ts` / `src/types.ts` / `wrangler.test.jsonc`: dead provider fields removed.
- `scripts/verify-v2-secrets.mjs`: required set now `ZAI_CODING_API_KEY`-canonical; `OPENROUTER_API_KEY` retired; `ZHIPU_API_KEY` and `CF_AIG_TOKEN` optional-temporary (deferred Worker-secret deletions — the deployed runtime has zero references to either).
- New gates: `scripts/verify-resource-isolation.mjs` (wired into `npm test`), strengthened `scripts/verify-llm-model-routing.mjs`.
- Migration `0035` header: comment-only correction (SQL/checksum/bookkeeping untouched).
- New runbook: `v2-docs/CLOUDFLARE-RESOURCE-ISOLATION-RUNBOOK.md`.

## 2. Security scope

Auth surfaces: route table UNCHANGED except REMOVAL of `/api/v2/exp/benchmark-driver`. No route's auth was weakened; no new endpoint exists. Secrets: names and handling only — no values anywhere in the diff. Trust boundaries: the primary change is attack-surface REDUCTION.

## 3. Attack-surface summary

The retired driver was the most privileged HTTP surface in the Worker: HMAC + var-gated, but carrying `sql-probe` (arbitrary SELECT against D1), `artifact`/`put-fixture` (arbitrary R2 read/write under the site bucket), `fetch-probe` (SSRF-style internal fetch tooling), and model-canary ops. Removal eliminates that surface entirely rather than leaving it gated. Remaining route table (verified): canonical onboarding/build/QA/publish routes (HMAC or capability-token gated) + `kie-callback` + form submit. The resource-isolation fix also closes a real availability/integrity exposure: a sandbox deploy could capture production's Workflow and execute production pipeline instances against sandbox bindings.

## 4. Findings

No Critical or High findings.

**Medium (accepted, temporary, documented): `ZHIPU_API_KEY` code fallback retained.**
`apiKeyOf()` still accepts `ZAI_CODING_API_KEY || ZHIPU_API_KEY`. This is intentional per the operator brief (§13/§14): the sandbox Worker carries its Coding Plan credential only under the legacy name, and this autonomous run cannot perform the interactive `wrangler secret put` without the operator. Preference order is canonical-first; production uses and prefers `ZAI_CODING_API_KEY`. Exposure is negligible (requires Worker-env write access, which is already game-over). Disposition: fallback removed in a follow-up once the sandbox is canonicalized; `verify-v2-secrets.mjs` tracks the name as optional-temporary; production's legacy `ZHIPU_API_KEY` secret deletion is explicitly deferred hygiene (brief §15), never a blocker.

**Watch item: legacy Worker secrets pending deletion.** Production carries `ZHIPU_API_KEY` (superseded by `ZAI_CODING_API_KEY`; still required by the sandbox fallback) and `CF_AIG_TOKEN` (zero source references since this cleanup). Per operator brief §15, Worker-secret deletion is deferred hygiene, sequenced after sandbox canonicalization. The sandbox Worker additionally carries dormant V1/experiment-era secrets (`SMTP2GO_API_KEY`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `APPROVAL_SECRET`, `OPENROUTER_API_KEY`, `EXP_BENCHMARK_SECRET`) — no code path reads any of them on the deployed V2 runtime; queued for the operator's secret-cleanup pass.

**Watch item: `WebsiteAgent` DO-namespace compat export retained.** `src/exp-compat-website-agent.ts` is an empty `DurableObject` subclass satisfying the sandbox Worker's V1-era DO namespace (Cloudflare error 10064 otherwise). No route reaches it; it is deploy-compatibility, not dead code. Removing it requires a DO-namespace migration on the sandbox Worker — deliberately out of scope.

**Watch item: benchmark-driver evidence scripts in git history.** Driver-era docs/reports remain (historical evidence, per brief §23). They reference no secret values (spot-checked; the driver scripts read secrets from env at runtime, never embedded).

**Positive controls added:** `scripts/verify-resource-isolation.mjs` fails the build on any production/sandbox sharing of Worker name, D1 id, R2 bucket or Workflow resource name, and pins the production Workflow identity; `verify-llm-model-routing.mjs` now fails if the deleted provider seams ever reappear as files, imports, or config vars.

## 5. Severity summary

Critical 0 · High 0 · Medium 1 (accepted temporary fallback, documented) · Watch 2.

## 6. Required remediation

None blocking. Follow-ups (tracked, not part of this tranche):
1. Sandbox secret canonicalization to `ZAI_CODING_API_KEY` (needs operator interactive entry) → then remove the `apiKeyOf` fallback from source → deploy → only then delete legacy `ZHIPU_API_KEY` from the production Worker.
2. Optional: DO-namespace migration on the sandbox Worker to drop the `WebsiteAgent` shim.

## 7. Final security verdict

**SECURITY OK WITH WATCH ITEMS** — the tranche is net risk-reducing: one privileged diagnostic surface removed, the workflow ownership collision (proven production-impacting) permanently closed and gate-enforced, secret hygiene tightened, and no auth or data-access path weakened.
