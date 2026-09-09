# CSO sign-off — SIMPLE hardening pass (Phase 3 follow-up)

Date: 2026-09-09
Branch: experiment/simplified-design-pipeline
Scope: hardening diff (uncommitted at audit time) — src/lib/kie-v2.ts,
src/domain/assembly.ts, src/domain/qa-capture.ts, src/simple-design/bundle-qa.ts,
src/simple-design/site-repair.ts, src/simple-design/website-builder.ts,
src/simple-design/pipeline.ts, src/routes/v2.exp-benchmark-driver.ts,
vitest.config.ts, tests/v2-simple-hardening.test.ts, tests/helpers/simple-scripts.ts

### 1. What was audited

The four hardening fixes ordered for the merge decision:
1. Text-safe KIE photography policy + negative prompt at the KIE request boundary.
2. Build-version marker injection at assembly + preview-readiness poll with
   `PREVIEW_NOT_READY` failure before any QA capture.
3. Progressive-enhancement reveal rules (builder/repair prompt language,
   deterministic `CONTENT_HIDDEN_WITHOUT_JS` gate, reduced-motion QA captures).
4. Changed-files-only repair output with deterministic merge over the
   immutable bundle (schema-allowed paths: the six bundle files only).

Plus the Phase 3 benchmark driver ops already committed (97dd56d), re-reviewed
here because they remain unmerged experiment surface.

### 2. Security scope

Touches: image-provider request payloads (KIE API), served-page HTML content
(meta marker), QA capture network fetches, AI-stage output schemas (repair),
benchmark-driver route parameters. Does NOT touch: auth, intake HMAC gates,
form service, publication/approval, payments, secrets, production config.
No wrangler.jsonc / production binding changes.

### 3. Attack-surface summary

- KIE createTask body: platform-derived prompt text (blueprint artifact +
  boundary policy) to api.kie.ai with the worker's Authorization header.
  Brief content is model-authored but schema-validated upstream; policy text
  is a constant. No user-controlled input reaches this path.
- Served candidate pages now carry
  `<meta name="wazibiz-build-version" content="<buildVersionId>">`.
  buildVersionId is a platform-generated UUID (`generateId()`), not
  user input; attribute injection would require quote characters in a UUID.
  Disclosure level: an opaque version identifier on an already-public preview.
- waitForPreviewMarker fetches the preview URL server-side with a cache
  buster; the URL originates from deployPreview (platform workers.dev URL),
  never user input. Bounded timeout/interval; no loop without deadline.
- Repair schema: TypeBox union of exactly six path literals, minItems 1,
  additionalProperties false. Model output cannot introduce arbitrary paths;
  merge is a pure function over the immutable bundle (no fs, no traversal).
- Benchmark driver: still gated by `EXP_BENCHMARK_DRIVER=1` (exp config only)
  + HMAC signature. New `candidateDesktopR2Key` overrides are operator-only
  (require the HMAC secret) and read only from the experimental SITE_BUCKET.

### 4. Findings

No Critical or High findings.

- WATCH (Low): the build-version marker publicly discloses the serving Build
  Version id on preview pages. Opaque UUID, preview-only surface, and the id
  is required for the readiness proof. Accept; no action.
- WATCH (Low): `waitForPreviewMarker` treats any 200-with-marker as ready.
  An attacker able to control what the preview Worker serves is already
  inside the deploy boundary (they could serve anything); no new privilege.
- Verified-safe: repair path constraint (enum union), merge purity,
  regex scans on model CSS use no nested quantifiers (no ReDoS path; input
  bounded by stage max_tokens), no secrets introduced, .dev.vars.exp remains
  gitignored and uncommitted, production config untouched.

### 5. Severity summary

Critical: 0 · High: 0 · Medium: 0 · Low/watch: 2 (both accepted as-is)

### 6. Required remediation

None for this scope.

### 7. Watch items

- If the marker meta ever carries non-UUID data (e.g., free-text), re-check
  attribute-injection safety before serving.
- Keep the changed-files repair schema the single writer of repaired bundles;
  any future "full bundle" output path would reintroduce the Phase 3
  truncation failure mode and should be rejected in review.

### 8. Final security verdict

SECURITY OK WITH WATCH ITEMS

### 9. Next best action

Proceed to the fresh final benchmark on the experimental runtime (fresh KIE
under the text-safe policy, fresh build, same frozen blueprint and facts).
No production deploy; no merge from this audit alone.
