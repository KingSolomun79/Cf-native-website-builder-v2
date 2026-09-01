# CSO Security Sign-Off — QA Remediation (QA-F1, QA-F2, QA-F3)

**Date:** 2026-09-01 · **Scope:** Working-tree diff since `7ff3433` (the QA sweep commit)
**Inputs:** `docs/qa/2026-09-01-v2-qa-sweep.md` findings F1–F3; the remediation diff.
**Reviewer:** AI-assisted CSO pass (morabeza-cso skill). Not a substitute for an external audit.

## 1. What was audited
Three bounded corrective fixes from the post-implementation QA sweep, their fixture cascade and the flipped regression probes.

## 2. Security scope
Touches a product authorization gate (F1), an input-content validation boundary (F2) and a deterministic content lint (F3). No new routes, secrets, or visitor-facing surface.

## 3. Attack-surface summary
- F1: `createRevisionBuild` now enforces the ORIGINAL_DESIGN proof gate for OD parent generations (`ORIGINAL_DESIGN_LOCKED`, HTTP 423) — closing the last Build-start path.
- F2: `readScreenshotBytes` runs the retained PNG validator (signature, chunk/CRC structure, ≥1024×768, full-page ratio, size caps) before anything freezes; failures throw `REFERENCE_SCREENSHOT_INVALID`; validated dimensions enrich `screenshotMetadata`.
- F3: `FABRICATED_FOUNDING_YEAR` contextual pattern; verified zero false positives on an address/phone/copyright/box-number corpus and full match coverage on the founding-phrasing corpus.

## 4. Findings

### Verified properties (no finding)
- **Gate completeness:** both Build-start paths (`createInitialBuild`, `createRevisionBuild`) now share the same guard; the OD parent check queries the generation's `build_mode` from the parent build's own `site_generation_id`, so a misattributed parent cannot skip it. The sweep probe flipped to an ordinary passing regression.
- **Validation integrity:** the validator runs on the raw `ArrayBuffer` before any R2 freeze or evidence assembly; rejected payloads leave no partial state (throw precedes all writes). PNG-only enforcement matches the V1-era upload contract (`REFERENCE_SCREENSHOT_MIME`).
- **Benchmark identity after the fixture change:** frozen screenshots changed bytes, so checksums changed — legitimate because the identity contract is "frozen definition ↔ frozen row," not byte continuity across remediations. Re-freeze idempotency and swap-rejection both hold (harness suite green, swap probe still rejects mutated bytes/regions). The five fixtures are dimensionally distinct valid PNGs from the new `src/lib/png.ts` builder (IHDR/IEND with correct CRCs; no pixel data — nothing renderable leaks).
- **Test decoupling:** the #7 OD intake test no longer creates a Build (intake rejects on mode first), removing the gate-state dependency the fix exposed — this makes the suite more deterministic, not less.

### W18 — Cross-file test parallelism nondeterminism (Watch item, Low — pre-existing infra behavior, surfaced during this pass)
Observed again while validating: test files can interleave against the shared D1 despite `fileParallelism: false`, so global-count assertions race. Product code is unaffected; future tests should scope assertions (as the #25 probe now does with a DB-statement spy). Worth a vitest-config look in a future infra pass.

## 5. Severity summary
Critical 0 · High 0 · Medium 0 · Low 1 (W18, pre-existing, test-infra only).

## 6. Required remediation
None before commit.

## 7. Watch items
W18 plus standing items (M1–M3, L2–L3, W1–W17, F4).

## 8. Final security verdict
**SECURITY OK FOR CURRENT SCOPE** — the remediation may advance to its dedicated commit.

## 9. Next best action
Commit as the single QA remediation commit; update the implementation log with a one-line entry; tree must end clean.
