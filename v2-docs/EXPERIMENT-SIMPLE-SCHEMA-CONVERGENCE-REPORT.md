# SIMPLE BLUEPRINT SCHEMA-CONVERGENCE REPORT

Date: 2026-09-08 (evening, CVST) · Live evidence: `.tmp-exp-transport/` (gitignored, per experiment convention)

```text
Branch:
experiment/simplified-design-pipeline

Starting SHA:
04511c6

Implementation SHA:
9ea82a3

Runtime:
Cloudflare Workers AI

Model:
@cf/zai-org/glm-5.3-flash
(model release: Zhipu glm-5.3-flash — provenance recorded as runtime_host
Cloudflare Workers AI, provider workers-ai; branch-only hosting-policy
exception, unchanged)

Streaming:
PASS

Structured output:
json_schema
(response_format: { type: "json_schema", json_schema: { name, schema } } —
the provider's OpenAI-style wrapper, verified against
`wrangler ai models schema @cf/zai-org/glm-5.3-flash`; no schema-dialect
adaptation was needed)

Hard constraints retained:
schemaVersion literal "1"; businessFactsRef required, provenance only;
complete projectFrame / tokens / globalChrome / motion / pages (home 4-12
sections, about/services/contact 2-8) / responsive / accessibility objects;
designDna 5-8 falsifiable rules; signatureElements 3-5; antiPatterns 3-12;
acceptanceChecklist 10-20; imageSlots 1-16 with kebab-case id pattern, page
enum, CRITICAL/HIGH/NORMAL priority enum, kiePrompt 40-900 chars,
negativePrompt, altText; type scale 4-12 rows with clamp() sizes;
additionalProperties:false throughout; observation-authority labels and
Business/reference separation in the prompt (SAFETY/AUTHORITY class)

Design constraints relaxed/moved:
1. tokens.colors: fixed 8-key object (ground/ink/textSecondary/accent/
   accentLight/hairline/hairlineOnDark/error) -> typed role array
   { role, value, usage }, 3-12 entries, additionalProperties:false
2. imagery.imageSlots[].aspectRatio (KIE enum) -> compositionAspectRatio
   (free ratio pattern, e.g. "21:9", "2.2:1") + generationAspectRatio
   (the KIE enum) + optional cropStrategy
3. tokens.typography.scale[].maxWidthCh: global minimum 20 ->
   structural bounds 4-120 in schema + deterministic role-aware floors in
   validateDesignBlueprint

maxWidthCh:
Role-aware floors, floors only (brief sections 7/8 — no new arbitrary
ceilings): display/hero/statement elements >= 8ch; body/reading >= 20ch;
UI/labels >= 4ch; schema-level ceiling 120ch. A 12ch display headline is now
valid; the old global min-20 rejection is gone.

Aspect ratio contract:
The Blueprint describes DESIGN (compositionAspectRatio — any plausible ratio
spelling ^[0-9]+(\.[0-9]+)?:[0-9]+(\.[0-9]+)?$); the KIE field describes the
PROVIDER GENERATION REQUEST (generationAspectRatio enum 16:9/4:3/3:2/1:1/9:16,
feeding the existing orientation bridge). cropStrategy (optional) bridges the
two. Live result: hero slot composition "21:9" -> generation "16:9";
about slot "5:3" -> "16:9".

Color token contract:
Typed array of { role (1-80 chars), value (CSS color, 3-40 chars), usage
(1-400 chars) }, minItems 3, maxItems 12, additionalProperties:false. Live
result: 12 roles including ground-dark #150A26, surface-pale #F3EFFB,
primary #7C3AED — the observed design language without invented JSON keys.

Prompt size before:
6,399 bytes (prompt v2) PLUS ~6-7KB of runtime JSON-Schema prose appended to
every call by the boundary's output contract

Prompt size after:
5,969 bytes (prompt v3, simple-design-blueprint/v3) PLUS 0 — the schema
travels in response_format; the prompt is design-intent only (brief section
13: "a senior design analyst, not a JSON-schema tutorial")

Schema canary:
PASS (first try; op=schema-canary, text-only, synthetic "Meridian Cycles"
brief; stream 213.6s, finish stop, 1,129 chunks, 8,994 output tokens,
441.6 neurons; post-parse design-blueprint/1 validation PASS; deterministic
quality gate PASS: 8 DNA rules, 10 image slots, 10 color roles)

Schema canary correction calls:
0

Morabeza Blueprint:
PASS (op=blueprint on the FROZEN capture — siteGenerationId f9b671cc…,
buildId 06025a7d…, no recapture; immutable artifact
builds/06025a7d…/v1/design_blueprint.json, 33,510 bytes; run d8fac165)

Initial semantic calls:
1 (ai_stage_runs: attempt 1, outcome "valid")

Correction calls:
0 (the ONE targeted structural repair stayed available per brief section 18
and was never needed — for contrast, the six pre-iteration runs on the same
transport all died on rotating enum violations: accentOnDark, maxWidthCh<20,
aspectRatio union failures, prose prefixes)

Output tokens:
Not persisted through the streaming seam into ai_stage_runs for the real
call (seam instrumentation gap, recorded — the stage's D1 row has
token_usage null). Evidence-based estimate: 33.5KB artifact ≈ 8-9K tokens,
consistent with the canary's measured 8,994.

Duration:
Not instrumented on the blueprint op (canary: 213.6s; prior blueprint
streams on this transport: 270-440s). Same order of magnitude.

DESIGN-BLUEPRINT.md:
RENDERED — .tmp-exp-transport/DESIGN-BLUEPRINT.md (32,200 chars,
deterministic renderDesignBlueprintMarkdown render)

Schema quality:
PASS (JSON parse, design-blueprint/1 schema validation, Business/reference
authority validation — no business-content keys present, businessFactsRef
verbatim — and the deterministic quality gate all pass; verified both
server-side in the stage and locally on the fetched artifact)

Human quality:
PENDING OPERATOR REVIEW (brief sections 20-22: inspect against Finch and the
Morabeza recognition list; implementation-readiness question: could a
competent frontend developer reproduce the Reference from this Blueprint,
the Facts and the images?)

Website Builder:
NOT RUN

KIE:
USD 0

Production touched:
NO (sandbox experimental Worker cf-website-factory-sandbox only; production
D1/R2/Worker untouched; no merge to main)

V1:
UNCHANGED

Tests:
Focused 40/40 (blueprint 25, streaming-transport 12, finch-fixture 3);
SIMPLE pipeline + bundle-QA 21/21; FULL SUITE 555/555 (65 files) — including
the legacy timing-flaky workflow-retry-liveness suite; typecheck clean;
wrangler dry-run clean; /morabeza-cso: SECURITY OK WITH WATCH ITEMS
(docs/security/2026-09-08-v2-simple-schema-convergence-cso.md)

Recommendation:
CONTINUE_SIMPLE_BENCHMARK
(transport PASS + schema-convergence PASS with zero correction calls. The
SIMPLE pipeline's single-call Blueprint stage now produces schema-valid,
gate-passing artifacts reliably. Per brief section 26 the next turn may run
KIE -> Website Builder -> Visual QA -> optional ONE Repair. Operator human
quality review of DESIGN-BLUEPRINT.md against Finch is the pending gate.)
```

## Constraint classification (brief section 4)

| Class | Disposition |
|---|---|
| STRUCTURAL | Hard in JSON Schema: object completeness, array counts, id patterns, string/number bounds, `additionalProperties: false` everywhere |
| SAFETY / AUTHORITY | Hard: businessFactsRef provenance-only, no business-content fields possible (unknown top-level keys rejected — test-enforced), four-page scope fixed, all content typed as strings/numbers (no executable code), KIE enum + priority + page enums retained (section 11) |
| DESIGN PREFERENCE | Relaxed/moved: color role NAMES, composition ratio spelling, type-measure ranges per role. Relaxed floors only — no new arbitrary ceilings were introduced |

## Notes for the next turn

- The blueprint stage is idempotent per Build Version (frozen artifact IS the stage result): re-running the same `blueprint` op returns the stored artifact with zero model spend.
- `token_usage` / duration instrumentation should be threaded through the streaming seam (one small change) before the builder/QA phase so future reports carry exact numbers.
- Workers AI request-defect fail-fast (schema-dialect rejection = no retry) is in place for the builder phase.
- Costs this iteration: KIE USD 0; Workers AI ≈ 441.6 (canary) + blueprint neurons (usage not persisted server-side) — no General API spend, no purchases.
