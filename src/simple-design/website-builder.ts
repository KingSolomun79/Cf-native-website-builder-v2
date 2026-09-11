// SIMPLE stage 2: the ONE Website Builder (spec sections 32-36).
//
// One visual owner for HTML + CSS + JS + responsive + motion. The Reference
// screenshots stay visual authority at BOTH ends through the Blueprint
// (implementation-ready design) and Visual QA — never as Builder input.
//
// Architecture (operator GO 2026-09-11: VISUAL FIDELITY ITERATION — DOM-FIRST,
// CSS-LAST BUILDER): there is still exactly ONE logical WEBSITE BUILDER STAGE
// owning one website realization, but inside that stage the site is realized
// through SIX bounded coding calls —
//
//   1. home HTML   2. about HTML  3. services HTML
//   4. contact     5. site.css    6. site.js
//
// DOM-FIRST, CSS-LAST (this GO §3/§4/§9): the old CSS-first order forced the
// stylesheet call to PREDICT the final markup — sections, class vocabulary,
// hero structures, wrappers — and the later HTML had to adapt to that
// speculative stylesheet. That is the tested root cause of the 82-score
// realization failures (first viewport, silhouette, text/image mass,
// signature traits, mobile identity). Now the HOME call defines the semantic
// DOM and the structural class vocabulary, the inner pages are realized on
// the FROZEN home chrome + vocabulary, and the CSS call STYLES THE ACTUAL
// FINAL MARKUP of all four completed documents. CSS later controls size,
// position, spacing, crop, surface and responsive behavior; it can no longer
// be written against markup that does not exist.

// All calls share the SAME immutable context (Design Blueprint, Business
// Facts, materialized image plan, Accepted Images, CRITICAL image ledger,
// form contract, design tokens, global chrome specification); later calls
// additionally receive the FROZEN outputs of earlier ones (the pages, then
// the stylesheet) so the files interlock. These are NOT six independent
// agents — they are six file-compilation steps inside one frozen Website
// Builder job. The old "whole site in one/two large completions" constraint
// is RETIRED: four output envelopes across two models failed on payload
// size, not on framing; the fix is output granularity. The former
// ONE_CALL/TWO_CALL strategies and the transport diagnostic are deleted with
// it.
//
// Output mode (GO §5): every call produces exactly ONE source file as plain
// model output — NO response_format, no code inside JSON strings, no Markdown
// fences (one surrounding fence is deterministically tolerated, GO §6).
//
// Model routing (operator GO 2026-09-10, BUILDER MODEL ROUTING §1; GO §4): the
// Website Builder runs on Z.ai's FULL GLM-5.3 agentic coding model — an
// intentional stage-specific policy, never fallback/substitution/retry
// routing. If the full model fails, the Builder fails bounded.
//
// CRITICAL IMAGE COVERAGE (operator GO, 2026-09-10): every materialized
// CRITICAL image slot is a mandatory Builder deliverable. The builder context
// carries a deterministic ledger of those placements, and the assembled
// bundle is validated against the same shared invariant the Assembly
// Preflight enforces BEFORE it is frozen as the stage artifact.

import type { Env } from "../env.d";
import { Value } from "@sinclair/typebox/value";
import {
  runAiFileStage,
  AiStageFileInvalidError,
  type AiProvenance,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import type { BusinessFacts } from "../domain/lifecycle-schema";
import {
  generateZaiCodingPlan,
  resolveCodingModel,
  ZaiCodingPlanOutputExhaustedError,
} from "../lib/zai-coding-plan";
import {
  ROUTED_PAGE_IDS,
  SITE_BUNDLE_SCHEMA_VERSION,
  SiteBundleSchema,
  type DesignBlueprintV2,
  type SiteBundle,
} from "./contracts";
import {
  blueprintMotionExists,
  validateBuilderFile,
  type BuilderFileKind,
} from "./builder-file-realization";
import {
  requiredCriticalImageSlots,
  validateCriticalImageCoverage,
  type CriticalCoverageFinding,
  type ImageSlotPriority,
} from "./critical-image-coverage";

export class SimpleWebsiteBuilderError extends Error {
  constructor(
    readonly code: "SOURCE_INCOMPLETE" | "OUTPUT_EXHAUSTED" | "CRITICAL_IMAGE_COVERAGE",
    message: string,
    readonly findings: CriticalCoverageFinding[] = []
  ) {
    super(message);
    this.name = "SimpleWebsiteBuilderError";
  }
}

// ── OUTPUT BUDGETS — per call, because each call emits exactly ONE file ─────
//
// Derived from previously SUCCESSFUL real artifacts (experiment R2, 22
// accepted Builder calls, 2026-09-08..09): shell (site.css + site.js) max
// 46,109 chars ⇒ site.css ≈ 44K chars worst case; four pages together max
// 99,508 chars ⇒ ≈ 35K chars for the largest single page. Token estimate
// 3.0 chars/token (conservative against the measured escaped-JSON density of
// 3.2-3.6 chars/token; raw source is denser still) plus headroom:
//
//   site.css:  44,109 / 3.0 ≈ 14.7K tokens → +22% → 18,000
//   one page:   35,000 / 3.0 ≈ 11.7K tokens → +37% → 16,000
//   site.js:   measured ≈ 2K chars        → 9×    →  6,000
//
// A successful raw realization ends well before the hard ceiling. Never
// raised automatically on exhaustion.
export const BUILDER_CSS_MAX_COMPLETION_TOKENS = 18_000;
export const BUILDER_PAGE_MAX_COMPLETION_TOKENS = 16_000;
export const BUILDER_JS_MAX_COMPLETION_TOKENS = 6_000;

// §4 model routing through the ONE Coding Plan provider (operator GO
// 2026-09-11, ZAI CODING PLAN UNIFICATION): every Builder call runs glm-5.3
// on the Z.AI Coding Plan endpoint — an explicit stage policy, never
// fallback/substitution. Override surface is the ZAI_CODING_MODEL var only.
export function resolveWebsiteBuilderModel(env: Env): string {
  return resolveCodingModel(env);
}

// §8 reasoning control — the exact setting the Coding Plan transport sends
// (live production evidence, issue #30: reasoning draws from the same output
// budget). Recorded in provenance.
export const BUILDER_REASONING_CONTROL = "thinking.type=disabled";

// §17/§25 cost telemetry — estimated at GLM list per-million-token rates
// (Coding Plan usage itself is quota-based; this remains a comparable
// per-call estimate from provider usage).
export const GLM53_INPUT_USD_PER_MTOK = 1.4;
export const GLM53_OUTPUT_USD_PER_MTOK = 4.4;

export function estimateBuilderCallCostUsd(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | null
): number | null {
  if (!model.startsWith("glm-") || !usage) return null;
  const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  return (input / 1_000_000) * GLM53_INPUT_USD_PER_MTOK + (output / 1_000_000) * GLM53_OUTPUT_USD_PER_MTOK;
}

// The six file-compilation steps, in their fixed deterministic order (GO §4,
// DOM-first): the four HTML documents first — home defines the shared chrome
// and the structural class vocabulary — then the stylesheet written AGAINST
// the final markup, then the script that enhances it.
export const BUILDER_FILE_CALL_ORDER: BuilderFileKind[] = [
  "page-home",
  "page-about",
  "page-services",
  "page-contact",
  "site-css",
  "site-js",
];

const PAGE_IDS = ["home", "about", "services", "contact"] as const;
type PageId = (typeof PAGE_IDS)[number];

function budgetOfKind(kind: BuilderFileKind): number {
  if (kind === "site-css") return BUILDER_CSS_MAX_COMPLETION_TOKENS;
  if (kind === "site-js") return BUILDER_JS_MAX_COMPLETION_TOKENS;
  return BUILDER_PAGE_MAX_COMPLETION_TOKENS;
}

function schemaVersionOfKind(kind: BuilderFileKind): string {
  return `builder-file/${kind}/1`;
}

export interface AcceptedImageDescriptor {
  slotId: string;
  altText: string;
  aspectRatio: string;
  page: string;
  section?: string;
  /** Materialized-plan priority; CRITICAL slots are mandatory Builder output. */
  priority: ImageSlotPriority;
  /** Deterministic convenience: priority === "CRITICAL". */
  required: boolean;
}

export interface RunSimpleWebsiteBuilderInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: DesignBlueprintV2;
  facts: BusinessFacts;
  acceptedImages: AcceptedImageDescriptor[];
  formServiceEndpoint: string;
  siteFormId: string;
  /** Text/code seam injection (tests, driver). The Builder is text-only
   *  (model-routing GO §4): Reference screenshots are NOT Builder input — the
   *  Blueprint is the implementation-ready design authority and Visual QA
   *  re-compares the render against the Reference. */
  generate?: RawAiGenerate;
}

export interface SimpleWebsiteBuilderResult {
  bundle: SiteBundle;
  artifactR2Key: string;
  provenance: AiProvenance | null;
  strategy: "SIX_CALL_FILE_REALIZATION";
}

// Deterministic provenance note constructed by the system — never model
// output.
export const BUILDER_STRATEGY_NOTE =
  "Built via the canonical SIX_CALL_FILE_REALIZATION Builder (simple-website-builder/v8, DOM-first/CSS-last, model-routed to glm-5.3 on the Z.AI Coding Plan): six sequential file-sized realization calls — home, about, services, contact (DOM + shared chrome + structural class vocabulary defined by home), then site.css styled against the final four documents, then site.js — each ONE raw single-file completion on the same frozen context.";

// ── CRITICAL image ledger (deterministic; derived from the materialized plan) ─

// The builder must not hunt through the whole Blueprint JSON to discover
// which images are mandatory: the ledger names every CRITICAL placement with
// its exact slot id, page ownership, blueprint section/role and priority.
// Entries come from the live materialized plan — never hard-coded slot names.
export function buildCriticalImageLedger(acceptedImages: readonly AcceptedImageDescriptor[]): string {
  const required = requiredCriticalImageSlots(acceptedImages);
  if (required.length === 0) return "(no CRITICAL image slots in this plan — no mandatory placements)";
  return required
    .map(
      (image) =>
        `- ${image.slotId}\n  page: ${image.page}\n  section: ${image.section ?? "(as described in the blueprint entry)"}\n  priority: ${image.priority}\n  REQUIRED`
    )
    .join("\n");
}

// The same ledger grouped by routed page — lower model bookkeeping for the
// page calls; design authority is unchanged.
export function buildCriticalImageLedgerByPage(acceptedImages: readonly AcceptedImageDescriptor[]): string {
  const required = requiredCriticalImageSlots(acceptedImages);
  return ROUTED_PAGE_IDS.map((page) => {
    const entries = required.filter((image) => image.page === page);
    const lines =
      entries.length === 0
        ? "(none)"
        : entries.map((image) => `- ${image.slotId} — section: ${image.section ?? "(blueprint entry)"} — priority: ${image.priority} — REQUIRED`).join("\n");
    return `${page.toUpperCase()} REQUIRED IMAGES:\n${lines}`;
  }).join("\n\n");
}

// The one page's own mandatory entries — the exact ledger slice a page call
// needs (GO §2: every call shares the ledger; the page call sees its page's
// placements verbatim).
function criticalLedgerForPage(acceptedImages: readonly AcceptedImageDescriptor[], page: PageId): string {
  const required = requiredCriticalImageSlots(acceptedImages).filter((image) => image.page === page);
  if (required.length === 0) return "(none — no CRITICAL image slots are assigned to this page)";
  return required
    .map((image) => `- ${image.slotId} — section: ${image.section ?? "(blueprint entry)"} — priority: ${image.priority} — REQUIRED`)
    .join("\n");
}

export const CRITICAL_IMAGE_INVARIANT =
  "Every Accepted Image marked CRITICAL is mandatory. It must appear at least once on its declared page in the Blueprint role/section associated with that slot. A site bundle that omits a CRITICAL image is invalid.";

export const CRITICAL_IMAGE_TRUTH_GUIDANCE =
  "Do not omit CRITICAL photography merely because Business Facts do not support the reference section's original claims. Preserve the visual composition without inventing facts. For example, photography may remain as a visual band, process/approach image, atmosphere image or contextual composition while unsupported testimonials/statistics/names remain absent. Never invent testimonial identities, quotes, clients, statistics, awards or claims — TRUTH stays authoritative, but truth constraints never require discarding the planned photography.";

function buildSharedContext(input: RunSimpleWebsiteBuilderInput): string {
  const accepted = input.acceptedImages
    .map(
      (image) =>
        `- ${image.slotId} [${image.page}${image.section ? `/${image.section}` : ""}] ${image.aspectRatio} — priority: ${image.priority}${image.required ? " (MANDATORY)" : ""} — alt: ${image.altText}`
    )
    .join("\n");
  return `DESIGN BLUEPRINT (design authority — realize it faithfully; it is complete and implementation-ready):
${JSON.stringify(input.blueprint)}

BUSINESS FACTS (the ONLY content authority — every claim, name, service, statistic, contact detail and testimonial identity must come from here; if it is not here, it does not exist):
${JSON.stringify(input.facts)}

ACCEPTED IMAGES (the ONLY images you may reference, as <img src="IMG:{slotId}" data-image-id="{slotId}" alt="...">):
${input.acceptedImages.length > 0 ? accepted : "(none yet — build WITHOUT images; do not invent slot ids)"}

MANDATORY CRITICAL IMAGE PLACEMENTS (the Builder's own release contract — every entry below MUST be used on its page, in its section, by its exact slot id; a bundle that omits any entry is INVALID and is rejected before assembly):
${buildCriticalImageLedger(input.acceptedImages)}

CRITICAL IMAGE INVARIANT (hard rule): ${CRITICAL_IMAGE_INVARIANT} HIGH-priority images are strongly preferred per the blueprint design but are not mandatory; NORMAL images are optional. ${CRITICAL_IMAGE_TRUTH_GUIDANCE}

FORM CONTRACT (contact page only):
- form action: ${input.formServiceEndpoint}
- hidden input: <input type="hidden" name="siteFormId" value="${input.siteFormId}">
- fields exactly: name, email, message — each with a <label>
- no other delivery-control fields; no client-side sending logic

FOUR-PAGE REQUIREMENT: home, about, services, contact — internal links /, /about, /services, /contact; every page links the other three; each page: <!DOCTYPE html>, lang attr, viewport meta, title, meta description, og:title/og:description, ONE <h1>, header/nav/main/footer, link site.css, script site.js (defer).

FOUR-PAGE HERO MEDIA (hard rule): EVERY routed page — home, about, services AND contact — must OPEN with its blueprint hero section carrying the hero's Accepted Image. Reference it exactly as <img src="IMG:{slotId}" data-image-id="{slotId}" alt="..."> (as the <img> itself, inside a <picture>, or as the media half of a split hero); the hero section element carries class or id containing "hero" (e.g. class="hero about-hero") so the hero and its image are identifiable. A typography-only or pale empty header is NOT acceptable on any page. Inner-page heroes carry roughly 0.45-0.75 viewport of hero visual mass on desktop (the Reference decides the exact treatment: photographic background with overlay, split hero, photographic band with inset panel, or full-bleed with wash); on mobile the hero keeps meaningful media height (about 35-50svh) — never a tiny strip, text stays readable, the primary subject survives the crop, and nothing hides behind the fixed navigation. Never reuse the home hero image on another page.

PROGRESSIVE ENHANCEMENT (hard rule): every section's content must be fully visible in plain HTML+CSS with JavaScript disabled and before any scroll event. All content must be visible in the base HTML/CSS state. JavaScript may animate from/to presentation states, but content visibility may never depend on JavaScript execution. Do not ship .reveal { opacity: 0 } or equivalent hidden-by-default content — use progressive enhancement. Scroll/entrance animation is an ENHANCEMENT applied by site.js to already-visible elements (site.js adds a class that animates from a small offset to the resting state; the resting CSS state is fully visible). Never define content hidden by default (opacity:0, visibility:hidden, transform off-screen) as its CSS resting state, and never require IntersectionObserver for content to appear. prefers-reduced-motion: reduce must keep every element fully visible with all animation disabled.

CONSISTENCY CONTRACT: the six files are compiled by sibling calls of this one Builder job from the SAME blueprint — the home call defines the global chrome (header/nav/footer markup) and the structural class vocabulary; the inner pages reproduce that chrome exactly and reuse the same component/class language; the stylesheet is written against the final markup those calls produced.`;
}

// OUTPUT MODE block (GO §5): identical discipline appended to every call —
// one file, raw source, no framing.
function outputModeBlock(fileName: string, firstLine: string): string {
  return `OUTPUT MODE (hard rule): this call produces exactly ONE source file, "${fileName}", as plain output. Return ONLY the complete contents of ${fileName} — raw source starting directly with ${firstLine}. No Markdown fences, no explanation before or after, no JSON, no surrounding prose, no TODO, no "rest unchanged", no source summaries or descriptions of the file.`;
}

function cssCallUserPrompt(input: RunSimpleWebsiteBuilderInput, pages: Record<PageId, string>): string {
  const frozenPages = PAGE_IDS.map((page) => `FROZEN ${page}.html (call ${PAGE_IDS.indexOf(page) + 1} of this stage — complete, final):\n${pages[page]}`).join("\n\n");
  return `${buildSharedContext(input)}

THE FINAL HTML DOCUMENTS THIS STYLESHEET MUST STYLE (do not invent alternate markup; do not assume sections or classes that are absent):
${frozenPages}

TASK (call 5 of 6 — this call): Realize the shared stylesheet AGAINST THE REAL DOM ABOVE. The full "site.css" styles exactly the elements, classes, ids and structures the four completed documents actually contain, implementing the blueprint's entire design system: tokens as CSS custom properties, the complete type scale with clamp() sizes, layout for every section present in the markup — including the sections that carry the MANDATORY CRITICAL IMAGE PLACEMENTS — responsive breakpoints, hover states, :focus-visible, and a prefers-reduced-motion block whenever the blueprint defines motion.

FIDELITY PRIORITIES (in order): (1) the first viewport materially matches the Reference composition carried by the Blueprint; (2) page silhouette and region order; (3) dominant text/image mass; (4) typography scale and measure; (5) photographic mass, crop and treatment; (6) surface/color sequence; (7) signature design traits; (8) mobile preservation of the visual identity.

NUMERIC BLUEPRINT VALUES ARE BINDING: where the Blueprint provides measurable guidance — clamp() sizes, section mass, container width, viewport-height hero, image ratios, max text measure, spacing, radius, surface sequence — IMPLEMENT those values rather than reinterpreting them loosely.

IMAGE TREATMENT IS INTENTIONAL: for every CRITICAL image, decide from the Blueprint and the actual DOM — full-bleed vs contained, image/text split ratio, object-fit, object-position, crop, overlay/wash, border radius, visual height/mass, desktop treatment, mobile treatment. Never default imagery to width:100%;height:auto; or generic card crops.

TYPOGRAPHY CONTROLS THE SILHOUETTE: implement the Blueprint typography literally — font-family character, weights, clamp sizes, line-height, tracking, headline measure. Large display type stays large; use max-width, controlled wrapping and responsive clamps to preserve the Reference mass instead of shrinking type to fit replacement copy.

RESPONSIVE IS NOT "STACK EVERYTHING": mobile CSS preserves hero visual mass, signature element treatment, image prominence, headline hierarchy and surface rhythm. Do not reduce every desktop composition to display:block;width:100%; — use the Blueprint's mobile behavior intentionally.

STATE CLASSES ARE SHARED VOCABULARY (live A/B evidence 2026-09-11: site.css styled .faq-collapsed while site.js toggled .is-collapsed — a rule that can never activate): interaction state classes you introduce for JavaScript (menu open, accordion state, reveal states) are part of the site's class vocabulary. site.js is written AFTER you and adopts YOUR state class names exactly — keep them minimal, conventional (is-open, is-active, is-collapsed, nav-open) and identical wherever a rule repeats, and never hide content by default under a state class. ${outputModeBlock("site.css", "the first CSS rule.")}`;
}

// ── FROZEN SHARED CHROME (GO §6/§18) ────────────────────────────────────────
//
// home is realized FIRST; home's header (with its navigation) and footer are
// extracted DETERMINISTICALLY and frozen as the shared chrome, alongside the
// deterministic HOME STRUCTURAL VOCABULARY. About / Services / Contact
// receive the exact chrome and vocabulary and must reproduce the chrome
// exactly — no redesign between pages.

export interface SharedChrome {
  header: string | null;
  footer: string | null;
}

export function extractSharedChrome(homeHtml: string): SharedChrome {
  return {
    header: /<header\b[\s\S]*?<\/header>/i.exec(homeHtml)?.[0] ?? null,
    footer: /<footer\b[\s\S]*?<\/footer>/i.exec(homeHtml)?.[0] ?? null,
  };
}

/** Deterministic chrome match: every non-home page carries the frozen header
 *  and footer. Comparison strips ALL whitespace, the `aria-current`
 *  attribute, and the bounded current-page marker class idioms — which
 *  accessibility REQUIRES to move to the current page's nav link (live
 *  qualification evidence 2026-09-11: the Builder moves
 *  `aria-current="page" class="nav-link is-active"` to each page's own link;
 *  everything else is byte-exact) — and is otherwise EXACT: any different
 *  tag, attribute, class or text fails. Returns failure ids — empty = PASS. */
export function validateSharedChrome(pages: Record<PageId, string>): string[] {
  const chrome = extractSharedChrome(pages.home);
  const normalize = (html: string): string =>
    html
      // marker strips run BEFORE the whitespace collapse: collapsing first
      // would fuse the class tokens ("nav-link is-active" → "nav-linkis-active")
      .replace(/aria-current="(page|true)"/gi, "")
      .replace(/class="([^"]*)"/gi, (_match, classes: string) => {
        const tokens = classes.trim().split(/\s+/);
        const kept = tokens.filter((token) => !/^(is-)?(active|current)$/i.test(token));
        return kept.length === tokens.length ? `class="${classes}"` : `class="${kept.join(" ")}"`;
      })
      .replace(/\s+/g, "");
  const failures: string[] = [];
  for (const page of ["about", "services", "contact"] as const) {
    if (chrome.header && !normalize(pages[page]).includes(normalize(chrome.header))) {
      failures.push(`${page} page header does not match the frozen shared chrome`);
    }
    if (chrome.footer && !normalize(pages[page]).includes(normalize(chrome.footer))) {
      failures.push(`${page} page footer does not match the frozen shared chrome`);
    }
  }
  return failures;
}

function chromePromptBlock(chrome: SharedChrome): string {
  const parts: string[] = [];
  if (chrome.header) parts.push(`${chrome.header}`);
  if (chrome.footer) parts.push(`${chrome.footer}`);
  if (parts.length === 0) {
    return "FROZEN SHARED CHROME: home produced no extractable header/footer — keep the global chrome EXACTLY consistent with the blueprint's global chrome specification.";
  }
  return `FROZEN SHARED CHROME (extracted from home — your header and footer elements must be EXACTLY these strings, byte-for-byte, including class names, attributes, text and the enclosing <header>/<footer> tags; do not restyle, reorder or reword them. The ONE permitted difference: the aria-current="page" attribute moves to the CURRENT page's nav link):\n${parts.join("\n")}`;
}

// HOME STRUCTURAL VOCABULARY (GO §6): the literal class vocabulary already
// present in the home markup — extracted deterministically (first-appearance
// order, deduplicated, bounded) so the inner-page calls reuse the existing
// structural conventions. Deliberately NOT an ontology — no interpretation,
// just the tokens.
export function extractHomeStructuralVocabulary(homeHtml: string): string {
  const seen = new Set<string>();
  const classes: string[] = [];
  for (const match of homeHtml.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    for (const token of (match[1] ?? match[2] ?? "").trim().split(/\s+/)) {
      if (token && !seen.has(token)) {
        seen.add(token);
        classes.push(token);
      }
    }
  }
  return classes.slice(0, 200).join(" ");
}

function pageCallUserPrompt(
  input: RunSimpleWebsiteBuilderInput,
  page: PageId,
  chrome: SharedChrome | null,
  homeVocabulary: string | null
): string {
  const vocabularyBlock = homeVocabulary
    ? `HOME STRUCTURAL VOCABULARY (the literal class tokens home already uses — reuse these structural conventions where appropriate: containers, hero/section idioms, buttons, media wrappers, grids, cards; introduce page-specific classes ONLY where this page's Blueprint genuinely needs them; do not invent an independent design system):\n${homeVocabulary}\n\n`
    : "";
  const homeOwnership = page === "home"
    ? " This call DEFINES the site's structural vocabulary and the shared chrome: its DOM hierarchy, section order, image/text relationships, wrappers, component/class vocabulary and its header (with navigation) and footer become the frozen chrome every remaining page reproduces exactly. It does NOT own final visual CSS values — the stylesheet is written later, against your markup."
    : "";
  return `${buildSharedContext(input)}

${vocabularyBlock}${chrome ? `${chromePromptBlock(chrome)} The header and footer are the FROZEN SHARED CHROME — reproduce them exactly; only <main> (and the page-specific <head> metadata) is this page's own.\n\n` : ""}THIS PAGE'S MANDATORY CRITICAL IMAGES (part of the ledger above — every listed slot MUST appear on this page, in its section, by exact slot id):
${criticalLedgerForPage(input.acceptedImages, page)}

TASK (call ${PAGE_IDS.indexOf(page) + 1} of 6 — this call): Realize the "${page}" page as one complete HTML document, realizing the blueprint's "${page}" spec section-by-section. Production-grade, no placeholders. The document opens with the page's blueprint hero section (FOUR-PAGE HERO MEDIA above) and satisfies the FORM CONTRACT when the page is contact. No stylesheet exists yet — ENCODE COMPOSITION STRUCTURALLY: where the Blueprint says a large split hero, the markup contains a hero text region and a hero media region; where it says an asymmetric band, the markup structurally exposes those regions; where it says a full-width photographic interruption, the image is placed INSIDE that section, never appended at the end. CSS comes later and cannot rescue the wrong semantic DOM.${homeOwnership} ${outputModeBlock(`${page}.html`, "<!DOCTYPE html>.")}`;
}

function jsCallUserPrompt(input: RunSimpleWebsiteBuilderInput, css: string, pages: Record<PageId, string>): string {
  const frozenPages = PAGE_IDS.map((page) => `FROZEN ${page}.html (already produced in this stage):\n${pages[page]}`).join("\n\n");
  return `${buildSharedContext(input)}

FROZEN site.css (call 5 of this stage):
${css}

${frozenPages}

TASK (call 6 of 6 — this call): Realize the shared script. The "site.js" implements only the blueprint's interactions — navigation toggle, scroll/entrance reveals that enhance ALREADY-VISIBLE content, header states — small, defensive (querySelector null checks), dependency-free. Its selectors must match the frozen markup and stylesheet above exactly, INCLUDING the state classes the stylesheet already defines — reuse site.css's state class names verbatim (live evidence: CSS said .faq-collapsed while the script toggled .is-collapsed; that drift kills the build). ${outputModeBlock("site.js", "the first JavaScript statement.")}`;
}

// The Builder's DEFAULT seam: the ONE Coding Plan provider, streaming
// transport (GO §13 — streaming is a transport choice inside the Coding
// Plan). Transport only; injected seams (tests, driver) always take
// precedence.
function fileBuilderGenerate(env: Env, config: { maxCompletionTokens: number; label: string }): RawAiGenerate {
  const model = resolveWebsiteBuilderModel(env);
  return async (systemPrompt, userPrompt) => {
    const result = await generateZaiCodingPlan(env, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: config.maxCompletionTokens,
      stream: true,
      label: config.label,
    });
    return {
      content: result.content,
      provider: result.provider,
      model: result.model,
      tokenUsage: result.usage ?? undefined,
      finishReason: result.finishReason,
      reasoningControl: BUILDER_REASONING_CONTROL,
    };
  };
}

// The Builder's own CRITICAL coverage check — the SAME shared invariant the
// Assembly Preflight enforces later, evaluated on the raw bundle (IMG:
// placeholders) before anything is frozen. The placeholder form maps 1:1 to
// the bundled asset path assembly produces, so a bundle passing here cannot
// fail the preflight on coverage alone.
export function validateBuilderCriticalCoverage(bundle: SiteBundle, acceptedImages: readonly AcceptedImageDescriptor[]): CriticalCoverageFinding[] {
  return validateCriticalImageCoverage(bundle.pages, acceptedImages, "placeholder");
}

function coverageSummary(findings: CriticalCoverageFinding[]): string {
  return findings.map((finding) => `${finding.id}: ${finding.detail}`).join("; ").slice(0, 600);
}

function usageOf(provenance: AiProvenance | null): { prompt_tokens?: number; completion_tokens?: number } | null {
  const usage = provenance?.tokenUsage as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  if (!usage || typeof usage !== "object") return null;
  return {
    ...(typeof usage.prompt_tokens === "number" ? { prompt_tokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === "number" ? { completion_tokens: usage.completion_tokens } : {}),
  };
}

export interface BuilderCallMetrics {
  call: BuilderFileKind;
  runId: string;
  artifactR2Key: string;
  model: string;
  durationMs: number;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** §17/§25: estimated cost from provider usage at GLM list rates (Coding
   *  Plan usage itself is quota-based); null when usage is absent. */
  estimatedCostUsd: number | null;
  outputChars: number;
  /** §20 resume: true when the immutable per-file artifact was REUSED — no
   *  model call was made for this file in this run. */
  reused?: boolean;
}

export interface SimpleBuilderFileRealizationCoreResult {
  css: string;
  pages: Record<PageId, string>;
  js: string;
  bundle: SiteBundle;
  provenance: Record<BuilderFileKind, AiProvenance>;
  calls: BuilderCallMetrics[];
}

// Per-file resume artifacts (GO §20): every VALIDATED file freezes under its
// own artifact kind before the next call starts. A workflow resume reuses
// these immutable successes and continues at the first missing file — resume,
// never a second semantic attempt for a completed file.
const FILE_ARTIFACT_PREFIX = "builder_file/";
const fileArtifactKind = (kind: BuilderFileKind): `builder_file/${string}` => `${FILE_ARTIFACT_PREFIX}${kind}`;

async function realizeFile(
  env: Env,
  args: {
    input: RunSimpleWebsiteBuilderInput;
    kind: BuilderFileKind;
    userPrompt: string;
    inputArtifactIds: string[];
    stageArtifactBase: { buildId: string; siteGenerationId: string; buildVersionId: string; buildVersionNumber: number };
    validator: (kind: BuilderFileKind) => (source: string) => string[];
    seamFor: (kind: BuilderFileKind) => RawAiGenerate;
  }
): Promise<{ file: string; metrics: BuilderCallMetrics; provenance: AiProvenance; artifactR2Key: string }> {
  const { input, kind } = args;
  // §20: a validated artifact from a previous run is REUSED, not regenerated.
  const existing = await getBuildStageArtifact<string>(env, input.buildVersionId, fileArtifactKind(kind));
  if (existing) {
    return {
      file: existing.value,
      metrics: {
        call: kind,
        runId: "reused",
        artifactR2Key: existing.artifactR2Key,
        model: existing.provenance?.model ?? resolveWebsiteBuilderModel(env),
        durationMs: 0,
        finishReason: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        outputChars: existing.value.length,
        reused: true,
      },
      // Per-file artifacts always carry provenance; the coalesce is a
      // defensive shape for legacy rows stored without one.
      provenance: existing.provenance ?? {
        promptId: "simple-website-builder",
        promptVersion: "v8",
        promptDomainContractVersion: "1",
        model: resolveWebsiteBuilderModel(env),
        schemaVersion: schemaVersionOfKind(kind),
        attempt: 1,
        inputArtifactIds: [],
      },
      artifactR2Key: existing.artifactR2Key,
    };
  }
  const started = Date.now();
  const run = await runAiFileStage(env, {
    stage: "simple-website-builder",
    schemaVersion: schemaVersionOfKind(kind),
    userPrompt: args.userPrompt,
    ...args.stageArtifactBase,
    inputArtifactIds: args.inputArtifactIds,
    validate: args.validator(kind),
    generate: args.seamFor(kind),
  });
  // Freeze BEFORE the next call starts: a later failure resumes here.
  await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    kind: fileArtifactKind(kind),
    schemaVersion: schemaVersionOfKind(kind),
    value: run.value,
    provenance: run.provenance,
  });
  return {
    file: run.value,
    metrics: {
      call: kind,
      runId: run.runId,
      artifactR2Key: run.artifactR2Key,
      model: run.provenance.model,
      durationMs: Date.now() - started,
      finishReason: run.finishReason,
      inputTokens: usageOf(run.provenance)?.prompt_tokens ?? null,
      outputTokens: usageOf(run.provenance)?.completion_tokens ?? null,
      estimatedCostUsd: estimateBuilderCallCostUsd(run.provenance.model, usageOf(run.provenance)),
      outputChars: run.value.length,
    },
    provenance: run.provenance,
    artifactR2Key: run.artifactR2Key,
  };
}

// DOM-FIRST GATE (GO §26): the stylesheet was written AGAINST the real DOM —
// a class or id selector that appears in site.css but in NEITHER the four
// documents NOR site.js is invented structure (the exact defect class the
// reorder exists to prevent). JS-quoted tokens are deliberately included in
// the accepted set: state classes site.js toggles (e.g. "nav-open") are
// legitimate CSS hooks that cannot exist in the static markup. Selector
// extraction reads ONLY selector preludes — text before each `{` — after
// stripping comments (live A/B evidence: a `/* … site.css */` header comment
// otherwise pollutes the first prelude and false-positives), so declarations
// (hex colors, custom properties) and prose never flag.
export function cssSelectorFailures(
  css: string,
  pages: Record<PageId, string>,
  js: string
): string[] {
  const accepted = new Set<string>();
  const addTokens = (text: string) => {
    for (const match of text.matchAll(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      for (const token of (match[1] ?? match[2] ?? "").trim().split(/\s+/)) if (token) accepted.add(token);
    }
    for (const match of text.matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) if (match[1] ?? match[2]) accepted.add(match[1] ?? match[2]!);
  };
  for (const page of PAGE_IDS) addTokens(pages[page] ?? "");
  for (const match of js.matchAll(/['"`]([a-zA-Z_-][\w-]*)['"`]/g)) accepted.add(match[1]);

  const scanned = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const missing = new Set<string>();
  // Walk the stylesheet structurally: track the text preceding each "{".
  let preludeStart = 0;
  let depth = 0;
  for (let index = 0; index < scanned.length; index++) {
    const char = scanned[index];
    if (char === "{") {
      if (depth === 0) {
        const prelude = scanned.slice(preludeStart, index);
        if (!prelude.trimStart().startsWith("@")) {
          const cleaned = prelude.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, "").replace(/\[[^\]]*\]/g, "");
          for (const match of cleaned.matchAll(/\.([a-zA-Z_-][\w-]*)/g)) {
            if (!accepted.has(match[1])) missing.add(`.${match[1]}`);
          }
          for (const match of cleaned.matchAll(/#([a-zA-Z_-][\w-]*)/g)) {
            if (!accepted.has(match[1])) missing.add(`#${match[1]}`);
          }
        }
      }
      depth++;
      preludeStart = index + 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      preludeStart = index + 1;
    } else if (char === ";" && depth === 0) {
      preludeStart = index + 1;
    }
  }
  return [...missing].map((selector) => `site.css uses selector ${selector} that appears in NO page document or site.js (invented structure)`);
}

// The SIX_CALL_FILE_REALIZATION core (GO §4, DOM-first/CSS-last): ONE Website
// Builder stage, six bounded coding calls in fixed order. The four page calls
// run first (home defines the shared chrome + structural class vocabulary;
// the inner pages receive both FROZEN, GO §6/§7), then the CSS call styles
// the FOUR FINAL DOCUMENTS (GO §9), then the JS call binds to the frozen
// stylesheet and pages. Each call is validated deterministically per file
// IMMEDIATELY and frozen as a per-file artifact (GO §20); the stage wraps
// this core with chrome + selector + SiteBundleSchema + CRITICAL coverage
// validation + persistence.
export async function runSimpleBuilderFileRealizationCore(
  env: Env,
  input: RunSimpleWebsiteBuilderInput
): Promise<SimpleBuilderFileRealizationCoreResult> {
  const stageArtifactBase = {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
  };
  const motionExists = blueprintMotionExists(input.blueprint);
  const validator = (kind: BuilderFileKind) => (source: string) =>
    validateBuilderFile(kind, source, { blueprintMotionExists: motionExists }).failures;
  const factsRef = input.blueprint.businessFactsRef;

  // Calls 1-4 — the four HTML documents. On resume these come from the
  // per-file artifacts, so a resumed CSS call still receives ALL FOUR final
  // documents (GO §26: resumed CSS waits for the four page files).
  const pages = {} as Record<PageId, string>;
  const provenance = {} as Partial<Record<BuilderFileKind, AiProvenance>>;
  const calls: BuilderCallMetrics[] = [];
  const pageArtifactKeys: string[] = [];
  let chrome: SharedChrome | null = null;
  let homeVocabulary: string | null = null;
  let homeArtifactKey: string | null = null;
  for (const page of PAGE_IDS) {
    const outcome = await realizeFile(env, {
      input,
      kind: `page-${page}`,
      userPrompt: pageCallUserPrompt(input, page, page === "home" ? null : chrome, page === "home" ? null : homeVocabulary),
      inputArtifactIds: page === "home" ? [factsRef] : [factsRef, homeArtifactKey!],
      stageArtifactBase,
      validator,
      seamFor: (kind) => input.generate ?? fileBuilderGenerate(env, { maxCompletionTokens: budgetOfKind(kind), label: `simple-website-builder:${kind}` }),
    });
    pages[page] = outcome.file;
    pageArtifactKeys.push(outcome.artifactR2Key);
    provenance[`page-${page}`] = outcome.provenance;
    calls.push(outcome.metrics);
    if (page === "home") {
      chrome = extractSharedChrome(pages.home);
      homeVocabulary = extractHomeStructuralVocabulary(pages.home);
      homeArtifactKey = outcome.artifactR2Key;
    }
  }

  // §18 FAIL CLOSED: the frozen chrome is a Builder contract — a page that
  // does not carry it exactly is invalid source, never a redesign candidate.
  const chromeFailures = validateSharedChrome(pages);
  if (chromeFailures.length > 0) {
    throw new SimpleWebsiteBuilderError(
      "SOURCE_INCOMPLETE",
      `Website Builder violated the frozen shared chrome contract (${chromeFailures.join("; ").slice(0, 400)})`
    );
  }

  // Call 5 — site.css, styled against the FOUR FINAL documents. ONE semantic
  // generation.
  const cssOutcome = await realizeFile(env, {
    input,
    kind: "site-css",
    userPrompt: cssCallUserPrompt(input, pages),
    inputArtifactIds: [factsRef, ...pageArtifactKeys],
    stageArtifactBase,
    validator,
    seamFor: (kind) => input.generate ?? fileBuilderGenerate(env, { maxCompletionTokens: budgetOfKind(kind), label: `simple-website-builder:${kind}` }),
  });
  const css = cssOutcome.file;
  provenance["site-css"] = cssOutcome.provenance;
  calls.push(cssOutcome.metrics);

  // Call 6 — site.js, binding to the FROZEN markup and stylesheet. ONE
  // semantic generation.
  const jsOutcome = await realizeFile(env, {
    input,
    kind: "site-js",
    userPrompt: jsCallUserPrompt(input, css, pages),
    inputArtifactIds: [factsRef, cssOutcome.artifactR2Key, ...pageArtifactKeys],
    stageArtifactBase,
    validator,
    seamFor: (kind) => input.generate ?? fileBuilderGenerate(env, { maxCompletionTokens: budgetOfKind(kind), label: `simple-website-builder:${kind}` }),
  });
  const js = jsOutcome.file;
  provenance["site-js"] = jsOutcome.provenance;
  calls.push(jsOutcome.metrics);

  // DOM-FIRST GATE: the stylesheet must reference only structure that exists
  // in the four documents or the script (fail closed after ALL six files, so
  // JS state-class hooks are known).
  const selectorFailures = cssSelectorFailures(css, pages, js);
  if (selectorFailures.length > 0) {
    throw new SimpleWebsiteBuilderError(
      "SOURCE_INCOMPLETE",
      `Website Builder stylesheet invented structure absent from the realized DOM (${selectorFailures.join("; ").slice(0, 400)})`
    );
  }

  // The SYSTEM constructs the SiteBundle — deterministic provenance note,
  // never model output.
  const bundle: SiteBundle = {
    version: "1",
    pages,
    sharedCss: css,
    sharedJs: js,
    notes: BUILDER_STRATEGY_NOTE,
  };

  return {
    css,
    pages,
    js,
    bundle,
    provenance: provenance as Record<BuilderFileKind, AiProvenance>,
    calls,
  };
}

export async function runSimpleWebsiteBuilderStage(
  env: Env,
  input: RunSimpleWebsiteBuilderInput
): Promise<SimpleWebsiteBuilderResult> {
  // Workflow-retry safety: the frozen bundle IS the stage result. The repair
  // path stores under a different subkey, so initial and repaired bundles
  // never collide.
  const existing = await getBuildStageArtifact<SiteBundle>(env, input.buildVersionId, "site_bundle");
  if (existing) {
    return {
      bundle: existing.value,
      artifactR2Key: existing.artifactR2Key,
      provenance: existing.provenance,
      strategy: "SIX_CALL_FILE_REALIZATION",
    };
  }

  let core: SimpleBuilderFileRealizationCoreResult;
  try {
    core = await runSimpleBuilderFileRealizationCore(env, input);
  } catch (error) {
    // OUTPUT EXHAUSTION: finish_reason=length (or the completion-token
    // ceiling) is classified OUTPUT_EXHAUSTED and FAILS CLOSED — never parsed
    // as a valid Builder result, never retried, never budget-raised.
    // DETERMINISTIC_REVIEW_REQUIRED via the stage-failure classifier.
    if (error instanceof ZaiCodingPlanOutputExhaustedError) {
      throw new SimpleWebsiteBuilderError("OUTPUT_EXHAUSTED", `Website Builder output exhausted on the Coding Plan transport: ${error.message}`);
    }
    // A deterministic per-file validation/normalization failure after the ONE
    // semantic generation propagates as AiStageFileInvalidError — the
    // stage-failure classifier routes it to deterministic review, not to an
    // engine retry. An incomplete file is never persisted.
    if (error instanceof AiStageFileInvalidError) {
      throw new SimpleWebsiteBuilderError("SOURCE_INCOMPLETE", `Website Builder file realization is not complete source: ${error.message}`);
    }
    throw error;
  }

  // Sequencing: SiteBundleSchema → validateCriticalImageCoverage →
  // persistence. Persistence semantics are unchanged.
  if (!Value.Check(SiteBundleSchema, core.bundle)) {
    const issues = [...Value.Errors(SiteBundleSchema, core.bundle)].map((e) => `${e.path}: ${e.message}`).join("; ").slice(0, 400);
    throw new SimpleWebsiteBuilderError("SOURCE_INCOMPLETE", `constructed site bundle failed SiteBundleSchema: ${issues}`);
  }
  // FAIL CLOSED: a bundle that violates CRITICAL coverage is not a valid
  // Builder result — it is never persisted and never reaches downstream QA
  // as one.
  const coverageFindings = validateBuilderCriticalCoverage(core.bundle, input.acceptedImages);
  if (coverageFindings.length > 0) {
    throw new SimpleWebsiteBuilderError(
      "CRITICAL_IMAGE_COVERAGE",
      `Website Builder violated its CRITICAL image coverage contract after the canonical SIX_CALL_FILE_REALIZATION build — no further attempt (${coverageSummary(coverageFindings)})`,
      coverageFindings
    );
  }
  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    kind: "site_bundle",
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    value: core.bundle,
    provenance: core.provenance["site-js"],
  });
  return { bundle: core.bundle, artifactR2Key: stored.artifactR2Key, provenance: core.provenance["site-js"], strategy: "SIX_CALL_FILE_REALIZATION" };
}
