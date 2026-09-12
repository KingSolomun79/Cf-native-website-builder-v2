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
import type { ImageSlot } from "../domain/site-contracts";

export const DESIGN_BLUEPRINT_SCHEMA_VERSION = "design-blueprint/1";
// design-blueprint/2 (operator GO, 2026-09-10): four-page heroes become
// STRUCTURAL schema invariants. The model decides hero design only — hero
// presence, hero slot ids, page ownership and priority are deterministic
// domain construction. v1 artifacts stay immutable historical evidence.
export const DESIGN_BLUEPRINT_V2_SCHEMA_VERSION = "design-blueprint/2";
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

// ── Deterministic hero-link canonicalization (operator GO, 2026-09-10) ──────

// The model has to state the hero→slot relationship twice (the slot plan AND
// the section's mediaSlotId). That duplicated bookkeeping is a referential
// lottery, not a design decision — so when the section link is missing or
// wrong but the target is UNIQUELY derivable from the blueprint's own
// image-slot plan, deterministic code resolves it. This is referential
// normalization ONLY: never section order, names, layout, imagery content,
// priorities or any other design semantics.
export interface HeroMediaLinkCanonicalizationEntry {
  page: "home" | "about" | "services" | "contact";
  supplied: string | null;
  resolved: string;
  reason: "UNIQUE_PAGE_HERO_SLOT";
}

export interface HeroMediaLinkCanonicalization {
  applied: boolean;
  links: HeroMediaLinkCanonicalizationEntry[];
}

// Qualifying hero image slot for a routed page — the exact predicate the
// quality gate enforces: same page, hero section, CRITICAL/HIGH priority.
function isQualifyingHeroSlot(slot: BlueprintImageSlot, page: "home" | "about" | "services" | "contact"): boolean {
  return slot.page === page && /hero/i.test(slot.section ?? "") && slot.priority !== "NORMAL";
}

export function canonicalizeBlueprintHeroMediaLinks(blueprint: DesignBlueprint): {
  blueprint: DesignBlueprint;
  canonicalization: HeroMediaLinkCanonicalization;
} {
  const links: HeroMediaLinkCanonicalizationEntry[] = [];
  const slots = blueprint?.imagery?.imageSlots ?? [];
  for (const page of ["home", "about", "services", "contact"] as const) {
    const firstSection = blueprint?.pages?.[page]?.sections?.[0];
    // Canonicalization presupposes the sections the gate requires: a missing
    // page spec or a non-hero first section is a semantic defect the gate
    // reports — never something link repair may paper over.
    if (!firstSection || !/hero/i.test(firstSection.name)) continue;
    const supplied = firstSection.mediaSlotId || null;
    if (supplied) {
      const target = slots.find((candidate) => candidate.id === supplied);
      if (target && isQualifyingHeroSlot(target, page)) continue; // valid link — byte-for-value unchanged
    }
    // Missing or non-resolving link: repairable ONLY when the page's own slot
    // plan names exactly one qualifying hero slot. Zero (nothing to link) or
    // several (semantically ambiguous) stay untouched for the gate to fail
    // closed — canonicalization never guesses and never invents.
    const qualifying = new Map<string, BlueprintImageSlot>();
    for (const slot of slots) {
      if (isQualifyingHeroSlot(slot, page)) qualifying.set(slot.id, slot);
    }
    if (qualifying.size !== 1) continue;
    links.push({ page, supplied, resolved: qualifying.keys().next().value!, reason: "UNIQUE_PAGE_HERO_SLOT" });
  }
  if (links.length === 0) {
    return { blueprint, canonicalization: { applied: false, links: [] } };
  }
  const canonical = JSON.parse(JSON.stringify(blueprint)) as DesignBlueprint;
  for (const link of links) {
    canonical.pages[link.page].sections[0].mediaSlotId = link.resolved;
  }
  return { blueprint: canonical, canonicalization: { applied: true, links } };
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
// resolved from the composition/generation pair by the same bridge the KIE
// adapter uses. Judging a correct provider image against the legacy
// generation-ratio class burned both attempts of 4:3-composition /
// 1:1-generation slots in the four-page-hero regression (live finding
// 2026-09-09); orientation and request ratio must never disagree.
function resolveOrientation(compositionAspectRatio: string, generationAspectRatio: string): ImageSlot["orientation"] {
  const legacyRatio = generationAspectRatio === "9:16" ? "9:16" : generationAspectRatio === "1:1" ? "1:1" : "16:9";
  const resolved = resolveProviderAspectRatio(compositionAspectRatio, generationAspectRatio, legacyRatio);
  return aspectRatioClass(resolved.providerAspectRatio);
}

function orientationForSlot(slot: BlueprintImageSlot): ImageSlot["orientation"] {
  return resolveOrientation(slot.compositionAspectRatio, slot.generationAspectRatio);
}

function orientationForBrief(brief: BlueprintHeroImageBrief): ImageSlot["orientation"] {
  return resolveOrientation(brief.compositionAspectRatio, brief.generationAspectRatio);
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

// ── design-blueprint/2 (operator GO, 2026-09-10) ────────────────────────────
//
// The four mandatory page heroes leave the model's discretion ENTIRELY:
//   AI owns  — hero visual concept, composition, typography, layout, image
//              subject, crop direction, responsive treatment, character.
//   code owns — page identity, hero presence, hero slot id, page/slot
//               relationship, hero section identity, hero priority.
// The model can no longer emit foreign-key-style hero bookkeeping
// (mediaSlotId / ids / page / priority for heroes), so the referential
// lottery design-blueprint/1 suffered is structurally impossible.

export const ROUTED_PAGE_IDS = ["home", "about", "services", "contact"] as const;
export type RoutedPageId = (typeof ROUTED_PAGE_IDS)[number];

// Reserved hero slot ids — deterministic domain construction, never
// model-chosen. Supporting image slots may not collide with these.
export const RESERVED_HERO_SLOT_IDS: Record<RoutedPageId, string> = {
  home: "home-hero",
  about: "about-hero",
  services: "services-hero",
  contact: "contact-hero",
};

export function heroSlotIdForPage(page: RoutedPageId): string {
  return RESERVED_HERO_SLOT_IDS[page];
}

// HERO SECTION SPEC — design decisions the model actually makes. Deliberately
// NO mediaSlotId / page / section id / priority: deterministic.
export const BlueprintHeroSpecSchema = Type.Object(
  {
    purpose: trimmed(1200),
    layout: trimmed(2000),
    visualMass: Type.Optional(trimmed(400)),
    surface: Type.Optional(trimmed(600)),
    typography: Type.Optional(trimmed(800)),
    mediaTreatment: Type.Optional(trimmed(800)),
    cta: Type.Optional(trimmed(800)),
    responsive: Type.Optional(trimmed(1200)),
  },
  { additionalProperties: false }
);
export type BlueprintHeroSpec = Static<typeof BlueprintHeroSpecSchema>;

// HERO IMAGE BRIEF — semantic/design decisions only (the v1 slot schema minus
// id/page/section/priority). The brief may describe ANY Reference-faithful
// hero treatment; the product invariant is hero presence, not a template.
export const BlueprintHeroImageBriefSchema = Type.Object(
  {
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
    kiePrompt: Type.String({ minLength: 40, maxLength: 900 }),
    negativePrompt: Type.String({ minLength: 2, maxLength: 900 }),
    altText: Type.String({ minLength: 5, maxLength: 500 }),
  },
  { additionalProperties: false }
);
export type BlueprintHeroImageBrief = Static<typeof BlueprintHeroImageBriefSchema>;

// v2 page sections carry NO mediaSlotId — the hero relationship is not the
// model's to state. One section moved out of each array into the required
// `hero` object, so the structural counts drop by one versus v1.
export const BlueprintSectionSpecV2Schema = Type.Object(
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
  },
  { additionalProperties: false }
);
export type BlueprintSectionSpecV2 = Static<typeof BlueprintSectionSpecV2Schema>;

const BlueprintPageSpecV2Schema = (minSections: number, maxSections: number) =>
  Type.Object(
    {
      hero: BlueprintHeroSpecSchema,
      sections: Type.Array(BlueprintSectionSpecV2Schema, { minItems: minSections, maxItems: maxSections }),
    },
    { additionalProperties: false }
  );

export const DesignBlueprintV2Schema = Type.Object(
  {
    version: Type.Literal("2"),
    businessFactsRef: Type.String({ minLength: 3, maxLength: 400 }),
    projectFrame: DesignBlueprintSchema.properties.projectFrame,
    designDna: DesignBlueprintSchema.properties.designDna,
    tokens: DesignBlueprintSchema.properties.tokens,
    globalChrome: DesignBlueprintSchema.properties.globalChrome,
    motion: DesignBlueprintSchema.properties.motion,
    pages: Type.Object(
      {
        home: BlueprintPageSpecV2Schema(3, 11),
        about: BlueprintPageSpecV2Schema(1, 7),
        services: BlueprintPageSpecV2Schema(1, 7),
        contact: BlueprintPageSpecV2Schema(1, 7),
      },
      { additionalProperties: false }
    ),
    signatureElements: DesignBlueprintSchema.properties.signatureElements,
    antiPatterns: DesignBlueprintSchema.properties.antiPatterns,
    imagery: Type.Object(
      {
        grade: trimmed(800),
        // REQUIRED for all four routed pages — hero image presence is a
        // schema/domain invariant, not a prompt aspiration.
        pageHeroes: Type.Object(
          {
            home: BlueprintHeroImageBriefSchema,
            about: BlueprintHeroImageBriefSchema,
            services: BlueprintHeroImageBriefSchema,
            contact: BlueprintHeroImageBriefSchema,
          },
          { additionalProperties: false }
        ),
        // Optional supporting imagery keeps the flexible v1 slot concept with
        // model-generated stable ids (minus the reserved hero ids).
        supportingImageSlots: Type.Array(BlueprintImageSlotSchema, { minItems: 0, maxItems: 12 }),
      },
      { additionalProperties: false }
    ),
    responsive: DesignBlueprintSchema.properties.responsive,
    accessibility: DesignBlueprintSchema.properties.accessibility,
    acceptanceChecklist: DesignBlueprintSchema.properties.acceptanceChecklist,
  },
  { additionalProperties: false }
);
export type DesignBlueprintV2 = Static<typeof DesignBlueprintV2Schema>;

export function validateDesignBlueprintV2(value: unknown): { valid: true; value: DesignBlueprintV2 } | { valid: false; errors: string } {
  const candidate = value as unknown;
  if (!Value.Check(DesignBlueprintV2Schema, candidate)) {
    const issues: string[] = [];
    for (const error of Value.Errors(DesignBlueprintV2Schema, candidate)) {
      issues.push(`${error.path}: ${error.message}`);
      if (issues.length >= 12) break;
    }
    return { valid: false, errors: issues.join("; ") };
  }
  const blueprint = candidate as DesignBlueprintV2;
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

// ── design-blueprint/2 materialization ──────────────────────────────────────

// Deterministic domain construction (not semantic repair): the semantic hero
// briefs become concrete image slots with system-assigned identity, exactly
// the representation the existing KIE orchestrator and Website Builder
// already consume. Heroes first, then supporting slots appended unchanged.
export function materializeBlueprintImageSlots(blueprint: DesignBlueprintV2): ImageSlot[] {
  const heroes = ROUTED_PAGE_IDS.map((page) => {
    const brief = blueprint.imagery.pageHeroes[page];
    return {
      id: heroSlotIdForPage(page),
      page,
      regionId: "hero",
      semanticRole: `${brief.subjectDirection}${brief.compositionDirection ? ` — ${brief.compositionDirection}` : ""}`,
      blueprintRole: `simple-${page}-hero`,
      priority: "CRITICAL" as const,
      orientation: orientationForBrief(brief),
      compositionAspectRatio: brief.compositionAspectRatio,
      generationAspectRatio: brief.generationAspectRatio,
      negativeSpaceForText: true,
    };
  });
  const supporting = blueprint.imagery.supportingImageSlots.map((slot) => ({
    id: slot.id,
    page: slot.page,
    ...(slot.section ? { regionId: slot.section } : {}),
    semanticRole: `${slot.subjectDirection}${slot.compositionDirection ? ` — ${slot.compositionDirection}` : ""}`,
    blueprintRole: `simple-${slot.section || slot.page}`,
    priority: slot.priority,
    orientation: orientationForSlot(slot),
    compositionAspectRatio: slot.compositionAspectRatio,
    generationAspectRatio: slot.generationAspectRatio,
    negativeSpaceForText: /text overlay|negative space|dark enough for|space for (a )?(headline|text)/i.test(
      `${slot.compositionDirection ?? ""} ${slot.kiePrompt}`
    ),
  }));
  return [...heroes, ...supporting];
}

/** A frozen Reference visual input (full-page/detail capture descriptor).
 *  Visual authority flows through Blueprint (design) and Visual QA
 *  (comparison); the Website Builder itself is text-only (model-routing GO
 *  §4). Formerly exported from website-builder. */
export interface SimpleBuilderVisualInput {
  kind: string;
  artifact: string;
  sha256: string;
  width: number;
  height: number;
}

export function materializeBlueprintPromptRecords(blueprint: DesignBlueprintV2): ImagePromptRecord[] {
  const heroes = ROUTED_PAGE_IDS.map((page) => {
    const brief = blueprint.imagery.pageHeroes[page];
    return {
      slotId: heroSlotIdForPage(page),
      promptText: brief.kiePrompt,
      altText: brief.altText,
      shotType: (brief.visualMass || brief.compositionDirection || brief.subjectDirection).slice(0, 120),
      lighting: (brief.lighting || "natural light").slice(0, 500),
      avoidance: brief.negativePrompt.slice(0, 1000),
    };
  });
  const supporting = blueprint.imagery.supportingImageSlots.map((slot) => ({
    slotId: slot.id,
    promptText: slot.kiePrompt,
    altText: slot.altText,
    shotType: (slot.visualMass || slot.compositionDirection || slot.subjectDirection).slice(0, 120),
    lighting: (slot.lighting || "natural light").slice(0, 500),
    avoidance: slot.negativePrompt.slice(0, 1000),
  }));
  return [...heroes, ...supporting];
}

// Implementation-ready Accepted Image descriptors for the Website Builder and
// the repair stage — the hero→slot relationship is assembled HERE, never
// reconstructed by the builder (GO section 13). `priority` travels with the
// descriptor so the builder can derive its mandatory CRITICAL ledger from the
// materialized plan; `required` (= priority === CRITICAL) is deterministic
// convenience metadata only — Accepted Image persistence is unchanged.
export interface MaterializedAcceptedImageDescriptor {
  slotId: string;
  altText: string;
  aspectRatio: string;
  page: RoutedPageId;
  section?: string;
  priority: BlueprintImageSlot["priority"];
  required: boolean;
}

export function materializeAcceptedImageDescriptors(blueprint: DesignBlueprintV2): MaterializedAcceptedImageDescriptor[] {
  const heroes = ROUTED_PAGE_IDS.map((page) => ({
    slotId: heroSlotIdForPage(page),
    altText: blueprint.imagery.pageHeroes[page].altText,
    aspectRatio: blueprint.imagery.pageHeroes[page].generationAspectRatio,
    page,
    section: "hero",
    priority: "CRITICAL" as const,
    required: true,
  }));
  const supporting = blueprint.imagery.supportingImageSlots.map((slot) => ({
    slotId: slot.id,
    altText: slot.altText,
    aspectRatio: slot.generationAspectRatio,
    page: slot.page,
    ...(slot.section ? { section: slot.section } : {}),
    priority: slot.priority,
    required: slot.priority === "CRITICAL",
  }));
  return [...heroes, ...supporting];
}

// design-blueprint/2 quality gate: the schema now structurally requires all
// four hero specs and all four hero image briefs, so the gate is a small
// null-safe belt over the materialized plan — no duplicated validator, and no
// hero-link referential checks (there is nothing left to link).
export function evaluateBlueprintQualityGateV2(blueprint: DesignBlueprintV2): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  const dna = blueprint?.designDna ?? [];
  if (dna.length < 5 || dna.length > 8) {
    failures.push(`designDna must have 5-8 rules (got ${dna.length})`);
  }
  for (const page of ROUTED_PAGE_IDS) {
    const spec = blueprint?.pages?.[page];
    if (!spec?.hero || !spec?.sections?.length) {
      failures.push(`page spec '${page}' missing hero spec or empty sections`);
    }
    const brief = blueprint?.imagery?.pageHeroes?.[page];
    if (!brief?.subjectDirection || !brief?.kiePrompt) {
      failures.push(`page '${page}' hero image brief missing subject direction or KIE prompt`);
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

  // Materialized plan invariants: reserved hero ids, CRITICAL priority, hero
  // section, page ownership, global id uniqueness, reserved-id collisions.
  const slots = materializeBlueprintImageSlots(blueprint ?? ({ imagery: { pageHeroes: {}, supportingImageSlots: [] } } as unknown as DesignBlueprintV2));
  const slotIds = new Set<string>();
  for (const slot of slots) {
    if (slotIds.has(slot.id)) failures.push(`duplicate materialized image slot id '${slot.id}'`);
    slotIds.add(slot.id);
  }
  for (const page of ROUTED_PAGE_IDS) {
    const heroSlotId = heroSlotIdForPage(page);
    const slot = slots.find((candidate) => candidate.id === heroSlotId);
    if (!slot) {
      failures.push(`materialized hero slot '${heroSlotId}' missing`);
      continue;
    }
    if (slot.page !== page) failures.push(`materialized hero slot '${heroSlotId}' must belong to page '${page}' (got '${slot.page}')`);
    if (slot.regionId !== "hero") failures.push(`materialized hero slot '${heroSlotId}' must target the hero section (got '${slot.regionId}')`);
    if (slot.priority !== "CRITICAL") failures.push(`materialized hero slot '${heroSlotId}' must be CRITICAL priority`);
  }
  for (const slot of blueprint?.imagery?.supportingImageSlots ?? []) {
    if (Object.values(RESERVED_HERO_SLOT_IDS).includes(slot.id)) {
      failures.push(`supporting image slot '${slot.id}' collides with a reserved page-hero id`);
    }
    if (!slot.kiePrompt || slot.kiePrompt.length < 40) failures.push(`image slot '${slot.id}' has no usable kiePrompt`);
  }
  return { passed: failures.length === 0, failures };
}

// ── version dispatch + v1 historical compatibility ──────────────────────────

function isBlueprintV2(value: unknown): value is DesignBlueprintV2 {
  return typeof value === "object" && value !== null && "imagery" in value && (value as { imagery?: { pageHeroes?: unknown } }).imagery?.pageHeroes !== undefined;
}

/** Version-dispatching gate for paths that legitimately read EITHER stored
 *  artifact generation (driver tooling, frozen-version re-checks). */
export function evaluateBlueprintQualityGateAny(blueprint: DesignBlueprint | DesignBlueprintV2): { passed: boolean; failures: string[] } {
  return isBlueprintV2(blueprint) ? evaluateBlueprintQualityGateV2(blueprint) : evaluateBlueprintQualityGate(blueprint);
}

/** Version-dispatching image-slot bridge for diagnostic/driver paths that may
 *  read either artifact generation. */
export function blueprintImageSlotsAny(blueprint: DesignBlueprint | DesignBlueprintV2): ImageSlot[] {
  return isBlueprintV2(blueprint) ? materializeBlueprintImageSlots(blueprint) : blueprintSlotsToImageSlots(blueprint);
}

/** Version-dispatching prompt-record bridge (same contract as above). */
export function blueprintPromptRecordsAny(blueprint: DesignBlueprint | DesignBlueprintV2): ImagePromptRecord[] {
  return isBlueprintV2(blueprint) ? materializeBlueprintPromptRecords(blueprint) : blueprintSlotsToPromptRecords(blueprint);
}

// Frozen-artifact compatibility path (GO section 17): a Build Version whose
// design_blueprint was stored as design-blueprint/1 before the v2 upgrade
// resumes through HERE — read-only adaptation, the stored artifact is never
// rewritten. The v1 canonicalizer runs first so historical artifacts with the
// known mediaSlotId lottery defect are read safely (GO section 10's retained
// purpose). Adaptation cannot invent content: a v1 artifact without a valid
// per-page hero link is refused loudly.
export function storedBlueprintToV2(stored: DesignBlueprint | DesignBlueprintV2): DesignBlueprintV2 {
  if (isBlueprintV2(stored)) return stored;
  const { blueprint: canonical } = canonicalizeBlueprintHeroMediaLinks(stored);
  const gate = evaluateBlueprintQualityGate(canonical);
  if (!gate.passed) {
    throw new Error(
      `stored design-blueprint/1 artifact is not safely readable (gate: ${gate.failures.slice(0, 3).join("; ")}) — a new Build Version is required`
    );
  }
  const linkedHeroSlotIds = new Set<string>();
  const pageHeroes = {} as Record<RoutedPageId, BlueprintHeroImageBrief>;
  const pages = {} as DesignBlueprintV2["pages"];
  for (const page of ROUTED_PAGE_IDS) {
    const firstSection = canonical.pages[page].sections[0];
    if (!firstSection || !/hero/i.test(firstSection.name)) {
      throw new Error(`stored design-blueprint/1 artifact page '${page}' has no hero-first section — a new Build Version is required`);
    }
    const heroSlotId = blueprintHeroSlotId(canonical, page);
    if (!heroSlotId) {
      throw new Error(`stored design-blueprint/1 artifact page '${page}' has no resolvable hero slot — a new Build Version is required`);
    }
    linkedHeroSlotIds.add(heroSlotId);
    const heroSlot = canonical.imagery.imageSlots.find((slot) => slot.id === heroSlotId)!;
    const { id: _id, page: _page, section: _section, priority: _priority, ...brief } = heroSlot;
    pageHeroes[page] = brief;
    pages[page] = {
      hero: {
        purpose: firstSection.purpose,
        layout: firstSection.layout,
        ...(firstSection.visualMass ? { visualMass: firstSection.visualMass } : {}),
        ...(firstSection.surface ? { surface: firstSection.surface } : {}),
        ...(firstSection.typography ? { typography: firstSection.typography } : {}),
        ...(firstSection.media ? { mediaTreatment: firstSection.media } : {}),
        ...(firstSection.cta ? { cta: firstSection.cta } : {}),
        ...(firstSection.responsive ? { responsive: firstSection.responsive } : {}),
      },
      sections: canonical.pages[page].sections.slice(1).map((section) => {
        const { mediaSlotId: _dropped, ...rest } = section;
        return rest;
      }),
    };
  }
  return {
    ...(canonical as unknown as Omit<DesignBlueprintV2, "version" | "pages" | "imagery">),
    version: "2",
    pages,
    imagery: {
      grade: canonical.imagery.grade,
      pageHeroes,
      supportingImageSlots: canonical.imagery.imageSlots.filter((slot) => !linkedHeroSlotIds.has(slot.id)),
    },
  };
}
