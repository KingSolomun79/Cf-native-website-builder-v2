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
import {
  SITE_BUNDLE_SCHEMA_VERSION,
  SiteBundleSchema,
  type DesignBlueprint,
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
  blueprint: DesignBlueprint;
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

FOUR-PAGE REQUIREMENT: home, about, services, contact — internal links /, /about, /services, /contact; every page links the other three; each page: <!DOCTYPE html>, lang attr, viewport meta, title, meta description, og:title/og:description, ONE <h1>, header/nav/main/footer, link site.css, script site.js (defer).`;
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
      generate: input.visionGenerate ?? input.generate,
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
    if (!(error instanceof AiStageSchemaInvalidError)) throw error;
    // fall through to the allowed two-call fallback (same stage, same frozen
    // context) — one-call generation was unreliable for this transport.
  }

  // TWO-CALL SINGLE-STAGE fallback: shared shell first, then all four pages.
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
    generate: input.visionGenerate ?? input.generate,
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
    generate: input.visionGenerate ?? input.generate,
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
