// V2 Visual Blueprint stage (issue #8, PRD section 13; obligation ledger
// added with issue #59 after the 2026-09-06 blueprint convergence forensic).
//
// The binding design contract translating the Reference Analysis into the
// intended Site for THIS Business. It preserves identity-defining structure
// and signature traits while replacing branding/content/assets: Reference
// copy, logos, trademarks, photography and proprietary assets are never
// copied as Business content (deterministic lint), and Business adaptation
// cannot erase the Reference's structural visual identity. Identity is
// accounted for through an explicit TRAIT OBLIGATION LEDGER: every
// identity-defining Reference Analysis trait must carry exactly one
// disposition — PRESERVED (realized by existing canonical regions) or
// ADAPTED (under an existing immutable Adaptation Contract clause, FDR
// #110) — so a trait can be realized through any internal naming without a
// dedicated signature-trait slot, and absence is deterministic erasure.
// Once generation begins, downstream Automated Repair may correct
// implementation against the Blueprint but never redefine it.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate, type RunSchemaValidatedAiStageOptions } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getBuildStageArtifact, storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import type { ReferenceAnalysis } from "./reference-analysis";
import type { AdaptationContract, ReferenceEvidence } from "./reference-evidence-schema";
import type { BusinessFacts } from "./lifecycle-schema";

export const VISUAL_BLUEPRINT_SCHEMA_VERSION = "visual-blueprint/2";

// Cross-stage trait accounting (issue #59): one explicit disposition per
// binding Reference Analysis identity trait. Realization references point at
// canonical homepageRegions — the only id-bearing structural carriers in the
// Blueprint — so an obligation can never be an empty claim. Schema-optional
// so ORIGINAL_DESIGN Blueprints (no Reference Analysis) are untouched; the
// REFERENCE_BOUND identity gate requires the ledger in full.
export const TraitObligationSchema = Type.Object(
  {
    // The Reference Analysis trait this obligation disposes of (verbatim id).
    sourceTraitId: Type.String({ minLength: 1, maxLength: 120 }),
    disposition: Type.Union([Type.Literal("PRESERVED"), Type.Literal("ADAPTED")]),
    // Canonical regions that realize the trait (or its authorized adaptation).
    realizedByRegionIds: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { minItems: 1 }),
    // For ADAPTED: the exact immutable Adaptation Contract clause that
    // authorizes the adaptation (an existing `unsupportedFeatures[].feature`
    // or `acceptedApproximations[].replaces` token — FDR #110 authority).
    adaptationClauseId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  },
  { additionalProperties: false }
);
export type TraitObligation = Static<typeof TraitObligationSchema>;

export const VisualBlueprintSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualThesis: Type.String({ minLength: 1, maxLength: 4000 }),
    // 3-8 signature traits (PRD section 13): the Blueprint's concise design
    // vocabulary — NOT the identity accounting mechanism (that is the
    // traitObligations ledger below, which has no creative cap conflict).
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
    traitObligations: Type.Optional(Type.Array(TraitObligationSchema, { maxItems: 16 })),
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
// identity (issue #59): every Blueprint signature trait still traces to a
// Reference Analysis trait, and every identity-defining analysis trait must
// have EXACTLY ONE explicit disposition in the traitObligations ledger —
// PRESERVED with real canonical-region realizations, or ADAPTED under an
// existing immutable Adaptation Contract clause (FDR #110). Absence is
// deterministic erasure. The ledger frees identity from the 3-8 trait-slot
// cap: a trait realized through different internal naming still passes.
export function validateBlueprintIdentityPreservation(
  blueprint: VisualBlueprint,
  analysis: ReferenceAnalysis,
  adaptationContract: AdaptationContract | null
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
  const carriers = analysis.signatureTraits.filter((trait) => trait.identityDefining);
  if (carriers.length > 0 && !blueprint.traitObligations) {
    problems.push(
      "no traitObligations ledger: every binding Reference Analysis trait requires exactly one explicit PRESERVED/ADAPTED disposition"
    );
  }
  problems.push(...evaluateTraitObligations(blueprint, analysis, adaptationContract).problems);
  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

// Deterministic Adaptation Contract authority (FDR #110): an ADAPTED
// disposition is legal only when an immutable contract clause exists AND that
// clause concerns THIS trait — anchored by token overlap against the trait's
// own frozen analysis description/evidence (immutable inputs), never against
// model-written repair prose. Returns null when authorized, else the problem.
export function adaptationClauseAuthority(
  obligation: TraitObligation,
  trait: ReferenceAnalysis["signatureTraits"][number] | undefined,
  adaptationContract: AdaptationContract | null
): string | null {
  if (obligation.disposition === "PRESERVED") {
    return obligation.adaptationClauseId
      ? `obligation '${obligation.sourceTraitId}' is PRESERVED but also cites adaptation clause '${obligation.adaptationClauseId}'`
      : null;
  }
  if (!obligation.adaptationClauseId) {
    return `ADAPTED obligation '${obligation.sourceTraitId}' cites no adaptationClauseId; Business adaptation requires an existing immutable Adaptation Contract clause`;
  }
  if (!adaptationContract) {
    return `ADAPTED obligation '${obligation.sourceTraitId}' has no Adaptation Contract to authorize it`;
  }
  const clauses = [
    ...adaptationContract.unsupportedFeatures.map((entry) => entry.feature),
    ...adaptationContract.acceptedApproximations.map((entry) => entry.replaces),
  ];
  if (!clauses.includes(obligation.adaptationClauseId)) {
    return `ADAPTED obligation '${obligation.sourceTraitId}' cites unknown adaptation clause '${obligation.adaptationClauseId}'`;
  }
  if (trait) {
    const clauseTokens = obligation.adaptationClauseId
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    const anchorText = `${trait.description} ${trait.evidenceRefs.join(" ")}`.toLowerCase();
    if (clauseTokens.length > 0 && !clauseTokens.some((token) => anchorText.includes(token))) {
      return `ADAPTED obligation '${obligation.sourceTraitId}' cites unrelated clause '${obligation.adaptationClauseId}' — the clause does not concern this trait`;
    }
  }
  return null;
}

// Per-obligation ledger evaluation (issue #59). Shared by the identity gate
// and by Blueprint repair (issue #60): satisfiedObligations is the passing
// preservation set; rejectedObligations names the exact failed findings.
export interface TraitObligationEvaluation {
  /** Aggregate problems (duplicates, erased carriers, per-obligation failures). */
  problems: string[];
  /** Identity-defining analysis traits with no obligation at all. */
  missingCarrierIds: string[];
  /** Ledger entries that fully validate (exist, authorized, realized). */
  satisfiedObligations: TraitObligation[];
  /** Ledger entries that fail, with the deterministic reason. */
  rejectedObligations: Array<{ obligation: TraitObligation; problem: string }>;
}

export function evaluateTraitObligations(
  blueprint: VisualBlueprint,
  analysis: ReferenceAnalysis,
  adaptationContract: AdaptationContract | null
): TraitObligationEvaluation {
  const problems: string[] = [];
  const byId = new Map(analysis.signatureTraits.map((trait) => [trait.id, trait]));
  const carrierIds = new Set(
    analysis.signatureTraits.filter((trait) => trait.identityDefining).map((trait) => trait.id)
  );
  const regionIds = new Set(blueprint.homepageRegions.map((region) => region.id));
  const ledger = blueprint.traitObligations ?? [];

  const seen = new Map<string, number>();
  const satisfiedObligations: TraitObligation[] = [];
  const rejectedObligations: TraitObligationEvaluation["rejectedObligations"] = [];
  for (const obligation of ledger) {
    seen.set(obligation.sourceTraitId, (seen.get(obligation.sourceTraitId) ?? 0) + 1);
    let problem: string | null = null;
    if (!byId.has(obligation.sourceTraitId)) {
      problem = `traces to unknown analysis trait '${obligation.sourceTraitId}'`;
    } else if (!carrierIds.has(obligation.sourceTraitId)) {
      problem = `'${obligation.sourceTraitId}' is not identity-defining; the ledger must cover exactly the binding trait set`;
    }
    if (!problem) {
      for (const regionId of obligation.realizedByRegionIds) {
        if (!regionIds.has(regionId)) {
          problem = `realization references nonexistent canonical region '${regionId}'`;
          break;
        }
      }
    }
    if (!problem) {
      problem = adaptationClauseAuthority(obligation, byId.get(obligation.sourceTraitId), adaptationContract);
    }
    if (problem) rejectedObligations.push({ obligation, problem });
    else satisfiedObligations.push(obligation);
  }

  for (const [sourceTraitId, count] of seen) {
    if (count > 1) {
      problems.push(`duplicate disposition for '${sourceTraitId}' (${count} obligations); every binding trait has exactly one`);
    }
  }
  const missingCarrierIds: string[] = [];
  for (const carrierId of carrierIds) {
    if (!seen.has(carrierId)) {
      missingCarrierIds.push(carrierId);
      problems.push(`identity-defining analysis trait '${carrierId}' was erased by Business adaptation`);
    }
  }
  for (const entry of rejectedObligations) {
    problems.push(`obligation '${entry.obligation.sourceTraitId}': ${entry.problem}`);
  }
  return { problems, missingCarrierIds, satisfiedObligations, rejectedObligations };
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

// Aggregation may combine subordinate visual parts but may not erase the
// Reference (issue #42). Coverage contract: every identity-defining analysis
// trait and every MAJOR measured visual mass must map to a canonical
// Blueprint region/trait, or to an explicit Adaptation Contract entry. This
// is significance-based, not count-based: works for 3-section landing pages
// and 20-section editorial pages alike. A gap emits
// BLUEPRINT_REVIEW_REQUIRED upstream — generation never starts from a known
// lossy Blueprint.
export interface BlueprintCoverageInput {
  blueprint: VisualBlueprint;
  analysis: ReferenceAnalysis;
  /** Frozen evidence regions (DOM or extracted pixel bands) with measured ratios. */
  evidenceRegions: Array<{ id: string; viewportHeightRatio?: number }>;
  /** Deterministic screenshot extraction channel (image masses, surface bands). */
  extraction?: ReferenceEvidence["extraction"];
  adaptationContract: AdaptationContract | null;
}

export interface BlueprintCoverage {
  status: "COVERED" | "GAPS";
  /** Identity-defining analysis traits erased by the Blueprint. */
  uncoveredTraits: string[];
  /** Major measured masses (>= ~1/3 viewport) no canonical region claims. */
  uncoveredMasses: Array<{ regionId: string; viewportHeightRatio: number | null }>;
  /** Extraction image-mass bands not covered by any claimed evidence region. */
  uncoveredImageMasses: string[];
  /** Share of total measured viewport height claimed by canonical regions. */
  claimedMassRatio: number | null;
  reasons: string[];
}

// A mass is "major" when it measurably occupies at least ~1/3 of a viewport:
// observed visual significance, not a fixed region count.
const MAJOR_MASS_RATIO = 0.35;

export function evaluateBlueprintCoverage(input: BlueprintCoverageInput): BlueprintCoverage {
  const { blueprint, analysis, evidenceRegions, extraction, adaptationContract } = input;

  // a) Identity-defining traits must be explicitly disposed in the
  //    traitObligations ledger (issue #59). An authorized ADAPTED disposition
  //    covers the trait; a missing disposition is erasure. (Disposition
  //    validity itself is the identity gate's job, which runs before persist.)
  const dispositioned = new Set((blueprint.traitObligations ?? []).map((obligation) => obligation.sourceTraitId));
  const uncoveredTraits = analysis.signatureTraits
    .filter((trait) => trait.identityDefining && !dispositioned.has(trait.id))
    .map((trait) => trait.id);

  // Declared adaptations can legally accept a mass drop (feature token
  // 'mass:<segment-id>'); nothing else may erase a measured mass.
  const declared = new Set<string>();
  if (adaptationContract) {
    for (const entry of adaptationContract.unsupportedFeatures) declared.add(entry.feature);
    for (const entry of adaptationContract.acceptedApproximations) declared.add(entry.replaces);
  }

  // b) Major measured masses must be claimed by a canonical region.
  const claimedSegmentIds = new Set(
    blueprint.homepageRegions.flatMap((region) => region.sourceEvidenceRegionIds ?? [])
  );
  const uncoveredMasses: BlueprintCoverage["uncoveredMasses"] = [];
  let claimedHeight = 0;
  let totalHeight = 0;
  for (const region of evidenceRegions) {
    const ratio = typeof region.viewportHeightRatio === "number" ? region.viewportHeightRatio : null;
    if (ratio !== null) {
      totalHeight += ratio;
      if (claimedSegmentIds.has(region.id)) claimedHeight += ratio;
    }
    const major = (ratio ?? 0) >= MAJOR_MASS_RATIO;
    if (major && !claimedSegmentIds.has(region.id) && !declared.has(`mass:${region.id}`)) {
      uncoveredMasses.push({ regionId: region.id, viewportHeightRatio: ratio });
    }
  }

  // c) Extraction image-mass bands must sit inside claimed evidence territory
  //    (y-overlap with any claimed region that carries geometry) or be
  //    explicitly declared. Only evaluated when geometry exists on both sides.
  const claimedGeometries = evidenceRegions
    .filter((region) => claimedSegmentIds.has(region.id))
    .map((region) => region as { startY?: number; endY?: number })
    .filter((region) => typeof region.startY === "number" && typeof region.endY === "number");
  const uncoveredImageMasses: string[] = [];
  if (extraction?.coverage.decoded) {
    for (const mass of extraction.imageMasses) {
      const y0 = mass.boundingBox.y;
      const y1 = mass.boundingBox.y + mass.boundingBox.height;
      const covered =
        claimedGeometries.some((geometry) => geometry.startY! < y1 && geometry.endY! > y0) ||
        declared.has(`mass:y:${y0}`);
      if (!covered) uncoveredImageMasses.push(`y:${y0}-${y1}`);
    }
  }

  const reasons: string[] = [];
  if (uncoveredTraits.length > 0) {
    reasons.push(`identity-defining analysis traits erased by the Blueprint: ${uncoveredTraits.join(", ")}`);
  }
  if (uncoveredMasses.length > 0) {
    reasons.push(
      `major measured visual masses not claimed by any canonical region: ${uncoveredMasses
        .map((mass) => `${mass.regionId} (${mass.viewportHeightRatio ?? "unknown"} viewports)`)
        .join(", ")}`
    );
  }
  if (uncoveredImageMasses.length > 0) {
    reasons.push(`image-mass bands outside claimed canonical territory: ${uncoveredImageMasses.join(", ")}`);
  }

  return {
    status: reasons.length === 0 ? "COVERED" : "GAPS",
    uncoveredTraits,
    uncoveredMasses,
    uncoveredImageMasses,
    claimedMassRatio: totalHeight > 0 ? Number((claimedHeight / totalHeight).toFixed(3)) : null,
    reasons,
  };
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
  const bindingTraitIds = input.analysis.signatureTraits.filter((trait) => trait.identityDefining).map((trait) => trait.id);
  return `Produce the binding Visual Blueprint for THIS Business from the Reference Analysis below. Preserve the Reference's identity-defining structure and signature traits while replacing its branding, content and assets with the Business's own. Do NOT copy Reference copy, logos, trademarks, photography or proprietary assets. Define: visual thesis, 3-8 concise signature traits (each tracing via sourceTraitId to the analysis trait it preserves — exact ids, no other notation), fidelity priorities, tokens, global grid/container logic, spacing rhythm, typography roles, color roles, surface/depth language, header/navigation language, homepage first viewport, ordered homepage regions, image system with prioritized image roles, motion grammar, responsive contract, inner-page vocabulary, anti-fallback rules, accessibility adaptations and declared limitations. In homepageRegions, OMIT imageRoleId entirely for text-only regions — never write 'none', 'null', 'n/a' or an empty string; when present it must be an exact id from imageSystem.imageRoles. fidelityPriorities are ordered plain strings, each formatted exactly 'N. dimension — reason' (example: '1. first viewport topology — identity-defining mass').

TRAIT OBLIGATION LEDGER (binding, issue #59): the Reference Analysis binds ${bindingTraitIds.length} identity traits — exactly these ids: ${JSON.stringify(bindingTraitIds)}. This count never exceeds the schema maximum. You MUST provide exactly one traitObligations entry for EVERY binding trait id — no fewer, no more, no duplicates, no unknown ids. For each binding trait:
- disposition 'PRESERVED' with realizedByRegionIds naming at least one real canonical region from your homepageRegions that realizes the trait; or
- disposition 'ADAPTED' with adaptationClauseId naming the exact immutable Adaptation Contract clause that authorizes the adaptation (an existing clause from the contract supplied below — Business-brand substitution is legal only through that authority) plus realizedByRegionIds for the preserved visual role.
No binding trait may disappear merely because it was not selected as one of the concise signature-trait labels. A missing, duplicated or unauthorized obligation is deterministic erasure and will be rejected before generation.

COVERAGE MANDATE (issue #42): aggregation must never erase the Reference. Every MAJOR measured visual mass (evidence segments of roughly a third of a viewport or more, and every image-mass band) must be claimed by a canonical region's sourceEvidenceRegionIds — or, when genuinely adapted away, be covered by an explicit Adaptation Contract entry (feature token 'mass:<segment-id>'); every binding identity trait must be covered by the trait obligation ledger above. A Blueprint that silently drops a distinct visual mass, surface change or signature component is a Blueprint defect and will be rejected before generation.

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
  const userPrompt = buildBlueprintUserPrompt({
    analysis: input.analysis,
    facts: input.facts,
    adaptationContract: input.adaptationContract,
    evidenceRegions: input.evidenceRegions,
  });
  const stageOptions: Omit<RunSchemaValidatedAiStageOptions, "userPrompt"> = {
    stage: "visual-blueprint-generator",
    schema: VisualBlueprintSchema,
    schemaVersion: VISUAL_BLUEPRINT_SCHEMA_VERSION,
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.analysisR2Key],
    temperature: 0.4,
    generate: input.generate,
  };

  // Bounded informed blueprint repair (production retest 2026-09-05; issue
  // #60 convergence contract): the engine's blind retries re-prompt
  // identically and rotate which identity carrier is sacrificed. The repair
  // below is therefore INFORMED and CONSTRAINED: it receives the rejected
  // Blueprint verbatim, the deterministic failed findings, the binding trait
  // set, and the passing preservation set (satisfied obligations, region
  // order, valid image-role assignments) which it must carry forward
  // unchanged. Exactly ONE such repair follows the initial generation; a
  // second failure is terminal and escalates BLUEPRINT_REVIEW_REQUIRED in
  // the pipeline — never another semantic redesign.
  const firstRun = await runSchemaValidatedAiStage<VisualBlueprint>(env, { ...stageOptions, userPrompt });
  const firstRejection = validateProducedBlueprint(firstRun.value, input);
  if (!firstRejection) {
    return persistBlueprint(env, input, firstRun);
  }

  const preservation = deriveBlueprintPreservationSet(firstRun.value, input);
  const bindingTraitIds = input.analysis.signatureTraits.filter((trait) => trait.identityDefining).map((trait) => trait.id);
  const repairPrompt = `${userPrompt}

## Blueprint repair directives (issue #60)
Your previously produced Blueprint — reproduced VERBATIM below — was REJECTED by deterministic validation:
- ${firstRejection.code}: ${firstRejection.message}

REJECTED BLUEPRINT (verbatim):
${JSON.stringify(firstRun.value)}

BINDING TRAITS: exactly one traitObligations disposition is required for each of ${JSON.stringify(bindingTraitIds)}.

PRESERVATION SET (binding — carry forward UNCHANGED unless a failed finding directly concerns the element):
- Satisfied trait obligations: ${JSON.stringify(preservation.satisfiedObligations)}
- Canonical region order: ${JSON.stringify(preservation.regionOrder)}
- Valid image-role assignments: ${JSON.stringify(preservation.validImageRoleAssignments)}
- Signature traits with valid analysis traces: ${JSON.stringify(preservation.tracedSignatureTraitIds)}

REPAIR SCOPE: change the smallest necessary elements — fix the failed findings and only directly related obligation/region fields. Do NOT redesign, reorder, drop or rename satisfied obligations, canonical regions or traced signature traits. The Adaptation Contract above remains the only adaptation authority. Return the COMPLETE corrected blueprint object.`;
  const repairRun = await runSchemaValidatedAiStage<VisualBlueprint>(env, { ...stageOptions, userPrompt: repairPrompt });
  const repairRejection = validateProducedBlueprint(repairRun.value, input);
  if (repairRejection) {
    // Terminal by design (issue #60 §24-25): no second semantic repair, no
    // engine retry storm. The pipeline escalates this to human review.
    throw new VisualBlueprintError(repairRejection.code, repairRejection.message);
  }
  return persistBlueprint(env, input, repairRun);
}

// The passing preservation set for the informed Blueprint repair (issue #60,
// analogous to the implementation-repair preservation principle): everything
// the rejected candidate ALREADY satisfies deterministically, which the
// repair must carry forward so a narrow fix cannot rotate identity carriers.
export interface BlueprintPreservationSet {
  satisfiedObligations: TraitObligation[];
  regionOrder: string[];
  validImageRoleAssignments: Array<{ regionId: string; imageRoleId: string }>;
  tracedSignatureTraitIds: string[];
}

export function deriveBlueprintPreservationSet(
  blueprint: VisualBlueprint,
  input: Pick<RunVisualBlueprintInput, "analysis" | "adaptationContract">
): BlueprintPreservationSet {
  const evaluation = evaluateTraitObligations(blueprint, input.analysis, input.adaptationContract);
  const imageRoleIds = new Set(blueprint.imageSystem.imageRoles.map((role) => role.id));
  return {
    satisfiedObligations: evaluation.satisfiedObligations,
    regionOrder: blueprint.homepageRegions.map((region) => region.id),
    validImageRoleAssignments: blueprint.homepageRegions
      .filter((region) => region.imageRoleId && imageRoleIds.has(region.imageRoleId))
      .map((region) => ({ regionId: region.id, imageRoleId: region.imageRoleId! })),
    tracedSignatureTraitIds: blueprint.signatureTraits
      .filter((trait) => trait.sourceTraitId && input.analysis.signatureTraits.some((a) => a.id === trait.sourceTraitId))
      .map((trait) => trait.id),
  };
}

// Runs the deterministic blueprint gates; null means the blueprint is accepted.
function validateProducedBlueprint(
  blueprint: VisualBlueprint,
  input: RunVisualBlueprintInput
): { code: "IDENTITY_ERASURE" | "REFERENCE_CONTENT_DETECTED" | "BLUEPRINT_INCONSISTENT"; message: string } | null {
  const identity = validateBlueprintIdentityPreservation(blueprint, input.analysis, input.adaptationContract);
  if (!identity.valid) {
    return { code: "IDENTITY_ERASURE", message: identity.problems.join("; ") };
  }
  const lint = lintBlueprintForReferenceContent(blueprint, { referenceUrl: input.referenceUrl });
  if (!lint.clean) {
    return { code: "REFERENCE_CONTENT_DETECTED", message: lint.findings.join("; ") };
  }
  const consistency = validateBlueprintConsistency(blueprint);
  if (!consistency.valid) {
    return { code: "BLUEPRINT_INCONSISTENT", message: consistency.problems.join("; ") };
  }
  const provenance = validateBlueprintRegionProvenance(blueprint, input.evidenceRegions);
  if (!provenance.valid) {
    return { code: "BLUEPRINT_INCONSISTENT", message: provenance.problems.join("; ") };
  }
  return null;
}

async function persistBlueprint(
  env: Env,
  input: RunVisualBlueprintInput,
  run: Awaited<ReturnType<typeof runSchemaValidatedAiStage<VisualBlueprint>>>
): Promise<VisualBlueprintProduced> {
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
