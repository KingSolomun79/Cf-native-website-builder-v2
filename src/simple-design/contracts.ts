// SIMPLE design pipeline contracts (experiment/simplified-design-pipeline).
//
// THREE versioned artifacts replace the entire legacy design chain
// (reference analysis → visual blueprint → trait obligations → implementation
// contract → per-page generation → assembly/craft/realization repair):
//
//   design-blueprint/1  — ONE rich, implementation-ready design document.
//                         The Reference screenshot is DESIGN AUTHORITY; the
//                         blueprint is its interpretation. It never carries
//                         Business Facts (businessFactsRef only).
//   site-bundle/1       — the ONE Website Builder's raw semantic output:
//                         four pages + shared CSS/JS. Pages reference images
//                         via IMG:{slotId} placeholders (same deterministic
//                         assembly convention as legacy).
//   qa-package/1        — the combined visual + truth + technical QA object
//                         that feeds the ONE repair.
//
// Deliberately NO: region identity ledgers, trait obligations, canonical
// region topology, repair contracts. If this file starts accumulating those,
// the experiment has drifted back toward the architecture it replaces.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { resolveProviderAspectRatio, aspectRatioClass } from "../lib/aspect-ratio";
import type { ImagePromptRecord } from "../domain/image-pipeline";
import type { ImageSlot } from "../domain/site-generator";

export const DESIGN_BLUEPRINT_SCHEMA_VERSION = "design-blueprint/1";
export const SITE_BUNDLE_SCHEMA_VERSION = "site-bundle/1";
export const SIMPLE_VISUAL_QA_SCHEMA_VERSION = "simple-visual-qa/1";
export const QA_PACKAGE_SCHEMA_VERSION = "qa-package/1";

// ── design-blueprint/1 ──────────────────────────────────────────────────────

// A CSS color value — hex preferred, rgba()/hsl() legal where the design
// needs translucency.
const colorValue = Type.String({ minLength: 3, maxLength: 40 });
const trimmed = (maxLength: number) => Type.String({ minLength: 1, maxLength });

// Schema-convergence brief §10: color tokens describe ROLES, not a fixed set
// of property names. A typed array lets the blueprint express the observed
// design language ("page-ground", "violet-accent") without inventing
// arbitrary JSON keys; the count limits keep it a system, not a dump.
export const BlueprintColorRoleSchema = Type.Object(
  {
    role: trimmed(80),
    value: colorValue,
    usage: trimmed(400),
  },
  { additionalProperties: false }
);

export const BlueprintImageSlotSchema = Type.Object(
  {
    id: Type.String({ minLength: 3, maxLength: 80, pattern: "^[a-z0-9][a-z0-9-]*$" }),
    page: Type.Union([
      Type.Literal("home"),
      Type.Literal("about"),
      Type.Literal("services"),
      Type.Literal("contact"),
    ]),
    section: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    priority: Type.Union([Type.Literal("CRITICAL"), Type.Literal("HIGH"), Type.Literal("NORMAL")]),
    // Schema-convergence brief §9: the DESIGN ratio and the PROVIDER
    // GENERATION ratio are separate concepts. An observed composition may
    // legitimately be 21:9 or 2.2:1 even though the image provider cannot
    // generate that exact frame; cropStrategy bridges the difference. Never
    // make one masquerade as the other.
    compositionAspectRatio: Type.String({
      minLength: 2,
      maxLength: 16,
      pattern: "^[0-9]{1,4}(?:\\.[0-9]{1,2})?:[0-9]{1,4}(?:\\.[0-9]{1,2})?$",
    }),
    generationAspectRatio: Type.Union([
      Type.Literal("16:9"),
      Type.Literal("4:3"),
      Type.Literal("3:2"),
      Type.Literal("1:1"),
      Type.Literal("9:16"),
    ]),
    cropStrategy: Type.Optional(Type.String({ minLength: 2, maxLength: 200 })),
    visualMass: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    subjectDirection: Type.String({ minLength: 5, maxLength: 800 }),
    compositionDirection: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
    lighting: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    palette: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    cropBehavior: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    // The blueprint itself emits the generation prompt — no extra LLM stage
    // (spec section 21). The KIE adapter caps prompts at 1000 chars.
    kiePrompt: Type.String({ minLength: 40, maxLength: 900 }),
    negativePrompt: Type.String({ minLength: 2, maxLength: 900 }),
    altText: Type.String({ minLength: 5, maxLength: 500 }),
  },
  { additionalProperties: false }
);
export type BlueprintImageSlot = Static<typeof BlueprintImageSlotSchema>;

export const BlueprintSectionSpecSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 160 }),
    purpose: Type.String({ minLength: 1, maxLength: 1200 }),
    layout: Type.String({ minLength: 1, maxLength: 2000 }),
    visualMass: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
    surface: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
    typography: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
    media: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
    cta: Type.Optional(Type.String({ minLength: 1, maxLength: 800 })),
    responsive: Type.Optional(Type.String({ minLength: 1, maxLength: 1200 })),
    // FOUR-PAGE HERO MEDIA (operator GO, 2026-09-09): every routed page opens
    // with a photographic hero. The page spec's FIRST section names the image
    // slot that carries its hero photography — the deterministic quality gate
    // enforces the link (slot exists, same page, hero section, CRITICAL/HIGH,
    // unique per page). No typography-only pale page header.
    mediaSlotId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  },
  { additionalProperties: false }
);
export type BlueprintSectionSpec = Static<typeof BlueprintSectionSpecSchema>;

export const DesignBlueprintSchema = Type.Object(
  {
    version: Type.Literal("1"),
    // Provenance pointer at the immutable Business Facts — the blueprint is
    // NEVER the content authority (spec section 14).
    businessFactsRef: Type.String({ minLength: 3, maxLength: 400 }),
    projectFrame: Type.Object(
      {
        siteType: trimmed(200),
        industry: trimmed(120),
        pageJob: trimmed(1200),
        emotionalReference: Type.Optional(trimmed(600)),
        designCharacter: trimmed(1200),
        referenceDesignThesis: trimmed(1200),
        antiPattern: trimmed(1200),
      },
      { additionalProperties: false }
    ),
    // 5-8 falsifiable, checkable rules (spec sections 12/30).
    designDna: Type.Array(Type.String({ minLength: 10, maxLength: 600 }), { minItems: 5, maxItems: 8 }),
    tokens: Type.Object(
      {
        colors: Type.Array(BlueprintColorRoleSchema, { minItems: 3, maxItems: 12 }),
        typography: Type.Object(
          {
            display: Type.Object(
              {
                family: trimmed(200),
                fallback: Type.Optional(trimmed(200)),
                weightGuidance: trimmed(200),
              },
              { additionalProperties: false }
            ),
            body: Type.Object(
              {
                family: trimmed(200),
                fallback: Type.Optional(trimmed(200)),
                weightGuidance: trimmed(200),
              },
              { additionalProperties: false }
            ),
            scale: Type.Array(
              Type.Object(
                {
                  element: trimmed(80),
                  family: trimmed(60),
                  weight: Type.Optional(Type.Integer({ minimum: 100, maximum: 900 })),
                  sizeClamp: Type.String({ minLength: 3, maxLength: 120 }),
                  lineHeight: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
                  // Structural bounds only (schema-convergence brief §8): the
                  // role-aware design floors live in validateDesignBlueprint —
                  // display type legitimately uses narrow measures, so one
                  // global minimum of 20ch was an over-strict design
                  // preference, not structure.
                  maxWidthCh: Type.Optional(Type.Integer({ minimum: 4, maximum: 120 })),
                },
                { additionalProperties: false }
              ),
              { minItems: 4, maxItems: 12 }
            ),
          },
          { additionalProperties: false }
        ),
        shape: Type.Object(
          {
            borderRadius: trimmed(120),
            shadowPolicy: trimmed(300),
            texture: Type.Optional(trimmed(400)),
          },
          { additionalProperties: false }
        ),
        layout: Type.Object(
          {
            containerWidth: trimmed(120),
            sectionSpacing: trimmed(300),
            imageTreatment: trimmed(400),
          },
          { additionalProperties: false }
        ),
      },
      { additionalProperties: false }
    ),
    globalChrome: Type.Object(
      {
        header: Type.Object(
          {
            layout: trimmed(800),
            states: Type.Array(Type.String({ minLength: 3, maxLength: 400 }), { minItems: 1, maxItems: 6 }),
          },
          { additionalProperties: false }
        ),
        navigation: Type.Object(
          {
            desktop: trimmed(600),
            mobile: trimmed(600),
          },
          { additionalProperties: false }
        ),
        primaryCta: trimmed(600),
        footer: trimmed(1200),
        formBehavior: trimmed(800),
        overlays: Type.Optional(trimmed(800)),
      },
      { additionalProperties: false }
    ),
    motion: Type.Object(
      {
        interactions: Type.Array(
          Type.Object(
            {
              element: trimmed(120),
              trigger: trimmed(120),
              effect: trimmed(400),
              duration: Type.Optional(trimmed(60)),
              easing: Type.Optional(trimmed(120)),
            },
            { additionalProperties: false }
          ),
          { maxItems: 12 }
        ),
        scrollBehavior: Type.Optional(trimmed(400)),
        reducedMotion: trimmed(600),
      },
      { additionalProperties: false }
    ),
    pages: Type.Object(
      {
        home: Type.Object({ sections: Type.Array(BlueprintSectionSpecSchema, { minItems: 4, maxItems: 12 }) }, { additionalProperties: false }),
        about: Type.Object({ sections: Type.Array(BlueprintSectionSpecSchema, { minItems: 2, maxItems: 8 }) }, { additionalProperties: false }),
        services: Type.Object({ sections: Type.Array(BlueprintSectionSpecSchema, { minItems: 2, maxItems: 8 }) }, { additionalProperties: false }),
        contact: Type.Object({ sections: Type.Array(BlueprintSectionSpecSchema, { minItems: 2, maxItems: 8 }) }, { additionalProperties: false }),
      },
      { additionalProperties: false }
    ),
    signatureElements: Type.Array(Type.String({ minLength: 5, maxLength: 400 }), { minItems: 3, maxItems: 5 }),
    antiPatterns: Type.Array(Type.String({ minLength: 5, maxLength: 400 }), { minItems: 3, maxItems: 12 }),
    imagery: Type.Object(
      {
        grade: trimmed(800),
        imageSlots: Type.Array(BlueprintImageSlotSchema, { minItems: 1, maxItems: 16 }),
      },
      { additionalProperties: false }
    ),
    responsive: Type.Object(
      {
        desktop: trimmed(1200),
        tablet: trimmed(1200),
        mobile: trimmed(1200),
      },
      { additionalProperties: false }
    ),
    accessibility: Type.Object(
      {
        reducedMotion: trimmed(600),
        focusVisible: Type.Optional(trimmed(400)),
        keyboardNavigation: Type.Optional(trimmed(400)),
        forms: Type.Optional(trimmed(400)),
        performance: Type.Optional(trimmed(400)),
      },
      { additionalProperties: false }
    ),
    acceptanceChecklist: Type.Array(Type.String({ minLength: 8, maxLength: 400 }), { minItems: 10, maxItems: 20 }),
  },
  { additionalProperties: false }
);
export type DesignBlueprint = Static<typeof DesignBlueprintSchema>;

// Schema-convergence brief §8: measure floors are role-aware. Display /
// hero / statement typography frequently uses intentionally narrow measures
// (a 12ch hero headline is not schema-invalid); body reading measure keeps a
// modest floor; UI labels may be small. These are FLOORS only — the brief's
// §7 principle forbids replacing one arbitrary preferred range with another,
// so no new upper bounds beyond the structural 120ch ceiling.
const TYPE_MEASURE_FLOORS: Array<{ pattern: RegExp; minCh: number; label: string }> = [
  { pattern: /display|hero|headline|statement|masthead/i, minCh: 8, label: "display/hero/statement" },
  { pattern: /body|paragraph|prose|reading/i, minCh: 20, label: "body/reading" },
];
const UI_MEASURE_FLOOR = 4;

function measureFloor(element: string): { minCh: number; label: string } {
  for (const entry of TYPE_MEASURE_FLOORS) {
    if (entry.pattern.test(element)) return { minCh: entry.minCh, label: entry.label };
  }
  return { minCh: UI_MEASURE_FLOOR, label: "ui" };
}

export function validateDesignBlueprint(value: unknown): { valid: true; value: DesignBlueprint } | { valid: false; errors: string } {
  const candidate = value as unknown;
  if (!Value.Check(DesignBlueprintSchema, candidate)) {
    const issues: string[] = [];
    for (const error of Value.Errors(DesignBlueprintSchema, candidate)) {
      issues.push(`${error.path}: ${error.message}`);
      if (issues.length >= 12) break;
    }
    return { valid: false, errors: issues.join("; ") };
  }
  const blueprint = candidate as DesignBlueprint;
  const measureIssues: string[] = [];
  for (const row of blueprint.tokens.typography.scale) {
    if (row.maxWidthCh === undefined) continue;
    const floor = measureFloor(row.element);
    if (row.maxWidthCh < floor.minCh) {
      measureIssues.push(`tokens.typography.scale '${row.element}': maxWidthCh ${row.maxWidthCh} is below the ${floor.label} floor of ${floor.minCh}ch`);
    }
  }
  if (measureIssues.length > 0) {
    return { valid: false, errors: measureIssues.slice(0, 12).join("; ") };
  }
  return { valid: true, value: blueprint };
}

// Workers AI native structured output (schema-convergence brief §3): the
// blueprint's JSON Schema in the provider's OpenAI-style wrapper. Wrapper
// shape verified against `wrangler ai models schema @cf/zai-org/glm-5.3-flash`
// (response_format.json_schema: { name (required), schema, description?,
// strict? }). The JSON round-trip strips TypeBox symbol metadata so the
// payload is plain JSON Schema.
export const DESIGN_BLUEPRINT_NATIVE_JSON_SCHEMA = {
  name: "design-blueprint",
  description: "A complete design-blueprint/1 website design document.",
  schema: JSON.parse(JSON.stringify(DesignBlueprintSchema)) as Record<string, unknown>,
} as const;

// Deterministic blueprint quality gate (spec section 30): SMALL, structural
// checks only. No identity cardinality, no trait obligations, no region
// coverage. The schema already enforces the counts; these are the human-audit
// assertions that stay true even if the schema loosens later. Null-safe on
// purpose: it is the belt to the schema's braces.
export function evaluateBlueprintQualityGate(blueprint: DesignBlueprint): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const dna = blueprint?.designDna ?? [];
  if (dna.length < 5 || dna.length > 8) {
    failures.push(`designDna must have 5-8 rules (got ${dna.length})`);
  }
  for (const page of ["home", "about", "services", "contact"] as const) {
    if (!blueprint?.pages?.[page]?.sections?.length) {
      failures.push(`page spec '${page}' missing or empty`);
    }
  }
  const signatures = blueprint?.signatureElements ?? [];
  if (signatures.length < 3 || signatures.length > 5) {
    failures.push(`signatureElements must have 3-5 entries (got ${signatures.length})`);
  }
  const responsive = blueprint?.responsive;
  if (!responsive?.desktop || !responsive?.tablet || !responsive?.mobile) {
    failures.push("responsive spec must cover desktop, tablet and mobile");
  }
  if (!blueprint?.antiPatterns?.length) failures.push("antiPatterns missing");
  const checklist = blueprint?.acceptanceChecklist ?? [];
  if (checklist.length < 10 || checklist.length > 20) {
    failures.push(`acceptanceChecklist must have 10-20 entries (got ${checklist.length})`);
  }
  const slots = blueprint?.imagery?.imageSlots ?? [];
  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) failures.push(`duplicate image slot id '${slot.id}'`);
    slotIds.add(slot.id);
    if (!slot.kiePrompt || slot.kiePrompt.length < 40) failures.push(`image slot '${slot.id}' has no usable kiePrompt`);
  }

  // FOUR-PAGE HERO MEDIA (operator GO, 2026-09-09): every routed page's FIRST
  // section is a photographic hero linked to a dedicated hero image slot —
  // existing, same page, hero section, CRITICAL/HIGH priority. The same-page
  // requirement IS the unique-page-hero default: a slot belongs to exactly one
  // page, so no second page's hero can reference it without failing here.
  for (const page of ["home", "about", "services", "contact"] as const) {
    const firstSection = blueprint?.pages?.[page]?.sections?.[0];
    if (!firstSection) continue; // missing page spec already reported above
    if (!/hero/i.test(firstSection.name)) {
      failures.push(`page '${page}' must open with a hero section (first section '${firstSection.name}')`);
      continue;
    }
    const mediaSlotId = firstSection.mediaSlotId;
    if (!mediaSlotId) {
      failures.push(`page '${page}' hero section has no mediaSlotId — every page needs a photographic hero`);
      continue;
    }
    const slot = slots.find((candidate) => candidate.id === mediaSlotId);
    if (!slot) {
      failures.push(`page '${page}' hero mediaSlotId '${mediaSlotId}' does not match any image slot`);
      continue;
    }
    if (slot.page !== page) {
      failures.push(`page '${page}' hero slot '${mediaSlotId}' belongs to page '${slot.page}' — page heroes are unique by default`);
      continue;
    }
    if (!/hero/i.test(slot.section ?? "")) {
      failures.push(`page '${page}' hero slot '${mediaSlotId}' must target the hero section (got '${slot.section ?? "none"}')`);
      continue;
    }
    if (slot.priority === "NORMAL") {
      failures.push(`page '${page}' hero slot '${mediaSlotId}' must be CRITICAL or HIGH priority`);
    }
  }
  return { passed: failures.length === 0, failures };
}

// The hero image slot id for a routed page from its blueprint spec (first
// section's mediaSlotId), or null when the blueprint does not declare one.
export function blueprintHeroSlotId(blueprint: DesignBlueprint, page: "home" | "about" | "services" | "contact"): string | null {
  const firstSection = blueprint?.pages?.[page]?.sections?.[0];
  const mediaSlotId = firstSection?.mediaSlotId;
  if (!mediaSlotId) return null;
  const slot = blueprint?.imagery?.imageSlots?.find((candidate) => candidate.id === mediaSlotId);
  return slot && slot.page === page ? mediaSlotId : null;
}

// ── site-bundle/1 ───────────────────────────────────────────────────────────

export const SiteBundleSchema = Type.Object(
  {
    version: Type.Literal("1"),
    pages: Type.Object(
      {
        home: Type.String({ minLength: 200 }),
        about: Type.String({ minLength: 200 }),
        services: Type.String({ minLength: 200 }),
        contact: Type.String({ minLength: 200 }),
      },
      { additionalProperties: false }
    ),
    sharedCss: Type.String({ minLength: 200 }),
    sharedJs: Type.String({ minLength: 1 }),
    // Free-text builder notes for the operator (build strategy, assumptions).
    notes: Type.Optional(Type.String({ maxLength: 4000 })),
  },
  { additionalProperties: false }
);
export type SiteBundle = Static<typeof SiteBundleSchema>;

// ── simple-visual-qa/1 ──────────────────────────────────────────────────────

const score = Type.Integer({ minimum: 0, maximum: 100 });

export const VisualQaScoresSchema = Type.Object(
  {
    macroLayout: score,
    typography: score,
    spacingRhythm: score,
    surfaceColor: score,
    imageTreatment: score,
    components: score,
    signatureElements: score,
    responsive: score,
    overall: score,
  },
  { additionalProperties: false }
);
export type VisualQaScores = Static<typeof VisualQaScoresSchema>;

export const VisualQaReportSchema = Type.Object(
  {
    version: Type.Literal("1"),
    scores: VisualQaScoresSchema,
    // High-impact deviations ONLY, ranked by visual impact (spec section 44).
    findings: Type.Array(
      Type.Object(
        {
          rank: Type.Integer({ minimum: 1, maximum: 5 }),
          title: Type.String({ minLength: 5, maxLength: 300 }),
          reference: Type.String({ minLength: 1, maxLength: 800 }),
          candidate: Type.String({ minLength: 1, maxLength: 800 }),
          direction: Type.String({ minLength: 5, maxLength: 800 }),
        },
        { additionalProperties: false }
      ),
      { maxItems: 5 }
    ),
    summary: Type.String({ minLength: 10, maxLength: 2000 }),
  },
  { additionalProperties: false }
);
export type VisualQaReport = Static<typeof VisualQaReportSchema>;

// Spec section 43/48/54: first-pass success needs overall >= 90 and no
// critical macro category below 85.
export const SIMPLE_VISUAL_OVERALL_THRESHOLD = 90;
export const SIMPLE_VISUAL_CATEGORY_THRESHOLD = 85;

export function evaluateVisualQaPass(report: VisualQaReport): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (report.scores.overall < SIMPLE_VISUAL_OVERALL_THRESHOLD) {
    failures.push(`visual overall ${report.scores.overall} < ${SIMPLE_VISUAL_OVERALL_THRESHOLD}`);
  }
  for (const [category, value] of Object.entries(report.scores)) {
    if (category === "overall") continue;
    if (value < SIMPLE_VISUAL_CATEGORY_THRESHOLD) {
      failures.push(`visual category '${category}' ${value} < ${SIMPLE_VISUAL_CATEGORY_THRESHOLD}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

// ── qa-package/1 ────────────────────────────────────────────────────────────

export interface SimpleTruthFinding {
  id: string;
  detail: string;
}

export interface SimpleTechnicalFinding {
  id: string;
  severity: "blocker" | "warning";
  detail: string;
}

export interface QaPackage {
  version: "1";
  buildVersionNumber: number;
  /** Null when the candidate could not be rendered (assembly preflight
   *  blockers) — the package then carries deterministic findings only. */
  visual: VisualQaReport | null;
  truth: { findings: SimpleTruthFinding[]; blockerCount: number };
  technical: { findings: SimpleTechnicalFinding[]; blockerCount: number };
  releaseReady: boolean;
  reasons: string[];
  referenceScreenshotKeys: { desktop: string; mobile?: string };
  candidateScreenshotKeys: { desktop: string; mobile?: string };
}

// ── Blueprint image slots → existing KIE machinery (spec section 21) ───────

// Orientation follows the ratio the PROVIDER will actually be asked for —
// resolved from the blueprint's composition/generation pair by the same
// bridge the KIE adapter uses. Judging a correct provider image against the
// legacy generation-ratio class burned both attempts of 4:3-composition /
// 1:1-generation slots in the four-page-hero regression (live finding
// 2026-09-09); orientation and request ratio must never disagree.
function orientationForSlot(slot: BlueprintImageSlot): ImageSlot["orientation"] {
  const legacyRatio =
    slot.generationAspectRatio === "9:16" ? "9:16" : slot.generationAspectRatio === "1:1" ? "1:1" : "16:9";
  const resolved = resolveProviderAspectRatio(slot.compositionAspectRatio, slot.generationAspectRatio, legacyRatio);
  return aspectRatioClass(resolved.providerAspectRatio);
}

// Deterministic, zero-LLM bridge: the Design Blueprint's own slot fields map
// onto the legacy ImageSlot + ImagePromptRecord shapes the durable KIE
// orchestrator consumes. No kie-image-prompt-generator call — the blueprint
// IS the image prompt authority (spec sections 20-21).
export function blueprintSlotsToImageSlots(blueprint: DesignBlueprint): ImageSlot[] {
  return blueprint.imagery.imageSlots.map((slot) => ({
    id: slot.id,
    page: slot.page,
    ...(slot.section ? { regionId: slot.section } : {}),
    semanticRole: `${slot.subjectDirection}${slot.compositionDirection ? ` — ${slot.compositionDirection}` : ""}`,
    blueprintRole: `simple-${slot.section || slot.page}`,
    priority: slot.priority,
    orientation: orientationForSlot(slot),
    // Both blueprint ratios travel with the slot as provenance; the provider
    // adapter maps them onto the selected model's supported request ratios.
    compositionAspectRatio: slot.compositionAspectRatio,
    generationAspectRatio: slot.generationAspectRatio,
    negativeSpaceForText:
      /text overlay|negative space|dark enough for|space for (a )?(headline|text)/i.test(
        `${slot.compositionDirection ?? ""} ${slot.kiePrompt}`
      ) || /hero/i.test(slot.section ?? ""),
  }));
}

export function blueprintSlotsToPromptRecords(blueprint: DesignBlueprint): ImagePromptRecord[] {
  return blueprint.imagery.imageSlots.map((slot) => ({
    slotId: slot.id,
    promptText: slot.kiePrompt,
    altText: slot.altText,
    shotType: (slot.visualMass || slot.compositionDirection || slot.subjectDirection).slice(0, 120),
    lighting: (slot.lighting || "natural light").slice(0, 500),
    avoidance: slot.negativePrompt.slice(0, 1000),
  }));
}
