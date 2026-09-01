// V2 incremental REFERENCE_BOUND Site generation (issue #9, PRD sections
// 15-17). Generates a complete Home/About/Services/Contact Site from ONE
// Visual Blueprint + ONE Implementation Contract, incrementally:
//
//   1. shared design tokens/CSS (site.css)
//   2. shared runtime JS (site.js)
//   3. Home  4. About  5. Services  6. Contact
//   7. deterministic Image Plan (stable Image Slots)
//   8. deterministic cross-file assembly validation
//
// These are generation steps under the same fixed contracts, not independent
// designers: Reference-specific topology stays expressible because page
// structure mirrors the Blueprint regions, and there is no universal page
// template. Output is semantic HTML + shared site.css/site.js + minimal JS;
// images stay as unresolved IMG: slot placeholders until issue #10.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getEffectiveBusinessFacts } from "./revision";
import { storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import type { VisualBlueprint } from "./visual-blueprint";
import type { ImplementationContract } from "./implementation-planner";
import type { BusinessFacts } from "./lifecycle-schema";

export const IMAGE_PLAN_SCHEMA_VERSION = "image-plan/1";

export type PageId = "home" | "about" | "services" | "contact";
export const PAGE_IDS: readonly PageId[] = ["home", "about", "services", "contact"];

// ── AI step output schemas ──────────────────────────────────────────────────

export const SharedCssSchema = Type.Object({ css: Type.String({ minLength: 200 }) }, { additionalProperties: false });
export type SharedCss = Static<typeof SharedCssSchema>;

export const SharedJsSchema = Type.Object({ js: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export type SharedJs = Static<typeof SharedJsSchema>;

export const PageHtmlSchema = Type.Object({ html: Type.String({ minLength: 200 }) }, { additionalProperties: false });
export type PageHtml = Static<typeof PageHtmlSchema>;

// ── Image Plan (deterministic) ──────────────────────────────────────────────

export const ImageSlotSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 160 }),
    page: Type.Union([Type.Literal("home"), Type.Literal("about"), Type.Literal("services"), Type.Literal("contact")]),
    regionId: Type.Optional(Type.String({ minLength: 1 })),
    semanticRole: Type.String({ minLength: 1, maxLength: 2000 }),
    blueprintRole: Type.String({ minLength: 1, maxLength: 120 }),
    priority: Type.Union([Type.Literal("CRITICAL"), Type.Literal("HIGH"), Type.Literal("NORMAL")]),
    orientation: Type.Union([Type.Literal("landscape"), Type.Literal("portrait"), Type.Literal("square")]),
    negativeSpaceForText: Type.Boolean(),
  },
  { additionalProperties: false }
);
export type ImageSlot = Static<typeof ImageSlotSchema>;

export const ImagePlanSchema = Type.Object(
  { version: Type.String({ minLength: 1 }), slots: Type.Array(ImageSlotSchema, { minItems: 1 }) },
  { additionalProperties: false }
);
export type ImagePlan = Static<typeof ImagePlanSchema>;

// Stable semantic/compositional requirements derived from the Blueprint's
// image roles and homepage region mapping — deterministic, no AI. Enriched
// prompt fields (shot type, lighting, ...) are added by the KIE image prompt
// stage (issue #10); crop/remap/retries never change slot identity.
export function deriveImagePlan(blueprint: VisualBlueprint): ImagePlan {
  const slots: ImageSlot[] = [];
  const rolesById = new Map(blueprint.imageSystem.imageRoles.map((role) => [role.id, role]));

  for (const region of blueprint.homepageRegions) {
    if (!region.imageRoleId) continue;
    const role = rolesById.get(region.imageRoleId);
    if (!role) continue;
    slots.push({
      id: `home-${region.id}`,
      page: "home",
      regionId: region.id,
      semanticRole: role.purpose,
      blueprintRole: role.id,
      priority: role.priority,
      orientation: region.id.includes("hero") ? "landscape" : "landscape",
      negativeSpaceForText: region.id.includes("hero"),
    });
  }

  const innerPages: Array<{ page: PageId; suffix: string }> = [
    { page: "about", suffix: "main" },
    { page: "about", suffix: "detail" },
    { page: "services", suffix: "main" },
    { page: "services", suffix: "detail" },
    { page: "contact", suffix: "atmosphere" },
  ];
  for (const entry of innerPages) {
    const role = blueprint.imageSystem.imageRoles.find((candidate) =>
      entry.suffix === "main" ? candidate.priority !== "NORMAL" : candidate.priority === "NORMAL"
    ) ?? blueprint.imageSystem.imageRoles[0];
    slots.push({
      id: `${entry.page}-${entry.suffix}`,
      page: entry.page,
      semanticRole: role.purpose,
      blueprintRole: role.id,
      priority: entry.suffix === "main" ? "HIGH" : "NORMAL",
      orientation: entry.suffix === "atmosphere" ? "landscape" : "landscape",
      negativeSpaceForText: false,
    });
  }

  return { version: "1", slots };
}

// ── Assembly validation (deterministic, cross-file) ─────────────────────────

export interface AssemblyFinding {
  id: string;
  detail: string;
}

export interface AssembledSiteSource {
  pages: Record<PageId, string>;
  sharedCss: string;
  sharedJs: string;
}

const UNSUPPORTED_FACT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "FABRICATED_AWARD", pattern: /\b(award|winner|winning|prize|certified|certification|accredited)\b/i },
  { id: "FABRICATED_SOCIAL_PROOF", pattern: /\b\d+\s?\+?\s?(clients|customers|projects|reviews|testimonials|jobs)\b/i },
  { id: "FABRICATED_EXPERIENCE", pattern: /\b\d+\s?years?\s(of\s)?(experience|in business|serving)\b/i },
  { id: "FABRICATED_YEAR", pattern: /\bsince\s+(19|20)\d{2}\b/i },
  // Founding-year phrasing ("Established 1998", "Founded in 2004", "Est.
  // 1999") is an unsupported founding-date claim unless supplied as a fact.
  // Contextual verbs keep arbitrary years in addresses, phone numbers or
  // copyright lines from matching (QA-F3).
  { id: "FABRICATED_FOUNDING_YEAR", pattern: /\b(established|founded|est\.?)\s*(in\s+)?(19|20)\d{2}\b/i },
  { id: "FABRICATED_RATING", pattern: /\b(5\.0|four|five)\s?[- ]?star\b|\brated\s+\d(\.\d)?\/5\b/i },
];

// Deterministic cross-file validation of the assembled source (PRD section 15
// step 8). Semantic, navigation, contract, slot and fact-provenance rules.
export function validateAssembledSite(
  source: AssembledSiteSource,
  context: { contract: ImplementationContract; slots: ImageSlot[] }
): { passed: boolean; findings: AssemblyFinding[] } {
  const findings: AssemblyFinding[] = [];
  const pageFiles = new Set(
    Object.values(context.contract.files.pageFiles).map((file) => `/${file === "index.html" ? "" : file.replace(/\.html$/, "")}`)
  );
  const slotIds = new Set(context.slots.map((slot) => slot.id));

  for (const pageId of PAGE_IDS) {
    const html = source.pages[pageId];
    if (typeof html !== "string" || html.length === 0) {
      findings.push({ id: "MISSING_PAGE", detail: `page '${pageId}' was not generated` });
      continue;
    }
    const doc = html.toLowerCase();

    if (!doc.trimStart().startsWith("<!doctype html")) {
      findings.push({ id: "NON_SEMANTIC_STRUCTURE", detail: `${pageId}: missing <!DOCTYPE html>` });
    }
    for (const tag of ["<header", "<nav", "<main", "<footer"]) {
      if (!doc.includes(tag)) findings.push({ id: "NON_SEMANTIC_STRUCTURE", detail: `${pageId}: missing semantic <${tag.slice(1)}>` });
    }
    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    if (h1Count === 0) findings.push({ id: "MISSING_H1", detail: `${pageId}: no H1` });
    if (h1Count > 1) findings.push({ id: "MULTIPLE_H1", detail: `${pageId}: ${h1Count} H1 elements` });

    if (!doc.includes('rel="stylesheet" href="site.css"') && !doc.includes("href='site.css'") && !doc.includes('href="site.css"')) {
      findings.push({ id: "MISSING_SHARED_CSS_LINK", detail: `${pageId}: site.css not linked` });
    }
    if (!doc.includes('src="site.js"')) {
      findings.push({ id: "MISSING_SHARED_JS_LINK", detail: `${pageId}: site.js not referenced` });
    }
    if (!doc.includes('name="viewport"')) {
      findings.push({ id: "MISSING_VIEWPORT_META", detail: `${pageId}: no responsive viewport meta` });
    }

    for (const href of html.match(/href="\/[a-z]*"/gi) ?? []) {
      if (!pageFiles.has(href.slice(6, -1)) && href.slice(6, -1) !== "/") {
        findings.push({ id: "BROKEN_NAV_LINK", detail: `${pageId}: internal link ${href} resolves to no generated page` });
      }
    }
    for (const other of PAGE_IDS) {
      if (other === pageId) continue;
      const target = other === "home" ? 'href="/"' : `href="/${other}"`;
      if (!html.includes(target)) {
        findings.push({ id: "BROKEN_NAV_LINK", detail: `${pageId}: navigation misses link to '${other}' (${target})` });
      }
    }

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = /src="([^"]+)"/i.exec(tag)?.[1] ?? "";
      const dataId = /data-image-id="([^"]+)"/i.exec(tag)?.[1];
      if (!src.startsWith("IMG:")) {
        findings.push({ id: "IMG_NOT_SLOT_PLACEHOLDER", detail: `${pageId}: <img src="${src}"> is not an IMG: slot placeholder` });
      } else if (dataId !== src.slice(4)) {
        findings.push({ id: "IMG_MISSING_DATA_ID", detail: `${pageId}: data-image-id '${dataId ?? ""}' does not match slot src '${src}'` });
      } else if (!slotIds.has(src.slice(4))) {
        findings.push({ id: "UNKNOWN_IMG_SLOT", detail: `${pageId}: '${src.slice(4)}' is not a planned Image Slot` });
      }
    }

    for (const { id, pattern } of UNSUPPORTED_FACT_PATTERNS) {
      const text = html.replace(/<[^>]+>/g, " ");
      if (pattern.test(text)) {
        findings.push({ id, detail: `${pageId}: generated content invents an unsupported Business Fact (${pattern.source})` });
      }
    }
  }

  // Home mirrors Blueprint homepage topology via data-region attributes.
  const home = source.pages.home ?? "";
  for (const region of context.contract.pages.find((page) => page.id === "home")?.regions ?? []) {
    if (!home.includes(`data-region="${region.id}"`)) {
      findings.push({ id: "MISSING_REGION", detail: `home: Blueprint region '${region.id}' not realized (data-region)` });
    }
  }

  // Contact form browser contract: platform endpoint, no browser-controlled
  // recipient/sender/template fields.
  const contact = source.pages.contact ?? "";
  if (contact) {
    if (!contact.includes(`action="${context.contract.formContract.formServiceEndpoint}"`)) {
      findings.push({ id: "FORM_CONTRACT_VIOLATION", detail: "contact: form does not post to the WAZIBIZ Form Service endpoint" });
    }
    for (const forbidden of ['name="recipient"', 'name="to"', 'name="from"', 'name="sender"', 'name="template"']) {
      if (contact.toLowerCase().includes(forbidden)) {
        findings.push({ id: "FORM_CONTRACT_VIOLATION", detail: `contact: browser code controls delivery via ${forbidden}` });
      }
    }
  }

  if (!source.sharedCss.includes("@media")) {
    findings.push({ id: "NON_RESPONSIVE_CSS", detail: "site.css contains no @media responsive rules" });
  }
  if (source.sharedJs.trim().length === 0) {
    findings.push({ id: "MISSING_SHARED_JS", detail: "site.js is empty" });
  }

  return { passed: findings.length === 0, findings };
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function factsBlock(facts: BusinessFacts): string {
  return `SUPPORTED BUSINESS FACTS (use ONLY these; never invent awards, ratings, counts, years, prices, guarantees or testimonials):
${JSON.stringify(facts, null, 2)}`;
}

function cssPrompt(blueprint: VisualBlueprint, contract: ImplementationContract): string {
  return `Generate the shared stylesheet 'site.css' for the four-page Site. Realize the Visual Blueprint tokens, typography roles, color roles, global grid/container logic (including asymmetric column ratios), spacing rhythm, surface language, header/navigation language, motion grammar (transitions only, no libraries) and the responsive contract with real @media rules. Reference-specific grids, overlaps, clipping and asymmetry must survive — do NOT normalize to a generic centered template. Class names may be domain-specific to this design; there is no universal layout template. Anti-fallback rules are binding.

CONTRACT FILES: shared CSS file name '${contract.files.sharedCss}'.
BLUEPRINT:
${JSON.stringify(
  {
    tokens: blueprint.tokens,
    globalGrid: blueprint.globalGrid,
    spacingRhythm: blueprint.spacingRhythm,
    typographyRoles: blueprint.typographyRoles,
    colorRoles: blueprint.colorRoles,
    surfaceLanguage: blueprint.surfaceLanguage,
    headerNavigation: blueprint.headerNavigation,
    motionGrammar: blueprint.motionGrammar,
    responsiveContract: blueprint.responsiveContract,
    antiFallbackRules: blueprint.antiFallbackRules,
    accessibilityAdaptations: blueprint.accessibilityAdaptations,
  },
  null,
  2
)}`;
}

function jsPrompt(blueprint: VisualBlueprint): string {
  return `Generate the minimal shared runtime 'site.js' (no libraries, no frameworks). Requirements derived from the Blueprint: navigation menu toggle for the collapsed mobile nav, subtle reveal-on-scroll behavior matching the motion grammar with a prefers-reduced-motion guard, and nothing else.

MOTION GRAMMAR: ${JSON.stringify(blueprint.motionGrammar)}
RESPONSIVE CONTRACT: ${JSON.stringify(blueprint.responsiveContract)}`;
}

function pagePrompt(input: {
  pageId: PageId;
  blueprint: VisualBlueprint;
  contract: ImplementationContract;
  facts: BusinessFacts;
}): string {
  const { pageId, blueprint, contract, facts } = input;
  const page = contract.pages.find((candidate) => candidate.id === pageId)!;
  const base = `Generate the complete semantic HTML page '${page.path}' (document for page id '${pageId}'). Requirements:
- <!DOCTYPE html>, <html lang>, semantic <header>/<nav>/<main>/<footer>, exactly ONE <h1>.
- Link site.css, reference site.js, include the responsive viewport meta.
- Navigation links to /, /about, /services, /contact exactly.
- Every image is an unresolved placeholder: <img src="IMG:{slotId}" data-image-id="{slotId}" alt="..."> using ONLY the slot ids listed below.
- ${factsBlock(facts)}
- Derived marketing copy may interpret these facts safely but must not invent unsupported facts.`;

  if (pageId === "home") {
    return `${base}
- The page structure MUST realize the Blueprint homepage topology in order: each region rendered as a section carrying data-region="{regionId}" with the region's purpose.
- First viewport must match the Blueprint first-viewport description.
- Anti-fallback rules are binding: ${JSON.stringify(blueprint.antiFallbackRules)}.

HOMEPAGE REGIONS (ordered): ${JSON.stringify(blueprint.homepageRegions)}
FIRST VIEWPORT: ${JSON.stringify(blueprint.homepageFirstViewport)}
SIGNATURE TRAITS (must be visually expressed through structure/classes): ${JSON.stringify(blueprint.signatureTraits)}
AVAILABLE IMAGE SLOTS: home-region slots derived from regions with imageRoleId (use 'home-' + regionId).`;
  }
  if (pageId === "contact") {
    return `${base}
- Include the contact form implementing the platform form contract EXACTLY: <form method="post" action="${contract.formContract.formServiceEndpoint}"> with fields ${JSON.stringify(contract.formContract.fields)} plus a hidden input name="siteFormId" value="${contract.formContract.siteFormId}".
- Browser code must NOT contain any recipient, sender, template or credential control.
- Present supported contact facts (email/phone/address only when present in the facts).

FORM CONTRACT: ${JSON.stringify(contract.formContract)}
AVAILABLE IMAGE SLOTS: contact-atmosphere.`;
  }
  return `${base}
- Build the page from the Blueprint inner-page vocabulary: ${JSON.stringify(blueprint.innerPageVocabulary)}.
- Present only supported facts for this Business (description, type, city/country, socials when present).

AVAILABLE IMAGE SLOTS: ${pageId}-main, ${pageId}-detail.`;
}

// ── Generation service ──────────────────────────────────────────────────────

export class SiteGenerationValidationError extends Error {
  constructor(readonly findings: AssemblyFinding[]) {
    super(`Assembled Site failed deterministic assembly validation: ${findings.map((finding) => `${finding.id} (${finding.detail})`).join("; ")}`);
    this.name = "SiteGenerationValidationError";
  }
}

export interface GenerateCompleteSiteInput {
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  blueprint: VisualBlueprint;
  blueprintR2Key: string;
  contract: ImplementationContract;
  contractR2Key: string;
  generate?: RawAiGenerate;
}

export interface GeneratedSite extends AssembledSiteSource {
  imagePlan: ImagePlan;
  validation: { passed: boolean; findings: AssemblyFinding[] };
  artifacts: Array<{ kind: string; subkey: string; r2Key: string }>;
}

export async function generateCompleteSite(
  env: Env,
  input: GenerateCompleteSiteInput
): Promise<GeneratedSite> {
  const factsResult = await getEffectiveBusinessFacts(env, input.buildId);
  const facts = factsResult.facts;
  const stageInput = {
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.blueprintR2Key, input.contractR2Key],
    generate: input.generate,
    temperature: 0.35,
  };

  // 1. shared tokens/CSS  2. shared runtime JS — incremental steps.
  const cssRun = await runSchemaValidatedAiStage<SharedCss>(env, {
    ...stageInput,
    stage: "website-generator",
    schema: SharedCssSchema,
    schemaVersion: "generated-source/site-css/1",
    userPrompt: cssPrompt(input.blueprint, input.contract),
  });
  const jsRun = await runSchemaValidatedAiStage<SharedJs>(env, {
    ...stageInput,
    stage: "website-generator",
    schema: SharedJsSchema,
    schemaVersion: "generated-source/site-js/1",
    userPrompt: jsPrompt(input.blueprint),
  });

  // 3-6. one page at a time under the same fixed contracts.
  const pages: Partial<Record<PageId, string>> = {};
  const pageRuns: Array<{ pageId: PageId; run: { value: PageHtml; artifactR2Key: string } }> = [];
  for (const pageId of PAGE_IDS) {
    const run = await runSchemaValidatedAiStage<PageHtml>(env, {
      ...stageInput,
      stage: "website-generator",
      schema: PageHtmlSchema,
      schemaVersion: `generated-source/page-${pageId}/1`,
      userPrompt: pagePrompt({ pageId, blueprint: input.blueprint, contract: input.contract, facts }),
    });
    pages[pageId] = run.value.html;
    pageRuns.push({ pageId, run: { value: run.value, artifactR2Key: run.artifactR2Key } });
  }

  // 7. deterministic Image Plan (stable Image Slots).
  const imagePlan = deriveImagePlan(input.blueprint);
  if (!Value.Check(ImagePlanSchema, imagePlan)) {
    throw new Error("derived image plan failed its schema");
  }

  const source: AssembledSiteSource = {
    pages: pages as Record<PageId, string>,
    sharedCss: cssRun.value.css,
    sharedJs: jsRun.value.js,
  };

  // 8. deterministic cross-file assembly validation BEFORE anything flows
  // downstream.
  const validation = validateAssembledSite(source, { contract: input.contract, slots: imagePlan.slots });
  if (!validation.passed) {
    throw new SiteGenerationValidationError(validation.findings);
  }

  // Persist the validated generated source immutably per Build Version.
  const artifacts: GeneratedSite["artifacts"] = [];
  await storeBuildStageArtifact(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "generated_shared_source", subkey: "site.css", schemaVersion: "generated-source/site-css/1",
    value: cssRun.value, provenance: cssRun.provenance,
  }).then((stored) => artifacts.push({ kind: "generated_shared_source", subkey: "site.css", r2Key: stored.artifactR2Key }));
  await storeBuildStageArtifact(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "generated_shared_source", subkey: "site.js", schemaVersion: "generated-source/site-js/1",
    value: jsRun.value, provenance: jsRun.provenance,
  }).then((stored) => artifacts.push({ kind: "generated_shared_source", subkey: "site.js", r2Key: stored.artifactR2Key }));
  for (const { pageId, run } of pageRuns) {
    await storeBuildStageArtifact(env, {
      buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
      kind: "generated_page", subkey: pageId, schemaVersion: `generated-source/page-${pageId}/1`,
      value: run.value, provenance: null,
    }).then((stored) => artifacts.push({ kind: "generated_page", subkey: pageId, r2Key: stored.artifactR2Key }));
  }
  const imagePlanStored: StoredStageArtifact = await storeBuildStageArtifact(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId, siteGenerationId: input.siteGenerationId,
    kind: "image_plan", schemaVersion: IMAGE_PLAN_SCHEMA_VERSION, value: imagePlan,
  });
  artifacts.push({ kind: "image_plan", subkey: "", r2Key: imagePlanStored.artifactR2Key });

  // NOTE: the canonical builds/{id}/v{n}/source/* freeze happens in the
  // assembly stage with image placeholders RESOLVED; generation itself only
  // persists the immutable stage artifacts above.

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "IMPLEMENTATION_PLAN", toState: "SITE_GENERATION", stage: "site_generation",
    detail: `Four pages + shared source + ${imagePlan.slots.length} Image Slots generated incrementally from one Blueprint + one Implementation Contract`,
  });
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "SITE_GENERATION", toState: "SITE_VALIDATION", stage: "site_validation",
    detail: "Deterministic cross-file assembly validation passed",
  });

  return { ...source, imagePlan, validation, artifacts };
}
