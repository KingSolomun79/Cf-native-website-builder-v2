// V2 Reference Analysis stage (issue #8, PRD section 12).
//
// Interprets FROZEN Reference Evidence: describes the visual system,
// hierarchy, signature traits, likely design intent, photographic grammar,
// responsive/motion behavior and identity carriers. It cannot redesign, map
// Business content, choose implementation architecture, or fabricate
// observations: every signature trait must anchor to an evidence region or
// measured element that actually exists in the frozen package, and the
// evidence itself is never rewritten.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { getBuildStageArtifact, storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import type { ReferenceEvidence } from "./reference-evidence-schema";

export const REFERENCE_ANALYSIS_SCHEMA_VERSION = "reference-analysis/1";

const ConfidenceSchema = Type.Union([Type.Literal("HIGH"), Type.Literal("MEDIUM"), Type.Literal("LOW")]);

export const ReferenceAnalysisSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    visualSystemSummary: Type.String({ minLength: 1, maxLength: 4000 }),
    hierarchy: Type.Array(
      Type.Object({
        level: Type.String({ minLength: 1, maxLength: 120 }),
        description: Type.String({ minLength: 1, maxLength: 2000 }),
        confidence: ConfidenceSchema,
      }),
      { minItems: 1 }
    ),
    signatureTraits: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1, maxLength: 120 }),
        description: Type.String({ minLength: 1, maxLength: 2000 }),
        identityDefining: Type.Boolean(),
        evidenceRefs: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      }),
      { minItems: 1 }
    ),
    designIntent: Type.Array(
      Type.Object({ hypothesis: Type.String({ minLength: 1, maxLength: 2000 }), confidence: ConfidenceSchema }),
      { minItems: 1 }
    ),
    photographicGrammar: Type.Object({
      summary: Type.String({ minLength: 1, maxLength: 4000 }),
      imageRoles: Type.Array(Type.String({ minLength: 1 }), { minItems: 0 }),
    }),
    responsiveBehavior: Type.Array(Type.String({ minLength: 1, maxLength: 1000 })),
    motionBehavior: Type.Array(Type.String({ minLength: 1, maxLength: 1000 })),
    identityCarriers: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1 }),
  },
  { additionalProperties: false }
);
export type ReferenceAnalysis = Static<typeof ReferenceAnalysisSchema>;

export class ReferenceAnalysisError extends Error {
  readonly code: "EVIDENCE_FABRICATION" | "ARTIFACT_ALREADY_EXISTS";

  constructor(code: ReferenceAnalysisError["code"], message: string) {
    super(message);
    this.name = "ReferenceAnalysisError";
    this.code = code;
  }
}

// Deterministic evidence-anchor check: every evidenceRef of every signature
// trait must resolve to a real region id or measured-element selectorHint in
// the frozen evidence. This is the mechanical half of "cannot fabricate
// observations".
export function validateAnalysisAgainstEvidence(
  analysis: ReferenceAnalysis,
  evidence: ReferenceEvidence
): { valid: true } | { valid: false; dangling: string[] } {
  const anchors = new Set<string>([
    ...evidence.regions.map((region) => region.id),
    ...evidence.measuredElements.map((element) => element.selectorHint ?? element.role ?? "").filter(Boolean),
  ]);
  // Models also qualify an anchor by the measured value it points at
  // ("computed.pixelWidth:1440"). Those forms are deterministic projections
  // of the frozen evidence, so accept them verbatim.
  for (const element of evidence.measuredElements) {
    const identity = element.selectorHint ?? element.role ?? "";
    if (!identity || !element.computed) continue;
    for (const [key, value] of Object.entries(element.computed)) {
      if (value === null || value === undefined) continue;
      anchors.add(`computed.${key}:${value}`);
      anchors.add(`${identity}.computed.${key}:${value}`);
    }
  }
  const dangling: string[] = [];
  for (const trait of analysis.signatureTraits) {
    for (const ref of trait.evidenceRefs) {
      // Models qualify anchors with the field they came from
      // ("selectorHint:screenshot"); strip that deterministic prefix before
      // matching against the frozen anchor set.
      const normalized = ref
        .replace(/^(selectorHint|role|region):/i, "")
        .replace(/^measuredElements\[(selectorHint|role)=['"]([^'"]+)['"]\]$/i, "$2");
      if (!anchors.has(normalized)) dangling.push(`${trait.id} -> ${ref}`);
    }
  }
  return dangling.length === 0 ? { valid: true } : { valid: false, dangling };
}

// Bounded evidence payload for the model: measurements and observations only,
// never loose browser dumps or screenshot bytes.
export function buildAnalysisUserPrompt(evidence: ReferenceEvidence): string {
  const anchorIds = [
    ...evidence.regions.map((region) => region.id),
    ...evidence.measuredElements.map((element) => element.selectorHint ?? element.role ?? "").filter(Boolean),
  ];
  return `Interpret the frozen versioned Reference Evidence below. Describe the visual system, hierarchy, signature traits, likely design intent, photographic grammar, responsive and motion behavior, and what carries visual identity. Anchor every signature trait to real evidence ids. Use EXACTLY these anchor strings in evidenceRefs (no prefixes, no qualifiers, no other notation): ${JSON.stringify(anchorIds)}. Do NOT redesign, do NOT map Business content, do NOT invent observations.

REFERENCE EVIDENCE (version ${evidence.version}):
${JSON.stringify(
  {
    screenshotMetadata: evidence.screenshotMetadata,
    captures: evidence.captures.map((capture) => capture.viewportWidth),
    regions: evidence.regions,
    measuredElements: evidence.measuredElements,
    responsiveObservations: evidence.responsiveObservations,
    motionObservations: evidence.motionObservations,
    discrepancies: evidence.discrepancies,
  },
  null,
  2
)}`;
}

export interface RunReferenceAnalysisInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  evidence: ReferenceEvidence;
  evidenceR2Key: string;
  generate?: RawAiGenerate;
}

export interface ReferenceAnalysisProduced extends StoredStageArtifact {
  analysis: ReferenceAnalysis;
}

export async function runReferenceAnalysisStage(
  env: Env,
  input: RunReferenceAnalysisInput
): Promise<ReferenceAnalysisProduced> {
  const run = await runSchemaValidatedAiStage<ReferenceAnalysis>(env, {
    stage: "reference-analyzer",
    schema: ReferenceAnalysisSchema,
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    userPrompt: buildAnalysisUserPrompt(input.evidence),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [input.evidenceR2Key],
    temperature: 0.3,
    generate: input.generate,
  });

  const anchored = validateAnalysisAgainstEvidence(run.value, input.evidence);
  if (!anchored.valid) {
    throw new ReferenceAnalysisError(
      "EVIDENCE_FABRICATION",
      `Reference Analysis anchors signature traits to evidence that does not exist: ${anchored.dangling.slice(0, 5).join(", ")}`
    );
  }

  const stored = await storeBuildStageArtifact(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "reference_analysis",
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    value: run.value,
    provenance: run.provenance,
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "REFERENCE_EVIDENCE",
    toState: "REFERENCE_ANALYSIS",
    stage: "reference_analysis",
    detail: `Reference Analysis produced (${run.value.signatureTraits.length} signature traits anchored to frozen evidence)`,
  });

  return { ...stored, analysis: run.value };
}

export function parseReferenceAnalysis(raw: unknown): ReferenceAnalysis | null {
  return Value.Check(ReferenceAnalysisSchema, raw) ? (raw as ReferenceAnalysis) : null;
}
