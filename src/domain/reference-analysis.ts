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
import { getObject } from "../lib/assets";
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
  readonly code: "EVIDENCE_FABRICATION" | "ARTIFACT_ALREADY_EXISTS" | "VISION_INPUT_UNAVAILABLE";

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
// never loose browser dumps or raw screenshot bytes. When the Reference
// Visual Package carries normalized visual inputs (issue #42), the payload
// declares them and the ANALYSIS prompt instructs the model to interpret the
// ATTACHED image together with — never instead of — the measured evidence.
export function buildAnalysisUserPrompt(
  evidence: ReferenceEvidence,
  visualInputs?: NonNullable<ReferenceEvidence["visualInputs"]>
): string {
  const anchorIds = [
    ...evidence.regions.map((region) => region.id),
    ...evidence.measuredElements.map((element) => element.selectorHint ?? element.role ?? "").filter(Boolean),
  ];
  const visualSection = visualInputs?.length
    ? `\n\nVISUAL PACKAGE ATTACHED (normalized rendering of the canonical Reference Screenshot — issue #42): ${JSON.stringify(
        visualInputs.map((input) => ({ kind: input.kind, width: input.width, height: input.height, sha256: input.sha256 }))
      )}. Interpret this image TOGETHER WITH the measured evidence below: the image is visual context for hierarchy, composition, surface system, component language and photographic grammar; the JSON evidence remains the authority for every MEASURED fact. Never invent measurements from the image; anchor every signature trait to the evidence anchor strings.`
    : "";
  return `Interpret the frozen versioned Reference Evidence below. Describe the visual system, hierarchy, signature traits, likely design intent, photographic grammar, responsive and motion behavior, and what carries visual identity. Anchor every signature trait to real evidence ids. Use EXACTLY these anchor strings in evidenceRefs (no prefixes, no qualifiers, no other notation): ${JSON.stringify(anchorIds)}. Do NOT redesign, do NOT map Business content, do NOT invent observations.${visualSection}

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
      extraction: evidence.extraction ?? null,
      visualInputs: evidence.visualInputs ?? null,
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
  /** Normalized visual inputs from the Reference Visual Package (issue #42).
   *  When present, the analyzer runs MULTIMODALLY: the primary visual input
   *  is attached to the analysis call through the vision path. */
  visualInputs?: NonNullable<ReferenceEvidence["visualInputs"]>;
  /** Multimodal generate seam (issue #42). Defaults to the production vision
   *  adapter when visual inputs exist; tests may inject a deterministic
   *  fake. The plain `generate` seam stays the text-only path for evidence
   *  without visual inputs. */
  visionGenerate?: RawAiGenerate;
}

export interface ReferenceAnalysisProduced extends StoredStageArtifact {
  analysis: ReferenceAnalysis;
}

// Production multimodal call: reads the primary normalized visual input from
// R2, base64-encodes it, and routes through the vision gateway (canonical
// model policy — glm-5.3-flash serves vision through the configured provider;
// no separate legacy vision model). The system prompt is folded into the
// user message: the vision path sends a single multimodal user turn.
export function createProductionVisionGenerate(
  env: Env,
  visualInputs: NonNullable<ReferenceEvidence["visualInputs"]>,
  deps: { gateway?: typeof import("../lib/ai-gateway").generateVisionWithGateway } = {}
): RawAiGenerate {
  return async (systemPrompt, userPrompt) => {
    const primary =
      visualInputs.find((input) => input.kind === "full-page") ?? visualInputs[0];
    const body = await getObject(env, primary.artifact);
    if (!body) {
      throw new ReferenceAnalysisError(
        "VISION_INPUT_UNAVAILABLE",
        `Visual input ${primary.artifact} is missing from storage; the analyzer refuses to run blind`
      );
    }
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const base64 = btoa(binary);
    const { generateVisionWithGateway } = await import("../lib/ai-gateway");
    const result = await (deps.gateway ?? generateVisionWithGateway)(
      env,
      base64,
      "image/png",
      `${systemPrompt}\n\n${userPrompt}`,
      {
        job_id: `analysis-${primary.sha256.slice(0, 12)}`,
        site_id: "reference-analysis",
        stage: "reference-analyzer",
      },
      { stage: "reference-analyzer", maxTokens: 4096 }
    );
    return { content: result.content, provider: result.provider, model: result.model };
  };
}

export async function runReferenceAnalysisStage(
  env: Env,
  input: RunReferenceAnalysisInput
): Promise<ReferenceAnalysisProduced> {
  // Multimodal when visual inputs exist (issue #42): production uses the
  // vision adapter; an injected visionGenerate wins for tests. Without
  // visual inputs (undecodable screenshot, legacy evidence) the analyzer
  // stays text-only over the measured evidence — no silent image Pretense.
  const visualInputs = input.visualInputs ?? input.evidence.visualInputs;
  const generate =
    input.visionGenerate ??
    (visualInputs && visualInputs.length > 0 ? createProductionVisionGenerate(env, visualInputs) : input.generate);

  const run = await runSchemaValidatedAiStage<ReferenceAnalysis>(env, {
    stage: "reference-analyzer",
    schema: ReferenceAnalysisSchema,
    schemaVersion: REFERENCE_ANALYSIS_SCHEMA_VERSION,
    userPrompt: buildAnalysisUserPrompt(input.evidence, visualInputs),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    inputArtifactIds: [
      input.evidenceR2Key,
      ...(visualInputs ?? []).map((input) => input.artifact),
    ],
    temperature: 0.3,
    generate,
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
