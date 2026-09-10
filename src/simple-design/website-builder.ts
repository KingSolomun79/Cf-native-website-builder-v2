// SIMPLE stage 2: the ONE Website Builder (spec sections 32-36).
//
// One visual owner for HTML + CSS + JS + responsive + motion. The Reference
// screenshots remain visible to the builder (spec section 26/33): they are
// visual ground truth; the Business Facts alone are the content authority.
//
// Strategy (spec section 35): prefer ONE structured call for the whole
// site-bundle. If that single call cannot produce a schema-valid bundle (the
// boundary already spent its ONE targeted structural repair), the allowed
// fallback is TWO calls inside the SAME stage sharing the SAME frozen
// context: (1) shared site.css + site.js, (2) all four HTML pages together.
// Never four independent page agents. The strategy used is returned for the
// experiment report.

import type { Env } from "../env.d";
import { Type } from "@sinclair/typebox";
import {
  runSchemaValidatedAiStage,
  AiStageSchemaInvalidError,
  type AiProvenance,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../domain/stage-artifacts";
import type { BusinessFacts } from "../domain/lifecycle-schema";
import { generateSimpleStreamingCompletion, StreamingTransportExhaustedError } from "../lib/ai-streaming";
import { simpleStreamingTransportEnabled } from "./vision";
import {
  SITE_BUNDLE_SCHEMA_VERSION,
  SiteBundleSchema,
  type DesignBlueprintV2,
  type SiteBundle,
} from "./contracts";

export class SimpleWebsiteBuilderError extends Error {
  constructor(readonly code: "SCHEMA_INVALID", message: string) {
    super(message);
    this.name = "SimpleWebsiteBuilderError";
  }
}

const BuilderShellSchema = Type.Object(
  {
    sharedCss: SiteBundleSchema.properties.sharedCss,
    sharedJs: SiteBundleSchema.properties.sharedJs,
  },
  { additionalProperties: false }
);

const BuilderPagesSchema = Type.Object(
  {
    pages: Type.Object(
      {
        home: Type.String({ minLength: 200 }),
        about: Type.String({ minLength: 200 }),
        services: Type.String({ minLength: 200 }),
        contact: Type.String({ minLength: 200 }),
      },
      { additionalProperties: false }
    ),
  },
  { additionalProperties: false }
);

export interface AcceptedImageDescriptor {
  slotId: string;
  altText: string;
  aspectRatio: string;
  page: string;
  section?: string;
}

export interface SimpleBuilderVisualInput {
  kind: string;
  artifact: string;
  sha256: string;
  width: number;
  height: number;
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
  /** Reference screenshots stay visible to the builder (spec §33). */
  visualInputs: SimpleBuilderVisualInput[];
  /** Multimodal seam; when absent the builder falls back to text-only. */
  visionGenerate?: RawAiGenerate;
  generate?: RawAiGenerate;
}

export interface SimpleWebsiteBuilderResult {
  bundle: SiteBundle;
  artifactR2Key: string;
  provenance: AiProvenance | null;
  strategy: "ONE_CALL" | "TWO_CALL_SINGLE_STAGE";
}

// ── EXPERIMENT DIAGNOSTIC ONLY (never called by the pipeline) ───────────────
//
// Live-benchmark instrumentation (2026-09-08 transport finding): the zhipu
// coding endpoint's edge window 524s any completion past ~100s; measured
// throughput ≈ 80-85 output tokens/s ⇒ practical ceiling ≈ 8K output tokens
// per call. Neither ONE_CALL (32K budget) nor the TWO_CALL pages call fits,
// so the stage's sanctioned strategies cannot return a bundle on this
// transport. This diagnostic measures DESIGN-TRANSFER QUALITY under a
// forced small-call decomposition (shared shell, then ONE page per call with
// the same frozen context and stylesheet) so the operator can separate
// "transport infeasible" from "model can't realize the blueprint". It is not
// a pipeline strategy: the spec forbids per-page agents, and the pipeline
// code above is unchanged.

function pageCallUserPrompt(input: RunSimpleWebsiteBuilderInput, page: string, css: string, js: string): string {
  return `${buildSharedContext(input)}
${css ? `\nFROZEN site.css (already produced in this stage — the page MUST use its vocabulary, selectors and custom properties; do not restyle):\n${css}\n` : ""}
${js ? `\nFROZEN site.js (already produced — reuse its hooks/classes, do not re-implement behavior):\n${js}\n` : ""}
DIAGNOSTIC TASK (single-page realization): Produce ONLY the "${page}" page as one complete HTML document, realizing the blueprint's "${page}" spec section-by-section on top of that shared stylesheet and script. Production-grade, no placeholders. All other pages are produced by sibling calls with the same frozen context — keep class names, header/nav/footer markup and section idioms EXACTLY consistent with the shared stylesheet vocabulary.`;
}

export interface BuilderTransportDiagnostic {
  bundle: SiteBundle;
  calls: Array<{ call: string; durationMs: number }>;
}

export async function runSimpleBuilderTransportDiagnostic(
  env: Env,
  input: RunSimpleWebsiteBuilderInput
): Promise<BuilderTransportDiagnostic> {
  const calls: BuilderTransportDiagnostic["calls"] = [];
  const timed = async <T>(call: string, fn: () => Promise<{ value: T }>): Promise<T> => {
    const started = Date.now();
    const run = await fn();
    calls.push({ call, durationMs: Date.now() - started });
    return run.value;
  };

  const base = {
    stage: "simple-website-builder" as const,
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.blueprint.businessFactsRef],
    generate: input.visionGenerate ?? input.generate,
  };

  const shell = await timed("shell", () =>
    runSchemaValidatedAiStage<unknown>(env, {
      ...base,
      schema: BuilderShellSchema,
      schemaVersion: "site-bundle-shell/1",
      userPrompt: shellCallUserPrompt(input),
      maxTokens: 12000,
    })
  ) as { sharedCss: string; sharedJs: string };

  const pages: Record<string, string> = {};
  for (const page of ["home", "about", "services", "contact"] as const) {
    const PageSchema = Type.Object(
      { pages: Type.Object({ [page]: Type.String({ minLength: 200 }) }, { additionalProperties: false }) },
      { additionalProperties: false }
    );
    const produced = await timed(`page:${page}`, () =>
      runSchemaValidatedAiStage<unknown>(env, {
        ...base,
        schema: PageSchema,
        schemaVersion: "site-bundle-page/1",
        userPrompt: pageCallUserPrompt(input, page, shell.sharedCss, shell.sharedJs),
        maxTokens: 12000,
      })
    ) as { pages: Record<string, string> };
    pages[page] = produced.pages[page];
  }

  return {
    bundle: {
      version: "1",
      pages: pages as SiteBundle["pages"],
      sharedCss: shell.sharedCss,
      sharedJs: shell.sharedJs,
      notes: "EXPERIMENT TRANSPORT DIAGNOSTIC bundle (shell + one page per call) — not a pipeline strategy.",
    },
    calls,
  };
}

function buildSharedContext(input: RunSimpleWebsiteBuilderInput): string {
  const accepted = input.acceptedImages
    .map((image) => `- ${image.slotId} [${image.page}${image.section ? `/${image.section}` : ""}] ${image.aspectRatio} — alt: ${image.altText}`)
    .join("\n");
  return `DESIGN BLUEPRINT (design authority — realize it faithfully):
${JSON.stringify(input.blueprint)}

BUSINESS FACTS (the ONLY content authority — every claim, name, service, statistic, contact detail and testimonial identity must come from here; if it is not here, it does not exist):
${JSON.stringify(input.facts)}

ACCEPTED IMAGES (the ONLY images you may reference, as <img src="IMG:{slotId}" data-image-id="{slotId}" alt="...">):
${input.acceptedImages.length > 0 ? accepted : "(none yet — build WITHOUT images; do not invent slot ids)"}

FORM CONTRACT (contact page only):
- form action: ${input.formServiceEndpoint}
- hidden input: <input type="hidden" name="siteFormId" value="${input.siteFormId}">
- fields exactly: name, email, message — each with a <label>
- no other delivery-control fields; no client-side sending logic

FOUR-PAGE REQUIREMENT: home, about, services, contact — internal links /, /about, /services, /contact; every page links the other three; each page: <!DOCTYPE html>, lang attr, viewport meta, title, meta description, og:title/og:description, ONE <h1>, header/nav/main/footer, link site.css, script site.js (defer).

FOUR-PAGE HERO MEDIA (hard rule): EVERY routed page — home, about, services AND contact — must OPEN with its blueprint hero section carrying the hero's Accepted Image. Reference it exactly as <img src="IMG:{slotId}" data-image-id="{slotId}" alt="..."> (as the <img> itself, inside a <picture>, or as the media half of a split hero); the hero section element carries class or id containing "hero" (e.g. class="hero about-hero") so the hero and its image are identifiable. A typography-only or pale empty header is NOT acceptable on any page. Inner-page heroes carry roughly 0.45-0.75 viewport of hero visual mass on desktop (the Reference decides the exact treatment: photographic background with overlay, split hero, photographic band with inset panel, or full-bleed with wash); on mobile the hero keeps meaningful media height (about 35-50svh) — never a tiny strip, text stays readable, the primary subject survives the crop, and nothing hides behind the fixed navigation. Never reuse the home hero image on another page.

PROGRESSIVE ENHANCEMENT (hard rule): every section's content must be fully visible in plain HTML+CSS with JavaScript disabled and before any scroll event. All content must be visible in the base HTML/CSS state. JavaScript may animate from/to presentation states, but content visibility may never depend on JavaScript execution. Do not ship .reveal { opacity: 0 } or equivalent hidden-by-default content — use progressive enhancement. Scroll/entrance animation is an ENHANCEMENT applied by site.js to already-visible elements (site.js adds a class that animates from a small offset to the resting state; the resting CSS state is fully visible). Never define content hidden by default (opacity:0, visibility:hidden, transform off-screen) as its CSS resting state, and never require IntersectionObserver for content to appear. prefers-reduced-motion: reduce must keep every element fully visible with all animation disabled.`;
}

function oneCallUserPrompt(input: RunSimpleWebsiteBuilderInput): string {
  return `${buildSharedContext(input)}

TASK: Build the COMPLETE website in one response — all four full HTML pages, the full shared stylesheet implementing the blueprint's entire design system (tokens, type scale, layout, responsive breakpoints, hover states, reduced motion), and the small dependency-free shared script. Use the attached Reference screenshots as visual ground truth for the design language (never as content). Production-grade, no placeholders.`;
}

function shellCallUserPrompt(input: RunSimpleWebsiteBuilderInput): string {
  return `${buildSharedContext(input)}

TASK (1 of 2 — this call): Produce ONLY the shared foundation: the full "site.css" implementing the blueprint's entire design system (tokens as custom properties, type scale, layout for every planned section, responsive breakpoints, hover states, :focus-visible, prefers-reduced-motion) and the full "site.js" (navigation, reveals, header states — small, defensive, dependency-free). Use the attached Reference screenshots as visual ground truth (never as content).`;
}

function pagesCallUserPrompt(input: RunSimpleWebsiteBuilderInput, css?: string, js?: string): string {
  return `${buildSharedContext(input)}
${css ? `\nFROZEN site.css (already produced in this stage — the pages MUST use its vocabulary, selectors and custom properties; do not restyle):\n${css}\n` : ""}
TASK (2 of 2 — this call): Produce the four COMPLETE HTML pages (home, about, services, contact) realizing the blueprint section-by-section on top of that shared stylesheet and script. Full documents, production-grade, no placeholders.`;
}

// EXPERIMENT TRANSPORT ITERATION: with SIMPLE_STREAMING_TRANSPORT enabled,
// the builder's DEFAULT seam (no injected test seam) is the shared streaming
// boundary — text-only, JSON mode, General API. Transport only; injected
// seams (tests, driver) always take precedence.
function builderDefaultGenerate(env: Env, input: RunSimpleWebsiteBuilderInput): RawAiGenerate | undefined {
  if (input.visionGenerate) return input.visionGenerate;
  if (input.generate) return input.generate;
  if (simpleStreamingTransportEnabled(env)) {
    return async (systemPrompt, userPrompt) => {
      const result = await generateSimpleStreamingCompletion(env, {
        system: systemPrompt,
        user: userPrompt,
        // Streaming token floor (see vision.ts): no edge window applies.
        maxTokens: Math.max(32_000, 32_768),
        jsonMode: true,
        label: "simple-website-builder",
      });
      return { content: result.content, provider: result.provider, model: result.model };
    };
  }
  return undefined;
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
      strategy: "ONE_CALL",
    };
  }

  const stageArtifactBase = {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
  };

  // ONE structured call for the whole bundle (multimodal when the vision seam
  // exists). Transport budget: the bundle is the largest output in the
  // pipeline, so the max_tokens floor is raised.
  try {
    const run = await runSchemaValidatedAiStage<unknown>(env, {
      stage: "simple-website-builder",
      schema: SiteBundleSchema,
      schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
      userPrompt: oneCallUserPrompt(input),
      buildId: input.buildId,
      siteGenerationId: input.siteGenerationId,
      buildVersionId: input.buildVersionId,
      buildVersionNumber: input.buildVersionNumber,
      inputArtifactIds: [input.blueprint.businessFactsRef],
      maxTokens: 32000,
      generate: builderDefaultGenerate(env, input),
    });
    const bundle = run.value as SiteBundle;
    const stored = await storeBuildStageArtifactIdempotent(env, {
      ...stageArtifactBase,
      kind: "site_bundle",
      schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
      value: bundle,
      provenance: run.provenance,
    });
    return { bundle, artifactR2Key: stored.artifactR2Key, provenance: run.provenance, strategy: "ONE_CALL" };
  } catch (error) {
    // Section 26: fallback eligibility is explicit — the TWO-CALL fallback is
    // allowed for schema failure AND for a TERMINAL output-size/provider
    // transport failure (StreamingTransportExhaustedError). Any other error
    // (transient failures the engine should retry, domain errors) propagates.
    const transportExhausted = error instanceof StreamingTransportExhaustedError;
    if (!(error instanceof AiStageSchemaInvalidError) && !transportExhausted) throw error;
    // fall through to the allowed two-call fallback (same stage, same frozen
    // context) — one-call generation was unreliable for this transport.
  }

  // TWO-CALL SINGLE-STAGE fallback: shared shell first, then all four pages.
  const shellGenerate = builderDefaultGenerate(env, input);
  const shellRun = await runSchemaValidatedAiStage<unknown>(env, {
    stage: "simple-website-builder",
    schema: BuilderShellSchema,
    schemaVersion: "site-bundle-shell/1",
    userPrompt: shellCallUserPrompt(input),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.blueprint.businessFactsRef],
    maxTokens: 20000,
    generate: shellGenerate,
  });
  const shell = shellRun.value as { sharedCss: string; sharedJs: string };

  const pagesRun = await runSchemaValidatedAiStage<unknown>(env, {
    stage: "simple-website-builder",
    schema: BuilderPagesSchema,
    schemaVersion: "site-bundle-pages/1",
    userPrompt: pagesCallUserPrompt(input, shell.sharedCss, shell.sharedJs),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.blueprint.businessFactsRef, shellRun.artifactR2Key],
    maxTokens: 32000,
    generate: shellGenerate,
  });
  const pages = pagesRun.value as { pages: Record<"home" | "about" | "services" | "contact", string> };

  const bundle: SiteBundle = {
    version: "1",
    pages: pages.pages,
    sharedCss: shell.sharedCss,
    sharedJs: shell.sharedJs,
    notes: "Built via the allowed TWO-CALL SINGLE-STAGE fallback (spec section 35): shared shell, then all four pages together.",
  };
  const stored = await storeBuildStageArtifactIdempotent(env, {
    ...stageArtifactBase,
    kind: "site_bundle",
    schemaVersion: SITE_BUNDLE_SCHEMA_VERSION,
    value: bundle,
    provenance: pagesRun.provenance,
  });
  return { bundle, artifactR2Key: stored.artifactR2Key, provenance: pagesRun.provenance, strategy: "TWO_CALL_SINGLE_STAGE" };
}
