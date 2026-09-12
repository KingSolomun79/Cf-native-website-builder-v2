# CSO Delta Review — ORIGINAL_DESIGN merge acceptance (issue #24)

Date: 2026-09-12
Branch: `feature/original-design-simple`
Scope: delta since the full-feature review `2026-09-12-v2-original-design-simple-cso.md` (SECURITY OK WITH WATCH ITEMS) — commits `caa1376`, `212bb30`, `575c5be`. Merge target: `main @ e8c7849`, then production enablement of ORIGINAL_DESIGN.
Gates at review time: `npm test` 481/481 (42 files, incl. LLM model-routing hygiene gate + resource-isolation gate), `npm run typecheck` PASS, prod dry-run PASS, exp dry-run PASS.

## 1. What was audited

- `caa1376` — capture-session marker proof in `src/domain/qa-capture.ts` (+2 tests), qualification fixtures A/B/C, `.qa-tmp/` gitignore entry.
- `212bb30` — prompt body calibration: score anchors in `simple/06-original-design-visual-qa.md`, supporting-image-slot bound (4–8, never >10) in `simple/05-original-design-blueprint.md`, mechanical regeneration of `src/domain/generated/prompt-bodies.ts`.
- `575c5be` — FDR §17 operator acceptance record + fourth production smoke fixture `scripts/fixtures/original-d-toto-steam.json`.
- Prior review findings (F1–F5) and watch items (W1–W3) re-checked against the delta.

## 2. Security scope

The delta touches QA evidence capture (a trust-relevant verification path), LLM prompt bodies, and documentation/fixtures. Not touched: auth mechanisms, capability tokens, publication/rollback authz, form service, secrets, D1 access patterns, R2 key construction, intake validation.

## 3. Attack-surface summary

No new endpoints, inputs, secrets, bindings or privileged operations. The capture marker check adds a constraint inside the existing browser-capture path; the prompt changes alter evaluation text only.

## 4. Findings

**D1 (Verified, Info) — Capture marker proof is fail-closed and unforgeable by generated code.**
The check requires `meta[name="wazibiz-build-version"][content="<expectedBuildVersionId>"]` in the page about to be screenshotted; absence throws `PREVIEW_NOT_READY`, which the durable step retries (bounded by existing step policy), then fails closed. The marker is injected platform-side at assembly/preview time (`injectBuildVersionMarker`), and the Build Version id is never exposed to Builder/Blueprint inputs — generated code cannot know or forge the expected value. A planted wrong-valued marker suppresses platform injection and fails the check. No path turns a wrong-site capture into a QA pass; the fix closes the inverse (QA condemning a site it never saw). Retry depth is bounded by the existing durable-step policy — no new loop.

**D2 (Verified, Info) — Prompt calibration carries no trust change.**
`212bb30` preserves the authority section verbatim ("Business Facts are the CONTENT AUTHORITY … must not invent any content"); the changes are score anchors making deductions consistent and an image-slot bound that REDUCES spend exposure (schema already hard-rejected >12 supporting slots). The model-routing hygiene gate (part of `npm test`) passes: no retired model/provider names entered the prompt bodies. F1's bounded risk is unchanged.

**D3 (Verified, Info) — New fixtures and docs are secret-free.**
Fixtures A/B/C/D contain fictional businesses only (`.example` emails, fictional phone formats, no real persons). FDR §17 records decisions, not credentials. `.qa-tmp/` gitignored in `caa1376` prevents accidental commit of capture artifacts.

## 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low: 0 · Info: 3. Prior review's F1 (Low, bounded, monitored) stands unchanged.

## 6. Required remediation

None.

## 7. Watch items (carried forward)

- **W1:** KIE/LLM spend abuse bounded per-site (USD 3.00 hard gate); many-sites exposure identical to the existing REFERENCE_BOUND intake surface — platform quota concern.
- **W2:** Creative-direction text is untrusted human input in any future external rendering context (currently stored JSON + event text only).
- **W3:** Verify in production smoke that no trust-section fabrication appears in practice (truth gate is the automated backstop) — discharged for the smoke in the merge/enablement report.

## 8. Final security verdict

**SECURITY OK WITH WATCH ITEMS.** The delta introduces no new attack surface and no blocking findings; the full-feature verdict of `2026-09-12-v2-original-design-simple-cso.md` stands. Proceeding to merge and deliberate production enablement is approved from a security standpoint.

## 9. Next best action

Merge `feature/original-design-simple` → `main` with `--no-ff`, run post-merge gates, deploy production from the exact merge SHA (recording previous Worker version), and run the single ORIGINAL_DESIGN production smoke with fixture D (no Reference, no auto-publish).
