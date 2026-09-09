# CSO — Four-Page Hero Media + Nano Banana 2 Lite substitution (experiment/simplified-design-pipeline)

Date: 2026-09-09 · Scope: commits 0620e9f/f159036 + the uncommitted four-page-hero changeset.

### 1. What was audited
- KIE adapter model substitution (z-image → nano-banana-2-lite): request profile, aspect-ratio mapping, payload builder, provenance logs.
- Four-page hero requirement: blueprint schema (`mediaSlotId`), deterministic quality gate, builder instruction, `INNER_PAGE_HERO_MEDIA_MISSING` bundle-QA check, visual-QA prompt line, prompt bodies/versions.
- Benchmark driver ops (sandbox Worker only): `simple-kie-validation`, accepted-image inheritance, guarded stream-resume, `simple-full-run` freshVersion path, existing `sql-probe`.

### 2. Security scope
No auth, permission, payment, or public-endpoint changes. Sensitive domains touched: third-party API integration (KIE), D1 writes (experiment tooling), prompt/model outputs flowing into HTML generation (pre-existing surface, re-checked).

### 3. Attack-surface summary
- Driver route remains double-gated: 404 unless `EXP_BENCHMARK_DRIVER === "1"` (set ONLY in wrangler.exp.jsonc / sandbox) AND HMAC `X-Signature` over the raw body (`EXP_BENCHMARK_SECRET`, falling back to `WEBHOOK_SECRET`).
- KIE `createTask`: `aspect_ratio` sent to the provider is drawn ONLY from the documented supported set or the internal orientation bridge; `compositionAspectRatio`/`generationAspectRatio` originate from the schema-validated blueprint (pattern-constrained `^[0-9…]:[0-9…]$` and enum literals) — no free-text reaches provider structured fields. Prompts are content, transported as JSON strings.
- New D1 write (accepted-image inheritance) is fully parameterized (`?1/?2` binds) and `ON CONFLICT DO NOTHING`; accepted_images immutability triggers untouched.
- `sql-probe` remains single-SELECT-only with keyword rejection; unchanged.
- New QA regexes (`findInnerPageHeroMediaFinding`) are linear, no nested quantifiers (no ReDoS).
- No secrets in code/config: `KIE_API_KEY` stays a Worker secret; `.dev.vars.exp` is gitignored; wrangler.exp.jsonc carries only account id + public URLs.

### 4. Findings
None Critical/High/Medium.

Watch items (Low):
1. Driver ops can spend KIE budget and create Build Versions — acceptable for HMAC-gated experiment tooling; MUST never be enabled in production config (`EXP_BENCHMARK_DRIVER` must remain unset outside the sandbox). The merge to main must not change this.
2. Model-generated blueprint content flows into downstream builder/QA prompts — pre-existing prompt-injection surface, unchanged by this work; the deterministic gate/QA (hero media, truth lint, slot conformance) continues to bound what the generator can cause.
3. Client tooling (`.tmp-nb/run-stream.mjs`) interpolates operator-owned ids into `sql-probe` detail strings — HMAC-gated, operator-only, gitignored; do not promote this pattern to product code.

### 5. Severity summary
Critical 0 · High 0 · Medium 0 · Low 3 (watch items).

### 6. Required remediation
None for this scope.

### 7. Final security verdict
SECURITY OK WITH WATCH ITEMS

### 8. Next best action
Proceed to merge per the operator GO (legacy pipeline retained; legacy removal deferred). Keep `EXP_BENCHMARK_DRIVER` unset in production config during and after the merge.
