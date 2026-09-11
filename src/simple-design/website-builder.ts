// SIMPLE stage 2: the ONE Website Builder (spec sections 32-36).
//
// One visual owner for HTML + CSS + JS + responsive + motion. The Reference
// screenshots stay visual authority at BOTH ends through the Blueprint
// (implementation-ready design) and Visual QA — never as Builder input.
//
// Architecture (operator GO 2026-09-11: WEBSITE BUILDER V7 — ONE SHARED
// BUILDER STAGE, FILE-SIZED REALIZATION CALLS): there is still exactly ONE
// logical WEBSITE BUILDER STAGE owning one website realization, but inside
// that stage the site is realized through SIX bounded coding calls —
//
//   1. site.css   2. home HTML   3. about HTML
//   4. services   5. contact     6. site.js
//
// All calls share the SAME immutable context (Design Blueprint, Business
// Facts, materialized image plan, Accepted Images, CRITICAL image ledger,
// form contract, design tokens, global chrome specification); later calls
// additionally receive the FROZEN outputs of earlier ones (the stylesheet,
// then the pages) so the files interlock. These are NOT six independent
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
  generateWorkersAiFile,
  WorkersAiFileOutputExhaustedError,
  WORKERS_AI_GLM_5_3,
} from "../lib/workers-ai-file";
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

// §4 stage routing: the Website Builder's routed model. Full GLM-5.3 is the
// model intended for the Builder's coding workload; vision/design reasoning
// (Blueprint, Visual QA) stays on glm-5.3-flash elsewhere in the pipeline.
export const WEBSITE_BUILDER_MODEL = WORKERS_AI_GLM_5_3;

// §8 reasoning control — the exact setting the transport sends (GLM-5.3
// schema-verified 2026-09-10: chat_template_kwargs.enable_thinking, default
// TRUE, is explicitly supported; priority 1 applies). Recorded in provenance.
export const BUILDER_REASONING_CONTROL = "chat_template_kwargs.enable_thinking=false";

// §17/§25 cost telemetry — Cloudflare Workers AI pricing for full GLM-5.3
// (USD per million tokens). Estimated per Builder call from provider usage.
export const GLM53_INPUT_USD_PER_MTOK = 1.4;
export const GLM53_OUTPUT_USD_PER_MTOK = 4.4;

export function estimateBuilderCallCostUsd(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | null
): number | null {
  if (model !== WEBSITE_BUILDER_MODEL || !usage) return null;
  const input = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const output = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  return (input / 1_000_000) * GLM53_INPUT_USD_PER_MTOK + (output / 1_000_000) * GLM53_OUTPUT_USD_PER_MTOK;
}

// The six file-compilation steps, in their fixed deterministic order (GO §2):
// the design system first, then the four pages on that frozen stylesheet,
// then the script that enhances the frozen markup.
export const BUILDER_FILE_CALL_ORDER: BuilderFileKind[] = [
  "site-css",
  "page-home",
  "page-about",
  "page-services",
  "page-contact",
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
  "Built via the canonical SIX_CALL_FILE_REALIZATION Builder (simple-website-builder/v7, model-routed to @cf/zai-org/glm-5.3): six sequential file-sized realization calls — site.css, home, about, services, contact, site.js — each ONE raw single-file completion (stream=false, no response_format) on the same frozen context.";

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

CONSISTENCY CONTRACT: the six files are compiled by sibling calls of this one Builder job from the SAME blueprint — keep the global chrome (header/nav/footer markup, class naming vocabulary, section idioms) EXACTLY consistent across files, using the blueprint's global chrome specification and design tokens.`;
}

// OUTPUT MODE block (GO §5): identical discipline appended to every call —
// one file, raw source, no framing.
function outputModeBlock(fileName: string, firstLine: string): string {
  return `OUTPUT MODE (hard rule): this call produces exactly ONE source file, "${fileName}", as plain output. Return ONLY the complete contents of ${fileName} — raw source starting directly with ${firstLine}. No Markdown fences, no explanation before or after, no JSON, no surrounding prose, no TODO, no "rest unchanged", no source summaries or descriptions of the file.`;
}

function cssCallUserPrompt(input: RunSimpleWebsiteBuilderInput): string {
  return `${buildSharedContext(input)}

TASK (call 1 of 6 — this call): Realize the shared stylesheet. The full "site.css" implements the blueprint's entire design system: tokens as CSS custom properties, the complete type scale with clamp() sizes, layout for every planned section — including the sections that carry the MANDATORY CRITICAL IMAGE PLACEMENTS — responsive breakpoints, hover states, :focus-visible, and a prefers-reduced-motion block whenever the blueprint defines motion. ${outputModeBlock("site.css", "the first CSS rule.")}`;
}

function pageCallUserPrompt(input: RunSimpleWebsiteBuilderInput, page: PageId, css: string): string {
  return `${buildSharedContext(input)}

FROZEN site.css (call 1 of this stage — the page MUST use its vocabulary, selectors and custom properties; do not restyle):
${css}

THIS PAGE'S MANDATORY CRITICAL IMAGES (part of the ledger above — every listed slot MUST appear on this page, in its section, by exact slot id):
${criticalLedgerForPage(input.acceptedImages, page)}

TASK (call ${PAGE_IDS.indexOf(page) + 2} of 6 — this call): Realize the "${page}" page as one complete HTML document, realizing the blueprint's "${page}" spec section-by-section on that frozen stylesheet. Production-grade, no placeholders. The document opens with the page's blueprint hero section (FOUR-PAGE HERO MEDIA above) and satisfies the FORM CONTRACT when the page is contact. ${outputModeBlock(`${page}.html`, "<!DOCTYPE html>.")}`;
}

function jsCallUserPrompt(input: RunSimpleWebsiteBuilderInput, css: string, pages: Record<PageId, string>): string {
  const frozenPages = PAGE_IDS.map((page) => `FROZEN ${page}.html (already produced in this stage):\n${pages[page]}`).join("\n\n");
  return `${buildSharedContext(input)}

FROZEN site.css (call 1 of this stage):
${css}

${frozenPages}

TASK (call 6 of 6 — this call): Realize the shared script. The "site.js" implements only the blueprint's interactions — navigation toggle, scroll/entrance reveals that enhance ALREADY-VISIBLE content, header states — small, defensive (querySelector null checks), dependency-free. Its selectors must match the frozen markup and stylesheet above exactly. ${outputModeBlock("site.js", "the first JavaScript statement.")}`;
}

// The Builder's DEFAULT seam: the non-streaming RAW file transport on the
// routed model (GO §5). Transport only; injected seams (tests, driver) always
// take precedence.
function fileBuilderGenerate(env: Env, config: { maxCompletionTokens: number; label: string }): RawAiGenerate {
  return async (systemPrompt, userPrompt) => {
    const result = await generateWorkersAiFile(env, {
      model: WEBSITE_BUILDER_MODEL,
      system: systemPrompt,
      user: userPrompt,
      maxCompletionTokens: config.maxCompletionTokens,
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
  /** §17/§25: estimated Workers AI cost from provider usage (GLM-5.3 pricing;
   *  null when usage is absent or the model is not the routed Builder model). */
  estimatedCostUsd: number | null;
  outputChars: number;
}

export interface SimpleBuilderFileRealizationCoreResult {
  css: string;
  pages: Record<PageId, string>;
  js: string;
  bundle: SiteBundle;
  provenance: Record<BuilderFileKind, AiProvenance>;
  calls: BuilderCallMetrics[];
}

// The SIX_CALL_FILE_REALIZATION core (GO §2): ONE Website Builder stage, six
// bounded coding calls in fixed order. Every call shares the same frozen
// context; the page calls receive the FROZEN site.css and the JS call
// receives the FROZEN stylesheet and pages. Each call is validated
// deterministically per file IMMEDIATELY (GO §6) and fails the stage closed —
// constructs the SiteBundle but persists nothing; the stage wraps this core
// with SiteBundleSchema + CRITICAL coverage validation + persistence, and the
// transport qualification driver calls it directly (live calls, no replay).
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
  // The Builder's default seam per call kind; an injected seam (tests,
  // driver) always takes precedence and serves every call.
  const seamFor = (kind: BuilderFileKind): RawAiGenerate =>
    input.generate ?? fileBuilderGenerate(env, { maxCompletionTokens: budgetOfKind(kind), label: `simple-website-builder:${kind}` });

  // Call 1 — site.css (the design system). ONE semantic generation.
  const cssStarted = Date.now();
  const cssRun = await runAiFileStage(env, {
    stage: "simple-website-builder",
    schemaVersion: schemaVersionOfKind("site-css"),
    userPrompt: cssCallUserPrompt(input),
    ...stageArtifactBase,
    inputArtifactIds: [factsRef],
    validate: validator("site-css"),
    generate: seamFor("site-css"),
  });
  const css = cssRun.value;
  const cssMetrics: BuilderCallMetrics = {
    call: "site-css",
    runId: cssRun.runId,
    artifactR2Key: cssRun.artifactR2Key,
    model: cssRun.provenance.model,
    durationMs: Date.now() - cssStarted,
    finishReason: cssRun.finishReason,
    inputTokens: usageOf(cssRun.provenance)?.prompt_tokens ?? null,
    outputTokens: usageOf(cssRun.provenance)?.completion_tokens ?? null,
    estimatedCostUsd: estimateBuilderCallCostUsd(cssRun.provenance.model, usageOf(cssRun.provenance)),
    outputChars: css.length,
  };

  // Calls 2-5 — the four pages, each on the FROZEN stylesheet. ONE semantic
  // generation per page.
  const pages = {} as Record<PageId, string>;
  const provenance = { "site-css": cssRun.provenance } as Partial<Record<BuilderFileKind, AiProvenance>>;
  const calls: BuilderCallMetrics[] = [cssMetrics];
  const pageArtifactKeys: string[] = [];
  for (const page of PAGE_IDS) {
    const started = Date.now();
    const run = await runAiFileStage(env, {
      stage: "simple-website-builder",
      schemaVersion: schemaVersionOfKind(`page-${page}`),
      userPrompt: pageCallUserPrompt(input, page, css),
      ...stageArtifactBase,
      inputArtifactIds: [factsRef, cssRun.artifactR2Key],
      validate: validator(`page-${page}`),
      generate: seamFor(`page-${page}`),
    });
    pages[page] = run.value;
    pageArtifactKeys.push(run.artifactR2Key);
    provenance[`page-${page}`] = run.provenance;
    calls.push({
      call: `page-${page}`,
      runId: run.runId,
      artifactR2Key: run.artifactR2Key,
      model: run.provenance.model,
      durationMs: Date.now() - started,
      finishReason: run.finishReason,
      inputTokens: usageOf(run.provenance)?.prompt_tokens ?? null,
      outputTokens: usageOf(run.provenance)?.completion_tokens ?? null,
      estimatedCostUsd: estimateBuilderCallCostUsd(run.provenance.model, usageOf(run.provenance)),
      outputChars: run.value.length,
    });
  }

  // Call 6 — site.js, binding to the FROZEN markup and stylesheet. ONE
  // semantic generation.
  const jsStarted = Date.now();
  const jsRun = await runAiFileStage(env, {
    stage: "simple-website-builder",
    schemaVersion: schemaVersionOfKind("site-js"),
    userPrompt: jsCallUserPrompt(input, css, pages),
    ...stageArtifactBase,
    inputArtifactIds: [factsRef, cssRun.artifactR2Key, ...pageArtifactKeys],
    validate: validator("site-js"),
    generate: seamFor("site-js"),
  });
  const js = jsRun.value;
  provenance["site-js"] = jsRun.provenance;
  calls.push({
    call: "site-js",
    runId: jsRun.runId,
    artifactR2Key: jsRun.artifactR2Key,
    model: jsRun.provenance.model,
    durationMs: Date.now() - jsStarted,
    finishReason: jsRun.finishReason,
    inputTokens: usageOf(jsRun.provenance)?.prompt_tokens ?? null,
    outputTokens: usageOf(jsRun.provenance)?.completion_tokens ?? null,
    estimatedCostUsd: estimateBuilderCallCostUsd(jsRun.provenance.model, usageOf(jsRun.provenance)),
    outputChars: js.length,
  });

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
    if (error instanceof WorkersAiFileOutputExhaustedError) {
      throw new SimpleWebsiteBuilderError("OUTPUT_EXHAUSTED", `Website Builder output exhausted on the raw file transport: ${error.message}`);
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
