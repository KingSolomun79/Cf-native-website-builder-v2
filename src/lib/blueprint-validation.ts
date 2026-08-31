// Phase 16.R4: runtime + provenance validation + review (fail-closed gates).
//
// Pipeline: raw model text → bounded JSON extraction → JSON.parse → runtime
// schema validation → provenance validation → review. The parser never casts
// parsed JSON directly into blueprint types and never rewrites schemaVersion.
// Schema, provenance, and review are each fail-closed before rendering: a
// blueprint cannot be accepted when blocking/major findings remain, even if
// the runtime schema is valid.

import type {
  DesignBlueprintV2,
  InteractionBlueprintV2,
  EvidenceRegistry,
  RegistryEntry,
  EvidenceRef,
  BlueprintRuntimeValidation,
  ValidationDiagnostic,
  BlueprintReviewResult,
  ReviewDiagnostic,
} from "./blueprint-schema-v2";
import {
  BLUEPRINT_SCHEMA_VERSION_V2,
  detectRendererSpecificStrings,
  checkDesignBlueprint,
  checkInteractionBlueprint,
} from "./blueprint-schema-v2";

export interface BlueprintPairV2 {
  design: DesignBlueprintV2;
  interaction: InteractionBlueprintV2;
}

export interface ProvenanceResult {
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

// ── Bounded JSON extraction ─────────────────────────────────────────────────
// Extracts the outermost JSON object/array from raw model text without crashing
// on malformed output. Throws a bounded, classified error on complete failure.
export class BlueprintParseError extends Error {
  diagnostics: ValidationDiagnostic[];
  constructor(message: string, diagnostics: ValidationDiagnostic[]) {
    super(message);
    this.name = "BlueprintParseError";
    this.diagnostics = diagnostics;
  }
}

export function extractJsonObject(raw: string): string {
  const cleaned = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new BlueprintParseError("Blueprint output contained no parseable JSON object", [
      diag("critical", "UNPARSEABLE_JSON", "$", "Model output did not contain a JSON object", "a JSON object with 'design' and 'interaction' keys"),
    ]);
  }
  return cleaned.slice(start, end + 1);
}

// Parse raw model text into unknown JSON (NOT into blueprint types). Schema
// validation happens next, separately.
export function parseBlueprintJson(raw: string): { design: unknown; interaction: unknown } {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new BlueprintParseError(`Blueprint JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`, [
      diag("critical", "JSON_PARSE_ERROR", "$", err instanceof Error ? err.message : "invalid JSON", "valid JSON"),
    ]);
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || !("design" in obj) || !("interaction" in obj)) {
    throw new BlueprintParseError("Blueprint JSON missing 'design' or 'interaction' key", [
      diag("critical", "MISSING_TOP_LEVEL_KEYS", "$", "JSON missing required top-level keys", "object with 'design' and 'interaction'"),
    ]);
  }
  return { design: obj.design, interaction: obj.interaction };
}

// ── Runtime schema validation ───────────────────────────────────────────────
export function validateRuntime(design: unknown, interaction: unknown): BlueprintRuntimeValidation {
  const designCheck = checkDesignBlueprint(design);
  const interactionCheck = checkInteractionBlueprint(interaction);
  const diagnostics = [...designCheck.diagnostics, ...interactionCheck.diagnostics];
  const rendererSpecificStrings = Array.from(new Set([
    ...detectRendererSpecificStrings(design),
    ...detectRendererSpecificStrings(interaction),
  ]));
  for (const s of rendererSpecificStrings) {
    diagnostics.push(diag("critical", "RENDERER_SPECIFIC", "$.strings", `Renderer-specific string present: '${s.slice(0, 80)}'`, "renderer-independent semantic values"));
  }
  return { valid: diagnostics.length === 0, diagnostics, rendererSpecificStrings };
}

// ── Provenance validation ───────────────────────────────────────────────────
// Every material decision references one or more evidence ids that must resolve
// to the registry. Source/artifact/selector/region must match. Observed claims
// must reference observed R3 evidence; inferred cannot claim observed.
export function validateProvenance(
  design: DesignBlueprintV2,
  interaction: InteractionBlueprintV2,
  registry: EvidenceRegistry,
  registryR2Key: string
): ProvenanceResult {
  const byId = new Map<string, RegistryEntry>();
  for (const e of registry.entries) byId.set(e.id, e);

  const diagnostics: ValidationDiagnostic[] = [];
  const checkIds = (path: string, ids: string[], evidence: EvidenceRef, opts: { requireScreenshot?: boolean; mustBeObserved?: boolean } = {}) => {
    if (ids.length === 0) {
      diagnostics.push(diag("major", "NO_EVIDENCE", path, "Decision references no evidence ids", "at least one registry evidence id"));
      return;
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const entry = byId.get(id);
      if (!entry) {
        diagnostics.push(diag("blocking", "EVIDENCE_ID_NOT_FOUND", `${path}.evidenceIds[${i}]`, `Referenced evidence '${id}' does not exist in registry v${registry.registryVersion}`, `an id from registry v${registry.registryVersion}`));
        continue;
      }
      if (opts.requireScreenshot && entry.source !== "screenshot") {
        diagnostics.push(diag("blocking", "SCREENSHOT_CLAIM_MISMATCH", `${path}.evidenceIds[${i}]`, `Decision claims screenshot grounding but evidence '${id}' is source '${entry.source}'`, "a screenshot evidence id"));
      }
      if (opts.mustBeObserved && entry.classification !== "observed") {
        diagnostics.push(diag("blocking", "OBSERVED_CLAIM_MISMATCH", `${path}.evidenceIds[${i}]`, `Decision claims observed behavior but evidence '${id}' is classification '${entry.classification}'`, "an observed evidence id"));
      }
    }
    const primary = byId.get(ids[0]);
    if (primary) checkEvidenceRef(path, evidence, primary, diagnostics);
  };

  checkRegistrySource("$.design.source", design.source.registryR2Key, design.source.registryVersion, registryR2Key, registry.registryVersion, diagnostics);
  checkRegistrySource("$.interaction.source", interaction.source.registryR2Key, interaction.source.registryVersion, registryR2Key, registry.registryVersion, diagnostics);

  design.layout.sections.forEach((s, i) => checkIds(`$.design.layout.sections[${i}]`, s.evidenceIds, s.evidence));
  checkIds("$.design.typography.body", design.typography.body.evidenceIds, design.typography.body.evidence);
  design.typography.headings.forEach((h, i) => checkIds(`$.design.typography.headings[${i}]`, h.evidenceIds, h.evidence));
  design.colors.roles.forEach((r, i) => checkIds(`$.design.colors.roles[${i}]`, r.evidenceIds, r.evidence));
  checkIds("$.design.spacing", design.spacing.evidenceIds, design.spacing.evidence);
  checkIds("$.design.surfaces", design.surfaces.evidenceIds, design.surfaces.evidence);
  design.imagery.slots.forEach((slot, i) => {
    if (typeof slot !== "string") checkIds(`$.design.imagery.slots[${i}]`, slot.evidenceIds, slot.evidence);
  });
  design.icons.intents.forEach((ic, i) => checkIds(`$.design.icons.intents[${i}]`, ic.evidenceIds, ic.evidence));

  interaction.interactions.forEach((it, i) => {
    checkIds(`$.interaction.interactions[${i}]`, it.evidenceIds, it.evidence, { mustBeObserved: it.observed });
    if (it.observed) {
      for (const id of it.evidenceIds) {
        const entry = byId.get(id);
        if (entry && entry.source !== "interaction") {
          diagnostics.push(diag("blocking", "OBSERVED_SOURCE_MISMATCH", `$.interaction.interactions[${i}].evidenceIds`, `Observed interaction claims source '${entry.source}'`, "an interaction evidence id"));
        }
      }
    }
  });

  return { valid: diagnostics.length === 0, diagnostics };
}

function checkRegistrySource(
  path: string,
  actualKey: string,
  actualVersion: number,
  expectedKey: string,
  expectedVersion: number,
  diagnostics: ValidationDiagnostic[]
): void {
  if (actualKey !== expectedKey) {
    diagnostics.push(diag("blocking", "REGISTRY_KEY_MISMATCH", `${path}.registryR2Key`, `Blueprint registry key '${actualKey}' does not match the active registry`, expectedKey));
  }
  if (actualVersion !== expectedVersion) {
    diagnostics.push(diag("blocking", "REGISTRY_VERSION_MISMATCH", `${path}.registryVersion`, `Blueprint registry version ${actualVersion} does not match the active registry`, String(expectedVersion)));
  }
}

function checkEvidenceRef(
  path: string,
  evidence: EvidenceRef,
  entry: RegistryEntry,
  diagnostics: ValidationDiagnostic[]
): void {
  const fields: Array<[keyof EvidenceRef, unknown, unknown]> = [
    ["source", evidence.source, entry.source],
    ["artifactKey", evidence.artifactKey, entry.artifactKey],
    ["viewport", evidence.viewport, entry.viewport],
    ["selector", evidence.selector, entry.selector],
    ["screenshotRegion", evidence.screenshotRegion, entry.screenshotRegion],
  ];
  for (const [field, actual, expected] of fields) {
    if (JSON.stringify(actual ?? null) !== JSON.stringify(expected ?? null)) {
      diagnostics.push(diag("blocking", "EVIDENCE_REF_MISMATCH", `${path}.evidence.${field}`, `Declared evidence ${field} does not match '${entry.id}'`, JSON.stringify(expected ?? null)));
    }
  }
}

// ── Review ──────────────────────────────────────────────────────────────────
export function reviewBlueprints(design: DesignBlueprintV2, interaction: InteractionBlueprintV2): BlueprintReviewResult {
  const findings: ReviewDiagnostic[] = [];

  if (design.layout.sections.length < 3) {
    findings.push(review("major", "completeness", "Design defines fewer than 3 sections; homepage likely incomplete.", "$.design.layout.sections"));
  }
  const headingEls = design.typography.headings.map((h) => h.element).filter((e) => /^h[1-6]$/.test(e));
  if (!headingEls.includes("h1")) {
    findings.push(review("major", "accessibility", "No h1 heading; page hierarchy must start with a single h1.", "$.design.typography.headings"));
  }
  if (headingEls.filter((h) => h === "h1").length > 1) {
    findings.push(review("major", "accessibility", "Multiple h1 headings; use a single h1.", "$.design.typography.headings"));
  }
  const focusInteractions = interaction.interactions.filter((i) => i.trigger === "focus");
  if (focusInteractions.length === 0) {
    findings.push(review("major", "accessibility", "No focus interactions; keyboard focus visibility must be specified.", "$.interaction.interactions"));
  }
  if (!interaction.interactions.some((i) => i.trigger === "hover")) {
    findings.push(review("major", "completeness", "No hover interaction; relevant controls and cards need visible pointer feedback.", "$.interaction.interactions"));
  }
  if (!interaction.interactions.some((i) => i.trigger === "scroll-reveal")) {
    findings.push(review("major", "completeness", "No section reveal interaction; multi-section pages need restrained entry motion.", "$.interaction.interactions"));
  }
  if (interaction.interactions.some((i) => !i.reducedMotionBehavior)) {
    findings.push(review("major", "accessibility", "One or more interactions lack a reducedMotionBehavior.", "$.interaction.interactions"));
  }
  const weaklyEvidenced = interaction.interactions.filter((i) => i.confidence < 0.4);
  for (const w of weaklyEvidenced.slice(0, 3)) {
    findings.push(review("minor", "evidence", `Interaction on '${w.selector}' has low confidence (${w.confidence}).`, "$.interaction.interactions"));
  }
  if (design.colors.roles.length < 2) {
    findings.push(review("minor", "consistency", "Fewer than 2 color roles defined.", "$.design.colors.roles"));
  }
  const imageSlots = design.imagery.slots.filter((slot) => typeof slot !== "string");
  if (imageSlots.length !== design.imagery.slots.length) {
    findings.push(review("major", "completeness", "Imagery uses legacy unscoped slots; every required image needs a page, placement, subject, and evidence.", "$.design.imagery.slots"));
  } else {
    const minimums = { "/": 3, "/services": 3, "/about": 1, "/contact": 1 } as const;
    for (const [page, minimum] of Object.entries(minimums)) {
      const pageSlots = imageSlots.filter((slot) => slot.page === page);
      if (pageSlots.length < minimum) {
        findings.push(review("major", "completeness", `${page} defines ${pageSlots.length} image slot(s); at least ${minimum} are required.`, "$.design.imagery.slots"));
      } else if (!pageSlots.some((slot) => slot.placement === "hero")) {
        findings.push(review("major", "completeness", `${page} has no hero image placement.`, "$.design.imagery.slots"));
      }
    }
  }
  const breakpoints = design.responsive.breakpoints;
  if (breakpoints.length > 1) {
    const sorted = [...breakpoints].sort((a, b) => a - b);
    if (JSON.stringify(sorted) !== JSON.stringify(breakpoints)) {
      findings.push(review("minor", "consistency", "Responsive breakpoints are not sorted ascending.", "$.design.responsive.breakpoints"));
    }
  }

  return { findings };
}

export function hasBlockingOrMajor(review: BlueprintReviewResult): boolean {
  return review.findings.some((f) => f.severity === "blocking" || f.severity === "major");
}

// ── Acceptance gate ─────────────────────────────────────────────────────────
export interface AcceptanceDecision {
  accept: boolean;
  reasons: string[];
}

export function decideAcceptance(
  runtime: BlueprintRuntimeValidation,
  provenance: ProvenanceResult,
  review: BlueprintReviewResult
): AcceptanceDecision {
  const reasons: string[] = [];
  if (!runtime.valid) reasons.push(`runtime schema invalid (${runtime.diagnostics.length} diagnostic(s))`);
  if (!provenance.valid) reasons.push(`provenance invalid (${provenance.diagnostics.length} diagnostic(s))`);
  if (hasBlockingOrMajor(review)) {
    const bm = review.findings.filter((f) => f.severity === "blocking" || f.severity === "major");
    reasons.push(`${bm.length} blocking/major review finding(s)`);
  }
  return { accept: reasons.length === 0, reasons };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function diag(severity: "blocking" | ValidationDiagnostic["severity"], code: string, path: string, message: string, expected: string | null): ValidationDiagnostic {
  return { code, path, message, expected, received: null, severity, repairGuidance: `${message} (expected: ${expected ?? "n/a"})` };
}

function review(severity: ReviewDiagnostic["severity"], category: ReviewDiagnostic["category"], message: string, path: string | null): ReviewDiagnostic {
  return { severity, category, message, path };
}

export const SCHEMA_VERSION = BLUEPRINT_SCHEMA_VERSION_V2;
