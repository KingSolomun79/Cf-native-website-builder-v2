# CSO — DOM-first/CSS-last Builder reorder (GO 2026-09-11)

- **Branch:** `fix/simple-builder-dom-first` (from cleanup @ merge `5dcb619`)
- **Scope:** `src/simple-design/website-builder.ts` (call reorder home→about→services→contact→site.css→site.js, HOME STRUCTURAL VOCABULARY extraction, CSS-vs-DOM selector gate, CSS-only qualification entry removed), `src/domain/prompt-contract.ts` + prompt bodies (v7→v8), `src/routes/v2.exp-benchmark-driver.ts` (`coding-plan-css-qualification` op removed; `simple-dom-first-ab` A/B op added), tests/helpers.

## 1. What was audited

Full working-tree diff of the reorder plus its interaction with the existing
stage seams (ai-boundary, stage artifacts, driver route).

## 2. Security scope

- Auth: driver route unchanged — `EXP_BENCHMARK_DRIVER !== "1"` → 404 before
  dispatch, HMAC `X-Signature` over the raw body verified before parse. The
  new `simple-dom-first-ab` op inherits both gates.
- Secrets: no new secrets, bindings, or env vars; no secret values printed or
  persisted. Provenance continues to record model/provider/usage only.
- Model output trust: unchanged posture — every file passes deterministic
  validation before freezing; the reorder ADDS a fail-closed gate
  (`cssSelectorFailures`: CSS class/id selectors must exist in the four
  documents or site.js). No model output reaches persistence unvalidated.
- Data: the A/B op creates a Build Version and copies the frozen blueprint
  artifact + accepted-image rows within the experiment D1/R2 only — the same
  privileges the existing `simple-hardening-run` op has. Stream-drop resume is
  refused once a newer version exists (chaining hazard guard carried over).
- Production: no production surface touched; the driver route is
  experiment-worker only (`wrangler.exp.jsonc`).

## 3. Findings

None blocking.

- Watch item: `simple-dom-first-ab` trusts caller-supplied
  `buildVersionId`/`resumeBenchmarkVersionId` for artifact inheritance — HMAC
  operator-only surface, experiment data only; consistent with every
  pre-existing driver op. No action for this scope.

## 4. Verdict

**SECURITY OK FOR CURRENT SCOPE** — proceed to the A/B experiment run.
Production remains untouched; deployment is a separate authorization.
