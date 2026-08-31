// Phase 16.R4: runtime blueprint schemas (schema-as-code).
//
// One TypeBox source provides runtime validation, derives TypeScript types via
// Static, and can emit/expose versioned JSON Schema. Replaces the prior path
// where TypeScript interfaces were treated as schemas and parsed model JSON was
// asserted into types. Never rewrites an incoming schemaVersion during parsing.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { isRenderableInteraction, renderableInteractionPairsDescription } from "./renderable-interactions";

export const BLUEPRINT_SCHEMA_VERSION_V2 = 1;
export const BLUEPRINT_PROMPT_VERSION_V2 = "phase-16.R4-v1";
export const EVIDENCE_REGISTRY_VERSION = 1;

const evidenceSourceEnum = Type.Union([
  Type.Literal("capture"),
  Type.Literal("interaction"),
  Type.Literal("screenshot"),
  Type.Literal("client_facts"),
]);

export const EvidenceRefSchema = Type.Object({
  source: evidenceSourceEnum,
  artifactKey: Type.String(),
  viewport: Type.Optional(Type.String()),
  selector: Type.Optional(Type.String()),
  screenshotR2Key: Type.Optional(Type.String()),
  screenshotRegion: Type.Optional(Type.Object({
    label: Type.String(),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ minimum: 0, maximum: 1 }),
    height: Type.Number({ minimum: 0, maximum: 1 }),
  })),
});
export type EvidenceRef = Static<typeof EvidenceRefSchema>;

const confidence = Type.Number({ minimum: 0, maximum: 1 });

// Normalized screenshot-region observation persisted by the vision path.
export const ScreenshotObservationSchema = Type.Object({
  id: Type.String(),
  source: Type.Literal("screenshot"),
  category: Type.Union([
    Type.Literal("layout"), Type.Literal("typography"), Type.Literal("color"),
    Type.Literal("spacing"), Type.Literal("imagery"), Type.Literal("navigation"),
    Type.Literal("surfaces"), Type.Literal("interaction"), Type.Literal("overall"),
  ]),
  region: Type.Optional(Type.Object({
    label: Type.String(),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ minimum: 0, maximum: 1 }),
    height: Type.Number({ minimum: 0, maximum: 1 }),
  })),
  observation: Type.String(),
  confidence,
  artifactKey: Type.String(),
});
export type ScreenshotObservation = Static<typeof ScreenshotObservationSchema>;

export const ScreenshotEvidenceArtifactSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  screenshotR2Key: Type.String(),
  visionInput: Type.Object({
    r2Key: Type.String(),
    sourceR2Key: Type.String(),
    sourceChecksum: Type.String(),
    checksum: Type.String(),
    mimeType: Type.String(),
    byteSize: Type.Integer({ minimum: 1 }),
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    derived: Type.Boolean(),
    transform: Type.Union([
      Type.Null(),
      Type.Object({
        format: Type.Literal("image/webp"),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        quality: Type.Integer({ minimum: 1, maximum: 100 }),
      }),
    ]),
  }),
  provider: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  observations: Type.Array(ScreenshotObservationSchema),
  createdAt: Type.String(),
});
export type ScreenshotEvidenceArtifact = Static<typeof ScreenshotEvidenceArtifactSchema>;

// Evidence registry entry — one per source artifact observation/fact.
export const RegistryEntrySchema = Type.Object({
  id: Type.String(),
  source: evidenceSourceEnum,
  artifactKey: Type.String(),
  viewport: Type.Optional(Type.String()),
  selector: Type.Optional(Type.String()),
  screenshotRegion: Type.Optional(Type.Object({
    label: Type.String(),
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
    width: Type.Number({ minimum: 0, maximum: 1 }),
    height: Type.Number({ minimum: 0, maximum: 1 }),
  })),
  classification: Type.Union([
    Type.Literal("observed"), Type.Literal("detected"),
    Type.Literal("inferred"), Type.Literal("client_fact"),
  ]),
  observation: Type.String(),
  confidence,
});
export type RegistryEntry = Static<typeof RegistryEntrySchema>;

export const EvidenceRegistrySchema = Type.Object({
  schemaVersion: Type.Literal(EVIDENCE_REGISTRY_VERSION),
  registryVersion: Type.Number({ minimum: 1 }),
  jobId: Type.String(),
  attemptId: Type.Optional(Type.String()),
  evidenceAttemptId: Type.Optional(Type.String()),
  entries: Type.Array(RegistryEntrySchema),
  checksum: Type.String(),
  createdAt: Type.String(),
});
export type EvidenceRegistry = Static<typeof EvidenceRegistrySchema>;

// ── Design blueprint ────────────────────────────────────────────────────────
const semanticSectionType = Type.Union([
  Type.Literal("hero"), Type.Literal("features"), Type.Literal("about"),
  Type.Literal("services"), Type.Literal("stats"), Type.Literal("testimonials"),
  Type.Literal("cta"), Type.Literal("contact"), Type.Literal("footer"),
  Type.Literal("navigation"),
]);

const BlueprintSectionSchema = Type.Object({
  id: Type.String(),
  type: Type.Union([semanticSectionType, Type.String()]),
  role: Type.Union([Type.String(), Type.Null()]),
  order: Type.Integer({ minimum: 0 }),
  composition: Type.String(),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

const BlueprintTypeSpecSchema = Type.Object({
  element: Type.String(),
  fontFamily: Type.String(),
  fontSize: Type.String(),
  fontWeight: Type.String(),
  lineHeight: Type.String(),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

const BlueprintColorRoleSchema = Type.Object({
  role: Type.Union([
    Type.Literal("background"), Type.Literal("text"), Type.Literal("primary"),
    Type.Literal("accent"), Type.Literal("surface"), Type.Literal("muted"), Type.Literal("border"),
    Type.String(),
  ]),
  value: Type.String(),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

const BlueprintIconIntentSchema = Type.Object({
  slot: Type.String(),
  intent: Type.Union([
    Type.Literal("education"), Type.Literal("health"), Type.Literal("community"),
    Type.Literal("location"), Type.Literal("contact"), Type.Literal("security"),
    Type.Literal("growth"), Type.Literal("support"), Type.Literal("accessibility"),
    Type.String(),
  ]),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

const BlueprintImageSlotSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  page: Type.Union([Type.Literal("/"), Type.Literal("/services"), Type.Literal("/about"), Type.Literal("/contact")]),
  placement: Type.Union([Type.Literal("hero"), Type.Literal("section")]),
  aspectRatio: Type.Union([Type.Literal("16:9"), Type.Literal("4:3"), Type.Literal("1:1")]),
  subject: Type.String({ minLength: 1 }),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

export const DesignBlueprintSchema = Type.Object({
  schemaVersion: Type.Literal(BLUEPRINT_SCHEMA_VERSION_V2),
  source: Type.Object({
    referenceUrl: Type.String(),
    finalUrl: Type.Union([Type.String(), Type.Null()]),
    captureManifestR2Key: Type.Union([Type.String(), Type.Null()]),
    interactionManifestR2Key: Type.Union([Type.String(), Type.Null()]),
    screenshotR2Key: Type.Union([Type.String(), Type.Null()]),
    registryR2Key: Type.String(),
    registryVersion: Type.Integer({ minimum: 1 }),
  }),
  layout: Type.Object({
    navStyle: Type.String(),
    footerStyle: Type.String(),
    gridSystem: Type.String(),
    sections: Type.Array(BlueprintSectionSchema, { minItems: 1 }),
  }),
  typography: Type.Object({
    body: BlueprintTypeSpecSchema,
    headings: Type.Array(BlueprintTypeSpecSchema),
    scale: Type.String(),
  }),
  colors: Type.Object({ roles: Type.Array(BlueprintColorRoleSchema, { minItems: 1 }) }),
  spacing: Type.Object({
    sectionPadding: Type.String(),
    rhythm: Type.String(),
    evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
    evidence: EvidenceRefSchema,
    confidence,
  }),
  surfaces: Type.Object({
    cards: Type.String(),
    buttons: Type.String(),
    inputs: Type.String(),
    evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
    evidence: EvidenceRefSchema,
    confidence,
  }),
  imagery: Type.Object({
    treatment: Type.String(),
    slots: Type.Array(Type.Union([Type.String(), BlueprintImageSlotSchema]), { minItems: 1 }),
  }),
  navigation: Type.Object({
    structure: Type.String(),
    items: Type.Array(Type.String(), { minItems: 1 }),
    responsiveBehavior: Type.String(),
  }),
  responsive: Type.Object({
    breakpoints: Type.Array(Type.Number(), { minItems: 1 }),
    changes: Type.Array(Type.String()),
  }),
  icons: Type.Object({ intents: Type.Array(BlueprintIconIntentSchema) }),
  confidence,
});
export type DesignBlueprintV2 = Static<typeof DesignBlueprintSchema>;

// ── Interaction blueprint ───────────────────────────────────────────────────
const interactionTriggerKind = Type.Union([
  Type.Literal("hover"), Type.Literal("focus"), Type.Literal("active"),
  Type.Literal("toggle"), Type.Literal("scroll-reveal"), Type.Literal("sticky"),
  Type.Literal("section-transition"), Type.String(),
]);

const BlueprintInteractionItemSchema = Type.Object({
  trigger: interactionTriggerKind,
  target: Type.String(),
  selector: Type.String(),
  property: Type.String(),
  duration: Type.String(),
  easing: Type.String(),
  delay: Type.String(),
  hover: Type.String(),
  focus: Type.String(),
  active: Type.String(),
  scrollBehavior: Type.String(),
  reducedMotionBehavior: Type.String(),
  observed: Type.Boolean(),
  evidenceIds: Type.Array(Type.String(), { minItems: 1 }),
  evidence: EvidenceRefSchema,
  confidence,
});

export const InteractionBlueprintSchema = Type.Object({
  schemaVersion: Type.Literal(BLUEPRINT_SCHEMA_VERSION_V2),
  source: Type.Object({ registryR2Key: Type.String(), registryVersion: Type.Integer({ minimum: 1 }) }),
  interactions: Type.Array(BlueprintInteractionItemSchema, { minItems: 1 }),
  reducedMotionStrategy: Type.String({ minLength: 1 }),
  confidence,
});
export type InteractionBlueprintV2 = Static<typeof InteractionBlueprintSchema>;

// ── Validation diagnostics ──────────────────────────────────────────────────
export const ValidationDiagnosticSchema = Type.Object({
  code: Type.String(),
  path: Type.String(),
  message: Type.String(),
  expected: Type.Union([Type.String(), Type.Null()]),
  received: Type.Union([Type.String(), Type.Null()]),
  severity: Type.Union([
    Type.Literal("blocking"), Type.Literal("critical"), Type.Literal("major"), Type.Literal("minor"),
  ]),
  repairGuidance: Type.Union([Type.String(), Type.Null()]),
});
export type ValidationDiagnostic = Static<typeof ValidationDiagnosticSchema>;

export const BlueprintRuntimeValidationSchema = Type.Object({
  valid: Type.Boolean(),
  diagnostics: Type.Array(ValidationDiagnosticSchema),
  rendererSpecificStrings: Type.Array(Type.String()),
});
export type BlueprintRuntimeValidation = Static<typeof BlueprintRuntimeValidationSchema>;

// ── Review diagnostics ──────────────────────────────────────────────────────
export const ReviewDiagnosticSchema = Type.Object({
  severity: Type.Union([
    Type.Literal("blocking"), Type.Literal("major"), Type.Literal("minor"), Type.Literal("informational"),
  ]),
  category: Type.Union([
    Type.Literal("completeness"), Type.Literal("consistency"), Type.Literal("evidence"),
    Type.Literal("accessibility"), Type.Literal("unsupported"),
  ]),
  message: Type.String(),
  path: Type.Union([Type.String(), Type.Null()]),
});
export type ReviewDiagnostic = Static<typeof ReviewDiagnosticSchema>;

export const BlueprintReviewResultSchema = Type.Object({
  findings: Type.Array(ReviewDiagnosticSchema),
});
export type BlueprintReviewResult = Static<typeof BlueprintReviewResultSchema>;

// ── Runtime validation helpers ──────────────────────────────────────────────

export interface SchemaCheckResult {
  ok: boolean;
  diagnostics: ValidationDiagnostic[];
}

function tbErrorToDiagnostic(err: { path: string; message: string; schema?: unknown; value?: unknown }): ValidationDiagnostic {
  const path = err.path || "$";
  const sev = /required/i.test(err.message) ? "critical" : "major";
  return {
    code: "SCHEMA_VIOLATION",
    path,
    message: err.message,
    expected: null,
    received: err.value === undefined ? null : typeof err.value === "string" ? err.value.slice(0, 120) : JSON.stringify(err.value).slice(0, 120),
    severity: sev as ValidationDiagnostic["severity"],
    repairGuidance: `Fix the value at ${path} to satisfy the blueprint schema.`,
  };
}

export function validateAgainstSchema(schema: ReturnType<typeof Type.Object>, value: unknown): SchemaCheckResult {
  const diagnostics = [...Value.Errors(schema, value)].map(tbErrorToDiagnostic);
  return { ok: diagnostics.length === 0, diagnostics };
}

export function checkDesignBlueprint(value: unknown): SchemaCheckResult {
  return validateAgainstSchema(DesignBlueprintSchema as never, value);
}

export function checkInteractionBlueprint(value: unknown): SchemaCheckResult {
  const schemaResult = validateAgainstSchema(InteractionBlueprintSchema as never, value);
  if (!schemaResult.ok || !value || typeof value !== "object" || !Array.isArray((value as { interactions?: unknown }).interactions)) {
    return schemaResult;
  }
  const diagnostics = [...schemaResult.diagnostics];
  for (const [index, interaction] of (value as { interactions: unknown[] }).interactions.entries()) {
    if (!interaction || typeof interaction !== "object") continue;
    const { trigger, selector } = interaction as { trigger?: unknown; selector?: unknown };
    if (typeof trigger !== "string" || typeof selector !== "string") continue;
    if (!isRenderableInteraction(trigger, selector)) {
      diagnostics.push({
        code: "UNSUPPORTED_RENDERER_INTERACTION",
        path: `/interactions/${index}`,
        message: `The ${JSON.stringify(trigger)} interaction on ${JSON.stringify(selector)} is not implemented by the deterministic renderer.`,
        expected: renderableInteractionPairsDescription(),
        received: `${trigger} → ${selector}`,
        severity: "blocking",
        repairGuidance: "Choose one supported trigger and selector pair, or omit the interaction when it cannot be rendered.",
      });
    }
  }
  return { ok: diagnostics.length === 0, diagnostics };
}

export function parseDesignBlueprint(value: unknown): DesignBlueprintV2 {
  const check = checkDesignBlueprint(value);
  if (!check.ok) {
    throw new Error(`Invalid accepted design blueprint: ${check.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join(" | ")}`);
  }
  return value as DesignBlueprintV2;
}

export function parseInteractionBlueprint(value: unknown): InteractionBlueprintV2 {
  const check = checkInteractionBlueprint(value);
  if (!check.ok) {
    throw new Error(`Invalid accepted interaction blueprint: ${check.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join(" | ")}`);
  }
  return value as InteractionBlueprintV2;
}

export function checkEvidenceRegistry(value: unknown): SchemaCheckResult {
  return validateAgainstSchema(EvidenceRegistrySchema as never, value);
}

export function checkScreenshotArtifact(value: unknown): SchemaCheckResult {
  return validateAgainstSchema(ScreenshotEvidenceArtifactSchema as never, value);
}

export function schemaCheckOnly(schema: ReturnType<typeof Type.Object>, value: unknown): boolean {
  return Value.Check(schema, value);
}

// Style-package keys + renderer-specific tokens that must never appear.
export const STYLE_KEY_NAMES = [
  "minimalist-monochrome", "minimalist-modern", "editorial-serif",
  "high-contrast-luxury", "flat-design", "bold-typographic",
];

const RENDERER_TOKEN_RE = /(^|\s)((bg|text|border|rounded|shadow|flex|grid|gap|items|justify|space|col|row|md|sm|lg|xl|hover|focus)[-a-z0-9]+(\s+(bg|text|border|rounded|shadow|flex|grid|gap|items|justify|space|col|row|md|sm|lg|xl|hover|focus)[-a-z0-9]+)+)(\s|$)/;
const RENDERER_KEYWORD_RE = /\b(tailwind|shadcn|react|jsx|className|class=)\b/i;

function collectStrings(value: unknown, acc: string[]): void {
  if (typeof value === "string") acc.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, acc);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, acc);
}

export function detectRendererSpecificStrings(value: unknown): string[] {
  const strings: string[] = [];
  collectStrings(value, strings);
  const offenders = new Set<string>();
  for (const s of strings) {
    if (RENDERER_TOKEN_RE.test(s) || RENDERER_KEYWORD_RE.test(s)) offenders.add(s);
    if (STYLE_KEY_NAMES.some((k) => s.toLowerCase().includes(k))) offenders.add(s);
  }
  return [...offenders];
}
