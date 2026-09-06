# CSO Security Sign-Off — Issue #49 (Deterministic Craft Preflight + Region-Targeted Repair)

**Date:** 2026-09-05
**Scope:** Working-tree diff for #49: `src/domain/craft-preflight.ts` (new deterministic preflight + provenance-bound crops), `src/domain/assembly.ts` (build/freeze split, same-version redeploy supersede), `src/domain/build-pipeline.ts` (preflight wiring, at-most-one informed repair), `src/domain/qa-capture.ts` (`createCraftCapture`), `src/domain/stage-artifacts.ts` + `migrations/0032_v2_craft_preflight.sql` (`craft_preflight` artifact kind), `src/domain/site-generator.ts` (repair prompt crop clause), test harness craft-capture seams, `tests/v2-craft-preflight.test.ts`.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited

The pre-QA deterministic preflight: browser capture of the Preview, geometry/identity checks against frozen measured evidence, deterministic PNG region crops with hash/coordinate provenance, and the single informed per-page repair that consumes no QA repair budget.

## 2. Security scope

Internal pipeline services only. No routes, auth, secrets, payment or data-deletion changes. New trust boundaries: (a) Preview HTML → browser binding → raw layout bytes → deterministic checks (production-only path, behind the existing browser binding); (b) candidate/reference PNG bytes → `decodePng` (bounded inflate) → row-slice crops → R2 evidence keys; (c) crop artifacts → vision repair call as `slice` visual inputs. D1: one CHECK-constraint widening via table rebuild (migration 0032) — no row loss (copy-then-swap), immutability triggers recreated.

## 3. Attack-surface summary

- PNG decoding of candidate captures and the frozen reference screenshot (`cropPngBand` → `decodePng`).
- New R2 evidence objects under `craft/attempt-{n}/{region}-{side}.png` (deterministic keys).
- The repair path attaches crop artifacts to a schema-validated AI call.

## 4. Findings

### Verified properties (no finding)

- **Bounded decode.** `cropPngBand` rides the existing `decodePng` guards: 8-bit, non-interlaced, 40MP ceiling, bounded inflate. Malformed bytes yield `null` and simply lose that side of a crop pair — no crash path, no memory exhaustion path.
- **No new failure-authority.** Preflight findings never gate the pipeline; their only effect is the single informed page regeneration (existing #47 entry point). A compromised capture cannot unlock new behavior — worst case it triggers one bounded regeneration that is re-validated by the deterministic assembly validator.
- **Provenance integrity.** Crops record source sha256, coordinates, scale, crop sha256 and a deterministic R2 key; crop bytes are cut from immutable artifacts by coordinates only — there is no manual or model-chosen crop path.
- **Accounting integrity.** The repair round writes only NEW immutable page subkeys (`{page}.realization-repair-1`) and `craft_preflight` artifacts; `repair_batches` is never touched (regression-pinned by test). Assembly split guarantees only the surviving candidate occupies the immutable version keys; the superseded same-version deployment rows are marked superseded, keeping deployment provenance truthful.
- **Migration safety.** 0032 copies every row into the rebuilt table before swapping; immutability triggers and the build index are recreated; UNIQUE semantics unchanged.
- **Mode split preserved.** All checks compare against Blueprint/Contract/measured-Reference values; absent measurements skip checks (never fabricated). No generic-style judgments exist in the code — the ORIGINAL_DESIGN anti-slope remains future #51.

### Watch items

- **W1 (Low): crop payload size.** Region crops attach to the repair vision call; a pathological reference (tall page, three maximal regions) yields large base64 payloads. Bounded by MAX_CROP_REGIONS = 3 and the visual-input normalizer's encoded-budget logic; revisit only if production shows oversized attachments.
- **W2 (Low): preflight capture re-runs on workflow retry.** The verdict is frozen per attempt (idempotent artifacts), but the browser capture itself re-executes after a mid-step eviction — extra capture cost, no correctness or security impact.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 findings · Watch items: 2 (W1, W2).

## 6. Required remediation

None for this scope.

## 7. Watch items

W1/W2 above — no action required now.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS**

## 9. Next best action

Proceed to the dedicated #49 commit. Full suite 43 files / 322 tests green; `tsc --noEmit` clean; `wrangler deploy --dry-run` clean.
