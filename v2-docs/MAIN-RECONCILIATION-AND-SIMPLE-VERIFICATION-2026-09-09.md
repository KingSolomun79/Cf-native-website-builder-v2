# MAIN RECONCILIATION + SIMPLE MAIN VERIFICATION — 2026-09-09/10

Operator GO: reconcile local SIMPLE main with remote main, verify SIMPLE on main, prepare legacy cleanup. Production untouched; V1 unchanged; no manual source edits.

## Phase A — reconciliation

- Local main before: `f98bf97` (SIMPLE merge, 176 commits ahead of a stale origin).
- origin/main before: `42da846` — exactly 4 remote-only commits, ALL `AGENTS.md`-only (`42da846`, `5d68a16`, `75ba670`, `b451b15`) → DOCS_ONLY, verified via `git show --stat`.
- Safety ref: `backup/pre-simple-main-reconcile-2026-09-09` (= f98bf97, not pushed).
- Reconciliation: `git merge --no-ff origin/main` → `4112e3b` (no conflicts; local side touches no AGENTS.md; no shared files). CSO report committed → `7b63c54`. Inventory doc committed → `f506271`.
- Ancestry proven both ways (`merge-base --is-ancestor` OK for 42da846 and f98bf97).
- Push: normal fast-forward `42da846..f506271` — NO force, NO force-with-lease. Remote main == local main == `f506271`.
- SIMPLE files on remote main: all 11 `src/simple-design/*`, hero invariant in `bundle-qa.ts`, `v2-docs/prompts/simple/01..04`.

### Main gate (on reconciled main)

- Full suite: **615/615 (69 files) PASS** (first run 608/615 under concurrent agent CPU load — 7 timing flake failures; clean no-load re-run fully green; includes all 7 `v2-simple-*` focused files + four-page-hero + nano-banana tests).
- Typecheck: PASS. `wrangler deploy --dry-run`: PASS (prod + exp configs).
- CSO: **SECURITY OK WITH WATCH ITEMS** — merge added documentation only; 3 prior Low watch items re-affirmed unchanged (`docs/security/2026-09-09-v2-main-reconciliation-cso.md`).
- `DESIGN_PIPELINE_VERSION` default/canonical = `simple_blueprint_v1` (code default `pipeline.ts:57`; prod `wrangler.jsonc:130`; exp `:91`).
- `EXP_BENCHMARK_DRIVER` absent from prod config (only `wrangler.exp.jsonc`). No secrets in any wrangler config.
- Nano Banana 2 Lite: canonical model of the SIMPLE exp runtime (`wrangler.exp.jsonc:84 KIE_MODEL=nano-banana-2-lite`); prod `KIE_MODEL=z-image` left UNTOUCHED (no deploy authorized).
- Workers AI streaming SIMPLE transport present (`vision.ts:17`, exp pins `workers_ai_stream`); four-page hero invariant present (`bundle-qa.ts:151 INNER_PAGE_HERO_MEDIA_MISSING`); legacy visual stages NOT default (only selectable; only `wrangler.test.jsonc` still pins `legacy_v2`).

## Phase B — experiment history

`experiment/simplified-design-pipeline` pushed fast-forward `dabc524..444b290` (10 commits). Remote now carries the Nano Banana final benchmark (`f159036`) and four-page hero finalization (`445a527`, `5abe606`, `444b290`) evidence. Tip already merged into main via f98bf97. No force.

## Phase C — SIMPLE runtime verification from main (sandbox only)

Deploy: reconciled main → sandbox `cf-website-factory-sandbox` (first deploy `f5a263a9`). One clean `simple-full-run` on the frozen RankForge Site Generation `f9b671cc-be01-46e4-a689-1f99e5af1582` (build `06025a7d…`, fresh v19 → v20 → v21), fresh blueprint + fresh KIE + builder + QA. Total KIE spend $0.60 (12× $0.05, all first-attempt); images inherited on repair versions (0 new attempts); driver client untracked (`.tmp-reconcile-verify/`).

| # | Check | Result |
|---|---|---|
| 1 | main builds/deploys | PASS (3 sandbox deploys) |
| 2 | `simple_blueprint_v1` selected | PASS (stage keys + workflow ledger) |
| 3 | frozen reference capture | PASS (idempotent intake reused frozen evidence) |
| 4 | Design Blueprint generation | PASS (fresh: 8 DNA rules, 12 slots, 20 acceptance conditions, quality-gate PASS) |
| 5 | Nano Banana 2 Lite images | PASS (12/12 slots, first attempt, two waves, $0.60) |
| 6 | Website Builder | PASS (TWO_CALL v19 / ONE_CALL repair v20; 2 schema-invalid attempts contained by bounded retry) |
| 7 | Four pages produced | PASS (live: /, /about, /services, /contact) |
| 8 | Four photographic heroes | PASS (live screenshots: home full-bleed duotone / about duotone+panel / services full-bleed wash / contact split; all images clean, no readable screens/pseudo-text) |
| 9 | Technical PASS | PARTIAL — deterministic Technical Preflight PASS at assembly (191 v19 / 196 v20 checks); bundle-QA-level gate still held 1 blocker (`CONTENT_HIDDEN_WITHOUT_JS`) pending the blocked final repair |
| 10 | Truth PASS | NO at terminal — zero-tolerance lint worked live (v19: 4× FABRICATED_TRUST_ENTITY 'RF'; v20: 1× 'Working With Us') but the clearing repair is provider-blocked |
| 11 | Marker-gated preview | PASS (`wazibiz-build-version` == v20 id `7a1f1b0c…` exactly; all four pages) |
| 12 | Visual QA executed | YES — twice, real captures: v19 75 → v20 88 (<90 threshold), specific actionable findings |
| 13 | Human inspection coherent | PASS (live browser, desktop, all four pages) |

### Provider incident (disclosed, NOT merge-caused)

The ONE repair (v19→v20) completed, but the NEXT bounded streaming call (release-blocker-fix repair on v21) failed 3× across ~40 min with Workers AI `8005 Internal server error` mid-long-stream (`StreamingTransportExhaustedError`, designed 3-attempt bound). The alternate sanctioned transport `zai_general_stream` independently fails with HTTP 400 code 1210 — the provider now mandates an explicit thinking parameter that transport does not send (reproduced via the pre-existing `stream-canary-text` op — i.e. on code paths untouched by the merge). Both transports impaired provider-side, on code byte-identical to the accepted benchmark build. No code fix was made (would violate the no-manual-edits verification premise and require its own review).

Pipeline behavior throughout matched the accepted benchmark exactly: bounded retries, correct gate halts, correct ONE-repair + release-blocker-fix accounting (v21 is the LAST bounded repair; no unbounded loop), resume semantics, provenance ledger. **The merge did not alter the proven SIMPLE runtime.**

### Verdict

- Runtime-unaltered: YES (evidence above).
- `SIMPLE_MAIN_VERIFIED`: **INCONCLUSIVE-ON-TERMINAL** — checks 9/10 require a truth-clean terminal version; v21's final bounded repair is provider-blocked. Completion when the provider recovers is ONE command: `node .tmp-reconcile-verify/run-simple-full.mjs --resume` (resumes v21's repair → assembly → QA → terminal), then re-verify truth/technical on the terminal package.
- Per GO: legacy deletion NOT started.

## Phase D–F — legacy cleanup readiness

Inventory: `v2-docs/LEGACY-CLEANUP-INVENTORY.md` (import-graph-verified classifications; ~5.2k src LOC + ~12.1k test LOC + ~443 KB prompt bodies removable; seam-cut order; operator-decision items: ORIGINAL_DESIGN/proof-gate cluster, benchmark driver retirement, `wrangler.test.jsonc` flip). Cleanup branch `cleanup/remove-legacy-design-pipeline` created at `f506271` (local, empty — no deletion implemented).

## State

- Local main == origin/main == `f506271`. Backup ref local: `backup/pre-simple-main-reconcile-2026-09-09` (f98bf97).
- Production: UNTOUCHED. V1: UNCHANGED. Working tree: clean (untracked `.tmp-*` scratch only).
- Sandbox config: restored to the accepted benchmark transport (`workers_ai_stream`), deploy `096898a9`.
