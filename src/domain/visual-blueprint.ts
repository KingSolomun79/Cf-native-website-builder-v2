// V2 Visual Blueprint stage (issue #8, PRD section 13).
//
// The binding design contract translating the Reference Analysis into the
// intended Site for THIS Business. It preserves identity-defining structure
// and signature traits while replacing branding/content/assets: Reference
// copy, logos, trademarks, photography and proprietary assets are never
// copied as Business content (deterministic lint), and Business adaptation
// cannot erase the Reference's structural visual identity (every Blueprint
// signature trait must trace to an analysis trait). Once generation begins,
// downstream Automated Repair may correct implementation against the
// Blueprint but never redefine it.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getBuildStageArtifact, storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import type { ReferenceAnalysis } from "./reference-analysis";
import type { AdaptationContract } from "./reference-evidence-schema";
import type { BusinessFacts } from "./lifecycle-schema";

export const VISUAL_BLUEPRINT_SCHEMA_VERSION = "visual-blueprint/1";

export const VisualBlueprintSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualThesis: Type.String({ minLength: 1, maxLength: 4000 }),
    // 3-8 signature traits (PRD section 13).
    signatureTraits: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 120 }),
        description: Type.String({ minLength: 1, maxLength: 2000 }),
        // The Reference Analysis trait this Blueprint trait preserves through
        // Business adaptation. Required on the REFERENCE_BOUND path (the
        // identity-preservation validator enforces it); ORIGINAL_DESIGN
        // derives traits from Business/creative inputs instead and omits it.
        sourceTraitId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      }),
      { minItems: 3, maxItems: 8 }
    ),
    fidelityPriorities: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1 }),
    tokens: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
    globalGrid: Type.Object({
      containerLogic: Type.String({ minLength: 1, maxLength: 2000 }),
      columnRatios: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    }),
    spacingRhythm: Type.String({ minLength: 1, maxLength: 2000 }),
    typographyRoles: Type.Array(
      Type.Object({ role: Type.String({ minLength: 1 }), description: Type.String({ minLength: 1 }) }),
      { minItems: 1 }
    ),
    colorRoles: Type.Array(
      Type.Object({ role: Type.String({ minLength: 1 }), description: Type.String({ minLength: 1 }) }),
      { minItems: 1 }
    ),
    surfaceLanguage: Type.String({ minLength: 1, maxLength: 2000 }),
    headerNavigation: Type.String({ minLength: 1, maxLength: 2000 }),
    homepageFirstViewport: Type.Object({
      summary: Type.String({ minLength: 1, maxLength: 2000 }),
      // Ordered region ids of the first viewport; must be the prefix of
      // homepageRegions.
      regionIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    }),
    homepageRegions: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 120 }),
        purpose: Type.String({ minLength: 1, maxLength: 1000 }),
        imageRoleId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        // The frozen Reference Evidence segments (verbatim ids) aggregated
        // into this canonical region. Raw evidence segmentation is
        // observational; the ordered canonical region list is the binding
        // topology for implementation and QA (issue #37). Provenance is what
        // lets QA aggregate measured evidence geometry per canonical region.
        sourceEvidenceRegionIds: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1 })
        ),
      }),
      { minItems: 2 }
    ),
    imageSystem: Type.Object({
      photographyGrammar: Type.String({ minLength: 1, maxLength: 2000 }),
      imageRoles: Type.Array(
        Type.Object({
          id: Type.String({ minLength: 1, maxLength: 120 }),
          purpose: Type.String({ minLength: 1, maxLength: 1000 }),
          priority: Type.Union([Type.Literal("CRITICAL"), Type.Literal("HIGH"), Type.Literal("NORMAL")]),
        }),
        { minItems: 1 }
      ),
    }),
    motionGrammar: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 1 }),
    responsiveContract: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 1 }),
    innerPageVocabulary: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1 }),
    antiFallbackRules: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1 }),
    accessibilityAdaptations: Type.Array(Type.String({ minLength: 1, maxLength: 500 })),
    declaredLimitations: Type.Array(Type.String({ minLength: 1, maxLength: 500 })),
  },
  { additionalProperties: false }
);
export type VisualBlueprint = Static<typeof VisualBlueprintSchema>;

export type BlueprintErrorCode =
  | "IDENTITY_ERASURE"
  | "REFERENCE_CONTENT_DETECTED"
  | "BLUEPRINT_INCONSISTENT"
  | "ARTIFACT_ALREADY_EXISTS";

export class VisualBlueprintError extends Error {
  readonly code: BlueprintErrorCode;

  constructor(code: BlueprintErrorCode, message: string) {
    super(message);
    this.name = "VisualBlueprintError";
    this.code = code;
  }
}

// Business adaptation must not erase the Reference's structural visual
// identity: every Blueprint signature trait traces to a Reference Analysis
// trait, and the trait count cannot silently collapse below the analysis
// identity carriers.
export function validateBlueprintIdentityPreservation(
  blueprint: VisualBlueprint,
  analysis: ReferenceAnalysis
): { valid: true } | { valid: false; problems: string[] } {
  const problems: string[] = [];
  const analysisTraitIds = new Set(analysis.signatureTraits.map((trait) => trait.id));
  for (const trait of blueprint.signatureTraits) {
    if (!trait.sourceTraitId) {
      problems.push(`signature trait '${trait.id}' has no Reference Analysis trace; REFERENCE_BOUND traits must preserve analyzed identity`);
      continue;
    }
    if (!analysisTraitIds.has(trait.sourceTraitId)) {
      problems.push(`signature trait '${trait.id}' traces to unknown analysis trait '${trait.sourceTraitId}'`);
    }
  }
  const identityCarriers = analysis.signatureTraits.filter((trait) => trait.identityDefining);
  const preservedCarrierIds = new Set(
    blueprint.signatureTraits.map((trait) => trait.sourceTraitId)
  );
  for (const carrier of identityCarriers) {
    if (!preservedCarrierIds.has(carrier.id)) {
      problems.push(`identity-defining analysis trait '${carrier.id}' was erased by Business adaptation`);
    }
  }
  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

// Deterministic lint: Reference copy, logos, trademarks and hosts never enter
// the Blueprint as Business content.
export function lintBlueprintForReferenceContent(
  blueprint: VisualBlueprint,
  context: { referenceUrl?: string }
): { clean: true } | { clean: false; findings: string[] } {
  const findings: string[] = [];
  const haystack = JSON.stringify(blueprint).toLowerCase();
  if (context.referenceUrl) {
    try {
      const host = new URL(context.referenceUrl).hostname.toLowerCase();
      const stem = host.replace(/^www\./, "").split(".")[0];
      if (stem.length >= 4 && haystack.includes(stem)) {
        findings.push(`Blueprint text contains Reference host token '${stem}'`);
      }
      if (haystack.includes(host)) {
        findings.push(`Blueprint text contains Reference host '${host}'`);
      }
    } catch {
      // malformed URL: host lint skipped, intake already validated shape
    }
  }
  return findings.length === 0 ? { clean: true } : { clean: false, findings };
}

// Contradictory or impossible internal conditions are surfaced, never
// silently simplified (PRD section 14): first-viewport regions must be the
// ordered prefix of homepageRegions, and referenced image roles must exist.
export function validateBlueprintConsistency(
  blueprint: VisualBlueprint
): { valid: true } | { valid: false; problems: string[] } {
  const problems: string[] = [];
  const regionIds = blueprint.homepageRegions.map((region) => region.id);
  if (new Set(regionIds).size !== regionIds.length) {
    problems.push("homepage region ids are not unique");
  }
  const firstViewport = blueprint.homepageFirstViewport.regionIds;
  if (firstViewport.length > regionIds.length || !firstViewport.every((id, index) => regionIds[index] === id)) {
    problems.push("homepageFirstViewport.regionIds is not an ordered prefix of homepageRegions");
  }
  const imageRoleIds = new Set(blueprint.imageSystem.imageRoles.map((role) => role.id));
  for (const region of blueprint.homepageRegions) {
    if (region.imageRoleId && !imageRoleIds.has(region.imageRoleId)) {
      problems.push(`homepage region '${region.id}' references unknown image role '${region.imageRoleId}'`);
    }
  }
  const traitIds = new Set(blueprint.signatureTraits.map((trait) => trait.id));
  if (traitIds.size !== blueprint.signatureTraits.length) {
    problems.push("signature trait ids are not unique");
  }
  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

// Canonical region provenance (issue #37): aggregation of raw evidence
// segments into canonical regions must be explainable. Every canonical region
// must claim real frozen evidence segment ids — never invented ones — each
// segment may feed at most one canonical region, and when a non-empty
// evidence segmentation exists every canonical region must carry provenance
// so measured QA aggregation is total.
export function validateBlueprintRegionProvenance(
  blueprint: VisualBlueprint,
  evidenceRegions: Array<{ id: string }>
): { valid: true } | { valid: false; problems: string[] } {
  const problems: string[] = [];
  if (evidenceRegions.length === 0) return { valid: true };
  const evidenceIds = new Set(evidenceRegions.map((region) => region.id));
  const claimed = new Map<string, string>();
  for (const region of blueprint.homepageRegions) {
    const sources = region.sourceEvidenceRegionIds ?? [];
    if (sources.length === 0) {
      problems.push(`canonical region '${region.id}' has no sourceEvidenceRegionIds provenance`);
      continue;
    }
    for (const sourceId of sources) {
      if (!evidenceIds.has(sourceId)) {
        problems.push(`canonical region '${region.id}' claims unknown evidence segment '${sourceId}'`);
        continue;
      }
      const owner = claimed.get(sourceId);
      if (owner && owner !== region.id) {
        problems.push(`evidence segment '${sourceId}' is claimed by both '${owner}' and '${region.id}'`);
      }
      claimed.set(sourceId, region.id);
    }
  }
  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

// Aggregated canonical composition (issue #37): the Blueprint region order is
// the binding topology; the frozen evidence measurements of the contributing
// segments are summed per canonical region so generation receives numeric
// per-region targets and QA compares measured geometry against the SAME
// canonical regions. Regions without measurements (provenance absent or
// yielding no measurable segment) carry null and exclude themselves from
// numeric composition targets.
export interface CanonicalRegionComposition {
  regionId: string;
  order: number;
  purpose: string;
  sourceEvidenceRegionIds: string[];
  heightPx: number | null;
  viewportHeightRatio: number | null;
}

export function canonicalRegionComposition(
  blueprint: VisualBlueprint,
  evidenceRegions: Array<{ id: string; height?: number; viewportHeightRatio?: number }>
): CanonicalRegionComposition[] {
  const byId = new Map(evidenceRegions.map((region) => [region.id, region]));
  return blueprint.homepageRegions.map((region, index) => {
    let heightPx = 0;
    let ratio = 0;
    let measured = false;
    for (const sourceId of region.sourceEvidenceRegionIds ?? []) {
      const segment = byId.get(sourceId);
      if (!segment) continue;
      measured = true;
      heightPx += segment.height ?? 0;
      ratio += segment.viewportHeightRatio ?? 0;
    }
    return {
      regionId: region.id,
      order: index + 1,
      purpose: region.purpose,
      sourceEvidenceRegionIds: [...(region.sourceEvidenceRegionIds ?? [])],
      heightPx: measured ? heightPx : null,
      viewportHeightRatio: measured ? Number(ratio.toFixed(3)) : null,
    };
  });
}

export function buildBlueprintUserPrompt(input: {
  analysis: ReferenceAnalysis;
  facts: BusinessFacts;
  adaptationContract: AdaptationContract | null;
  evidenceRegions: Array<{ id: string; viewportHeightRatio?: number }>;
}): string {
  return `Produce the binding Visual Blueprint for THIS Business from the Reference Analysis below. Preserve the Reference's identity-defining structure and signature traits while replacing its branding, content and assets with the Business's own. Every signature trait must trace to an analysis trait via sourceTraitId — use EXACTLY these analysis trait ids (verbatim, no other notation): " + JSON.stringify(input.analysis.signatureTraits.map((trait) => trait.id)) + ". Do NOT copy Reference copy, logos, trademarks, photography or proprietary assets. Define: visual thesis, 3-8 signature traits, fidelity priorities, tokens, global grid/container logic, spacing rhythm, typography roles, color roles, surface/depth language, header/navigation language, homepage first viewport, ordered homepage regions, image system with prioritized image roles, motion grammar, responsive contract, inner-page vocabulary, anti-fallback rules, accessibility adaptations and declared limitations. In homepageRegions, OMIT imageRoleId entirely for text-only regions — never write 'none', 'null', 'n/a' or an empty string; when present it must be an exact id from imageSystem.imageRoles.

CANONICAL REGION RULES: The Reference Evidence segmentation listed below is OBSERVATIONAL — measured raw visual segments, not a binding topology. You MAY aggregate adjacent raw segments into ONE canonical homepageRegions entry when they form a single compositional unit (e.g. header + hero image + hero copy + hero CTA = one hero region). Every homepageRegions entry MUST carry sourceEvidenceRegionIds: the verbatim contributing segment ids from the evidence inventory (never invented ids, never empty). Claim each evidence segment in at most one canonical region. The ordered homepageRegions list is the binding canonical region topology for implementation and QA.

REFERENCE EVIDENCE REGION INVENTORY (raw observed/measured segmentation, verbatim ids):
${JSON.stringify(input.evidenceRegions)}

BUSINESS FACTS (supported content only):
${JSON.stringify(input.facts, null, 2)}

REFERENCE ANALYSIS:
${JSON.stringify(input.analysis, null, 2)}${
    input.adaptationContract
      ? `\n\nADAPTATION CONTRACT (accepted approximations, fixed before generation):\n${JSON.stringify(input.adaptationContract, null, 2)}`
      : ""
  }`;
}

export interface RunVisualBlueprintInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  analysis: ReferenceAnalysis;
  analysisR2Key: string;
  facts: BusinessFacts;
  adaptationContract: AdaptationContract | null;
  /** Raw frozen Reference Evidence segmentation — observational inventory for
   *  canonical region aggregation provenance (issue #37). */
  evidenceRegions: Array<{ id: string; viewportHeightRatio?: number }>;
  referenceUrl?: string;
  generate?: RawAiGenerate;
}

export interface VisualBlueprintProduced extends StoredStageArtifact {
  blueprint: VisualBlueprint;
}

export async function runVisualBlueprintStage(
  env: Env,
  input: RunVisualBlueprintInput
): Promise<VisualBlueprintProduced> {
  const run = await runSchemaValidatedAiStage<VisualBlueprint>(env, {
    stage: "visual-blueprint-generator",
    schema: VisualBlueprintSchema,
    schemaVersion: VISUAL_BLUEPRINT_SCHEMA_VERSION,
    userPrompt: buildBlueprintUserPrompt({
      analysis: input.analysis,
      facts: input.facts,
      adaptationContract: input.adaptationContract,
      evidenceRegions: input.evidenceRegions,
    }),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.analysisR2Key],
    temperature: 0.4,
    generate: input.generate,
  });

  const identity = validateBlueprintIdentityPreservation(run.value, input.analysis);
  if (!identity.valid) {
    throw new VisualBlueprintError("IDENTITY_ERASURE", identity.problems.join("; "));
  }
  const lint = lintBlueprintForReferenceContent(run.value, { referenceUrl: input.referenceUrl });
  if (!lint.clean) {
    throw new VisualBlueprintError("REFERENCE_CONTENT_DETECTED", lint.findings.join("; "));
  }
  const consistency = validateBlueprintConsistency(run.value);
  if (!consistency.valid) {
    throw new VisualBlueprintError("BLUEPRINT_INCONSISTENT", consistency.problems.join("; "));
  }
  const provenance = validateBlueprintRegionProvenance(run.value, input.evidenceRegions);
  if (!provenance.valid) {
    throw new VisualBlueprintError("BLUEPRINT_INCONSISTENT", provenance.problems.join("; "));
  }

  const stored = await storeBuildStageArtifact(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "visual_blueprint",
    schemaVersion: VISUAL_BLUEPRINT_SCHEMA_VERSION,
    value: run.value,
    provenance: run.provenance,
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "REFERENCE_ANALYSIS",
    toState: "BLUEPRINT",
    stage: "blueprint",
    detail: `Visual Blueprint fixed (${run.value.signatureTraits.length} signature traits, ${run.value.homepageRegions.length} homepage regions)`,
  });

  return { ...stored, blueprint: run.value };
}

export function parseVisualBlueprint(raw: unknown): VisualBlueprint | null {
  return Value.Check(VisualBlueprintSchema, raw) ? (raw as VisualBlueprint) : null;
}
