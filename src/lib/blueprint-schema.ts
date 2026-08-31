import type {
  BlueprintEvidence,
  BlueprintReviewIssue,
  BlueprintValidationIssue,
  BlueprintValidationResult,
  DesignBlueprint,
  InteractionBlueprint,
} from "../types";

export const BLUEPRINT_SCHEMA_VERSION = 1;
export const BLUEPRINT_PROMPT_VERSION = "phase-16.4-v1";

const STYLE_KEY_NAMES = [
  "minimalist-monochrome",
  "minimalist-modern",
  "editorial-serif",
  "high-contrast-luxury",
  "flat-design",
  "bold-typographic",
];

const RENDERER_TOKEN_RE = /(^|\s)((bg|text|border|rounded|shadow|flex|grid|gap|items|justify|space|col|row|md|sm|lg|xl|hover|focus)[-a-z0-9]+(\s+(bg|text|border|rounded|shadow|flex|grid|gap|items|justify|space|col|row|md|sm|lg|xl|hover|focus)[-a-z0-9]+)+)(\s|$)/;
const RENDERER_KEYWORD_RE = /\b(tailwind|shadcn|react|jsx|className|class=)\b/i;

function collectStrings(value: unknown, acc: string[]): void {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
}

export function detectRendererSpecificStrings(blueprint: unknown): string[] {
  const strings: string[] = [];
  collectStrings(blueprint, strings);
  const offenders: string[] = [];
  for (const s of strings) {
    if (RENDERER_TOKEN_RE.test(s) || RENDERER_KEYWORD_RE.test(s)) offenders.push(s);
    if (STYLE_KEY_NAMES.some((key) => s.toLowerCase().includes(key))) offenders.push(s);
  }
  return Array.from(new Set(offenders));
}

function issue(severity: BlueprintValidationIssue["severity"], code: string, message: string, path: string): BlueprintValidationIssue {
  return { severity, code, message, path };
}

function hasEvidence(ev: unknown): ev is BlueprintEvidence {
  return (
    !!ev &&
    typeof ev === "object" &&
    ["capture", "interaction", "screenshot", "client_facts"].includes((ev as BlueprintEvidence).source)
  );
}

function isColorValue(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) || /^rgba?\(/i.test(value) || /^hsla?\(/i.test(value);
}

export function validateDesignBlueprint(bp: Partial<DesignBlueprint>): BlueprintValidationIssue[] {
  const errors: BlueprintValidationIssue[] = [];
  if (bp.schemaVersion !== 1) errors.push(issue("critical", "SCHEMA_VERSION", "Design blueprint schemaVersion must be 1", "schemaVersion"));
  if (!bp.layout?.sections || bp.layout.sections.length === 0) {
    errors.push(issue("critical", "NO_SECTIONS", "Design blueprint must define at least one section", "layout.sections"));
  } else {
    bp.layout.sections.forEach((s, i) => {
      if (!hasEvidence(s.evidence)) errors.push(issue("major", "MISSING_EVIDENCE", `Section '${s.id}' lacks evidence`, `layout.sections[${i}].evidence`));
      if (typeof s.confidence !== "number") errors.push(issue("major", "NO_CONFIDENCE", `Section '${s.id}' lacks confidence`, `layout.sections[${i}].confidence`));
    });
  }
  if (!bp.typography?.body || !hasEvidence(bp.typography.body.evidence)) {
    errors.push(issue("major", "MISSING_EVIDENCE", "Body typography requires evidence", "typography.body.evidence"));
  }
  if (!bp.colors?.roles || bp.colors.roles.length === 0) {
    errors.push(issue("critical", "NO_COLORS", "Design blueprint must define color roles", "colors.roles"));
  } else {
    const roles = new Set(bp.colors.roles.map((r) => r.role));
    if (!roles.has("background")) errors.push(issue("major", "NO_BACKGROUND_ROLE", "Color roles must include 'background'", "colors.roles"));
    if (!roles.has("text")) errors.push(issue("major", "NO_TEXT_ROLE", "Color roles must include 'text'", "colors.roles"));
    bp.colors.roles.forEach((r, i) => {
      if (!hasEvidence(r.evidence)) errors.push(issue("major", "MISSING_EVIDENCE", `Color role '${r.role}' lacks evidence`, `colors.roles[${i}].evidence`));
      if (!isColorValue(r.value)) errors.push(issue("minor", "BAD_COLOR", `Color role '${r.role}' value '${r.value}' is not a recognized color format`, `colors.roles[${i}].value`));
    });
  }
  if (!bp.navigation?.items || bp.navigation.items.length === 0) {
    errors.push(issue("major", "NO_NAV", "Design blueprint must define navigation items", "navigation.items"));
  }
  if (typeof bp.confidence !== "number") {
    errors.push(issue("major", "NO_CONFIDENCE", "Design blueprint requires a top-level confidence", "confidence"));
  }
  return errors;
}

export function validateInteractionBlueprint(bp: Partial<InteractionBlueprint>): BlueprintValidationIssue[] {
  const errors: BlueprintValidationIssue[] = [];
  if (bp.schemaVersion !== 1) errors.push(issue("critical", "SCHEMA_VERSION", "Interaction blueprint schemaVersion must be 1", "schemaVersion"));
  if (!bp.interactions || bp.interactions.length === 0) {
    errors.push(issue("critical", "NO_INTERACTIONS", "Interaction blueprint must define at least one interaction", "interactions"));
  } else {
    bp.interactions.forEach((it, i) => {
      if (typeof it.observed !== "boolean") errors.push(issue("major", "NO_OBSERVED_FLAG", `Interaction '${it.selector}' must mark observed vs inferred`, `interactions[${i}].observed`));
      if (!it.reducedMotionBehavior) errors.push(issue("major", "NO_REDUCED_MOTION", `Interaction '${it.selector}' must define reducedMotionBehavior`, `interactions[${i}].reducedMotionBehavior`));
      if (!hasEvidence(it.evidence)) errors.push(issue("major", "MISSING_EVIDENCE", `Interaction '${it.selector}' lacks evidence`, `interactions[${i}].evidence`));
    });
  }
  if (!bp.reducedMotionStrategy) {
    errors.push(issue("critical", "NO_REDUCED_MOTION_STRATEGY", "Interaction blueprint must define a reducedMotionStrategy", "reducedMotionStrategy"));
  }
  if (typeof bp.confidence !== "number") {
    errors.push(issue("major", "NO_CONFIDENCE", "Interaction blueprint requires a top-level confidence", "confidence"));
  }
  return errors;
}

export function validateBlueprints(
  design: Partial<DesignBlueprint>,
  interaction: Partial<InteractionBlueprint>
): BlueprintValidationResult {
  const errors = [
    ...validateDesignBlueprint(design),
    ...validateInteractionBlueprint(interaction),
  ];
  const rendererSpecificStrings = Array.from(
    new Set([...detectRendererSpecificStrings(design), ...detectRendererSpecificStrings(interaction)])
  );
  const allIssues = [...errors];
  for (const s of rendererSpecificStrings) {
    allIssues.push(issue("critical", "RENDERER_SPECIFIC", `Blueprint contains renderer-specific string: '${s}'`, "$.strings"));
  }
  const blocking = allIssues.filter((e) => e.severity === "critical" || e.severity === "major");
  return {
    valid: blocking.length === 0,
    errors: allIssues,
    rendererSpecificStrings,
  };
}

export function reviewBlueprints(
  design: DesignBlueprint,
  interaction: InteractionBlueprint
): BlueprintReviewIssue[] {
  const issues: BlueprintReviewIssue[] = [];

  if (design.layout.sections.length < 3) {
    issues.push({ severity: "major", category: "completeness", message: "Design blueprint defines fewer than 3 sections; homepage likely incomplete." });
  }
  const headingLevels = design.typography.headings.map((h) => h.element).filter((e) => /^h[1-6]$/.test(e));
  if (!headingLevels.includes("h1")) {
    issues.push({ severity: "major", category: "accessibility", message: "No h1 heading defined; page hierarchy must start with a single h1." });
  }
  if (headingLevels.filter((h) => h === "h1").length > 1) {
    issues.push({ severity: "major", category: "accessibility", message: "Multiple h1 headings defined; use a single h1 per page." });
  }
  const focusInteractions = interaction.interactions.filter((i) => i.trigger === "focus");
  if (focusInteractions.length === 0) {
    issues.push({ severity: "major", category: "accessibility", message: "No focus interactions defined; keyboard focus visibility must be specified." });
  }
  if (interaction.interactions.some((i) => !i.reducedMotionBehavior)) {
    issues.push({ severity: "major", category: "accessibility", message: "One or more interactions lack a reducedMotionBehavior." });
  }
  const breakpoints = design.responsive.breakpoints;
  if (breakpoints.length > 1) {
    const sorted = [...breakpoints].sort((a, b) => a - b);
    if (JSON.stringify(sorted) !== JSON.stringify(breakpoints)) {
      issues.push({ severity: "minor", category: "consistency", message: "Responsive breakpoints are not sorted ascending." });
    }
  }
  const colorValues = new Set(design.colors.roles.map((r) => r.value.toLowerCase()));
  if (design.colors.roles.some((r) => !isColorValue(r.value))) {
    issues.push({ severity: "minor", category: "consistency", message: "Some color role values are not recognized color formats." });
  }
  if (colorValues.size < 2) {
    issues.push({ severity: "minor", category: "consistency", message: "Fewer than 2 distinct color values defined." });
  }
  void colorValues;

  return issues;
}
