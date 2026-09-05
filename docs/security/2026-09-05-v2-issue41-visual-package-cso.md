# CSO — Issue #41: Reference Visual Package + Deterministic Evidence Extraction

**Date:** 2026-09-05
**Scope:** PNG codec + deterministic screenshot extraction channel, normalized visual inputs in R2, evidence schema v2, comparator truthfulness (no fabricated geometry).
**Verdict:** SECURITY OK FOR CURRENT SCOPE

## 1. What was audited

- `src/lib/png-codec.ts` (new): dependency-free PNG decode/encode over platform Compression Streams. Decode supports 8-bit gray/RGB/palette/RGBA non-interlaced; bounded inflate (decompression-bomb guard); 40MP decode ceiling; all decode failures return precise reasons instead of partial data.
- `src/domain/visual-evidence-extraction.ts` (new): deterministic row-band extraction (bands, image masses, surface sequence, colour roles, image-mass ratio). Unknowns are null, never defaults.
- `src/domain/reference-evidence-schema.ts`: version "2" with additive optional `extraction` and `visualInputs` (hash-bound) channels; v1 artifacts remain valid.
- `src/domain/reference-intake.ts`: extraction on the canonical screenshot for every input mode; normalized visual inputs (bounded-width full page + ordered vertical slices) persisted to build-scoped R2 evidence keys with SHA-256 provenance.
- `src/domain/qa-evidence.ts` / `build-pipeline.ts` / `benchmark-runner.ts`: fabricated comparator defaults (0.9/0.83/0.22/asymmetric/self-compare image mass) removed; empty reference profiles now yield `INSUFFICIENT_REFERENCE_EVIDENCE` instead of a similarity percentage.

## 2. Security scope

D1/R2 evidence writes, processing of operator-uploaded images (untrusted bytes), comparator semantics. No auth, secrets, payments, webhooks, or public endpoints. Visual inputs land in the same private, build-scoped R2 evidence namespace — no new public exposure of reference assets.

## 3. Attack-surface summary

The pipeline now decodes operator-supplied PNGs. Guards verified by tests and code: signature/IHDR validation precedes pixel work; declared-dimension ceiling (40MP) precedes decode; inflate is bounded at the exact expected scanline size + slack so a decompression bomb aborts the stream; truncated/garbage pixel data returns `decoded: false` and the evidence channel records the reason. Extraction is deterministic and pure — no AI output, no injection surface.

## 4. Findings

None Critical/High/Medium.

Watch items:

1. **Inflate bound is per-IDAT-concatenation (Low).** The bound covers total inflated bytes; CPU cost of reading a large garbage stream is bounded by the same cap. Suitable for the current single-tenant operator trust model; revisit if untrusted multi-tenant uploads ever reach intake.
2. **Comparator coverage reported but not yet gating (Low, by design).** `measuredCoverage` and `INSUFFICIENT_REFERENCE_EVIDENCE` are honest now, but the hard non-averageable reference-fidelity gate that consumes them is issue #44's scope. Until then QA-A remains free to score on other grounds — this is the documented #41/#44 boundary, not a gap.

## 5. Severity summary

Critical 0 · High 0 · Medium 0 · Low 0 · Watch items 2 (low).

## 6. Required remediation

None for this scope.

## 7. Watch items

Carry finding 2 into #44 acceptance (the deterministic gate must treat `INSUFFICIENT_REFERENCE_EVIDENCE` as a failing hard gate, not context).

## 8. Final security verdict

**SECURITY OK FOR CURRENT SCOPE.**

## 9. Next best action

Proceed to #42 (multimodal analyzer + blueprint coverage contract), which consumes the normalized visual inputs.
