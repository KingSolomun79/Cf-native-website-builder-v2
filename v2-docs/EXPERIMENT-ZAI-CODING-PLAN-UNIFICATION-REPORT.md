# Z.AI CODING PLAN UNIFICATION REPORT

**Date:** 2026-09-11 · **Operator GO:** "POLICY OVERRIDE — ALL LLM CALLS MUST USE Z.AI GLM CODING PLAN" (2026-09-11)

Base: `fix/simple-builder-file-realization` @ `1444d15`

Branch: `fix/zai-coding-plan-builder` (pushed; clean tracked tree)

Implementation SHA: `8e515f1` (unification tranche) + live-evidence follow-ups `c23eee2`, `6165a2b`, `28bdbf4`, `41f2908`, `b34124c`, `79f89ca` — final tip **`79f89ca`**, sandbox deployed from that tip (Cloudflare version `5a157109`, experiment-only).

LLM provider: **Z.AI Coding Plan**

Endpoint: `https://api.z.ai/api/coding/paas/v4` (base URL configurable via `ZAI_CODING_BASE_URL`; ONE provider abstraction `src/lib/zai-coding-plan.ts`)

General Z.AI API used: **NO**

Workers AI LLM used: **NO** (`workers-ai-file.ts` deleted; `@cf/zai-org/*` removed from the active path; `SIMPLE_STREAMING_TRANSPORT` removed from exp config; production AI-binding prerequisite CANCELLED)

Kimi used: **NO** (branch never created)

OpenRouter used: **NO**

AI Gateway used: **NO**

Automatic provider fallback: **NO** (no fallback chains; any provider error fails bounded)

Available Coding Plan models (GET /models): `glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1, glm-5.2, glm-5.3, glm-5.3-flash`

## TEXT CANARY (§8)

glm-5.3: **PASS** (sync AND streaming)

model exact: `glm-5.3` (provider echo identical — no substitution)

duration: 2,227 ms (sync) / 1,985 ms (stream)

usage: prompt 35 / completion 3 tokens; `reasoning_tokens: 0` (thinking disabled honored); request ids `1ad6acee…`, `9b4d3415…`

## MULTIMODAL CANARY (§9)

model: `glm-5.3-flash`

Coding Plan endpoint: **PASS** · image input: **PASS** (solid-red probe accepted; answer describes the image; exact model echo, no provider switch)

## MODEL POLICY

Blueprint: `glm-5.3-flash` (Coding Plan multimodal, verified by §9)

Builder: `glm-5.3`

Visual QA: `glm-5.3-flash`

Repair: `glm-5.3`

IMAGE PROVIDER

Nano Banana 2 Lite: **UNCHANGED** (KIE; all slots succeeded at $0.05/slot)

## BUILDER QUALIFICATION (§10-§22)

architecture: **SIX_CALL_FILE_REALIZATION** (kept from 1444d15; frozen CSS + frozen shared chrome + per-file resume added)

CSS (§12/§21 first bar): **QUALIFIED** — 22,592 chars, 193 rules, finish=stop, 7,086 output tokens, 95.8 s, completeness PASS, no meta-stub, no reasoning debris, no exhaustion, no provider timeout

Home: PASS (10,814 chars) · About: PASS (5,608) · Services: PASS (7,544) · Contact: PASS (5,614) · JS: PASS (6,816)

meta-stubs: **0** · output exhaustion: **0**

critical coverage: unused CRITICAL **0**, wrong-page CRITICAL **0**

shared chrome: **PASS** (live evidence drove two gate refinements: whitespace-insensitive comparison; `aria-current="page"` — which accessibility REQUIRES to move per page — normalized; every other tag/attribute/class/text exact)

SiteBundle: **PASS**

Qualification: **PASS**

## FINAL LIVE VERIFICATION (§24, conditioned on qualification PASS)

Reference Capture: PASS (live `https://morabeza.digital/`; sufficiency SUFFICIENT; parallax limitations under the accepted adaptation contract)

Blueprint: PASS (design-blueprint/2, glm-5.3-flash via Coding Plan). Live-transport evidence fixed two boundary gaps: the endpoint does NOT enforce native response_format json_schema (blueprint now rides json_object + the boundary's prose output contract — the issue-#30 production-proven shape), emits a complete JSON object followed by trailing content (parsed at the parser-reported boundary), and occasionally overflows a maxLength cap by a sentence (boundary now truncates over-long strings to the schema cap — same normalization philosophy as stripNulls).

KIE: PASS (Nano Banana 2 Lite; all CRITICAL/HIGH slots generated, wave 1 first-attempt successes)

Builder: PASS (six valid glm-5.3 file realizations; SIX_CALL_FILE_REALIZATION; frozen chrome held)

Technical: PASS (assembled + preflight + preview deployed: `https://b-abb98cc6d0-v2.wazibizwebsites.workers.dev`)

Truth: PASS

Visual QA: completed (glm-5.3-flash; the boundary's ONE structural repair absorbed a framing fault)

Visual score: **82 < 90 — §25 BAR NOT MET** (imageTreatment 78, typography 80, responsive 80, macroLayout 82, surfaceColor 83, spacingRhythm 84, signatureElements 84, components 85; 8 P1 findings; 6 hard composition gates failed: FIRST_VIEWPORT_MATERIALLY_CORRECT, PAGE_SILHOUETTE_REGION_ORDER, DOMINANT_TEXT_IMAGE_MASS, CRITICAL_SIGNATURE_TRAITS_PRESERVED, MOBILE_PRESERVES_VISUAL_IDENTITY, CRITICAL_IMAGERY_SERVES_ROLE)

Repair: the ONE Coding Plan repair ran (`simple-site-repair` valid, glm-5.3); final QA still 82 → terminal **HUMAN_REVIEW_REQUIRED** (correct per §25: no waiver)

Release Ready: **NO**

All LLM calls Coding Plan: **YES**

Manual edits: **0**

## Gates

462/462 tests (42 files) · typecheck PASS · prod+exp dry-runs PASS · CSO: SECURITY OK FOR CURRENT SCOPE (`docs/security/2026-09-11-v2-zai-coding-plan-unification-cso.md`) · migration 0036 (per-file resume artifact kinds) applied to the experiment D1

Recommendation: **HOLD_CODING_PLAN**

Production: UNTOUCHED

Production deployment: NOT AUTHORIZED

## Operator notes

- The provider unification is DONE and qualified: every LLM arrow — Blueprint, six Builder calls, Repair — ran glm models through the Coding Plan endpoint in one live pipeline, with exact model echoes and zero fallbacks.
- The residual gap is DESIGN FIDELITY, not transport: 82 vs the ≥90 bar on this Reference. That is blueprint/craft iteration territory (an operator decision on the next design-quality move); §23's `ZAI_CODING_PLAN_FILE_REALIZATION_FAILED` did NOT trigger — file realization itself qualified cleanly.
- Main untouched (`f2e79d9`); cleanup branch untouched (`86ad265`); failed research branches remain unmerged as evidence.
