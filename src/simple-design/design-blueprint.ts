// SIMPLE stage 1: the Design Blueprint (spec sections 10/12/28-31).
//
// ONE multimodal schema-validated call: Reference screenshots in, ONE rich
// implementation-ready design document out. The screenshot stays the visual
// authority — the blueprint is its interpretation, never a replacement (spec
// section 26), so the builder later receives BOTH.
//
// Deterministic quality gate (spec section 30): structural checks only. The
// schema boundary already spent the ONE targeted structural repair; a
// blueprint that still fails the gate (or the schema) is a terminal stage
// error the pipeline escalates to HUMAN_REVIEW_REQUIRED. No second semantic
// generation, ever.

import type { Env } from "../env.d";
import { getObject } from "../lib/assets";
import {
  runSchemaValidatedAiStage,
  AiStageSchemaInvalidError,
  type AiProvenance,
  type AiStageAttemptRecord,
  type RawAiGenerate,
} from "../domain/ai-boundary";
import { storeBuildStageArtifactIdempotent, getBuildStageArtifact } from "../domain/stage-artifacts";
import { putImmutableObjectTolerant } from "../lib/assets";
import { buildVersionRoot } from "../domain/artifact-keys";
import {
  DESIGN_BLUEPRINT_SCHEMA_VERSION,
  DesignBlueprintSchema,
  evaluateBlueprintQualityGate,
  validateDesignBlueprint,
  type DesignBlueprint,
} from "./contracts";
import { renderDesignBlueprintMarkdown } from "./render-blueprint";
import { bytesToBase64, createSimpleVisionGenerate, mimeForKey } from "./vision";

export class SimpleDesignBlueprintError extends Error {
  constructor(readonly code: "SCHEMA_INVALID" | "QUALITY_GATE_FAILED" | "NO_VISUAL_INPUT", message: string) {
    super(message);
    this.name = "SimpleDesignBlueprintError";
  }
}

export interface SimpleBlueprintVisualInput {
  kind: string;
  artifact: string;
  sha256: string;
  width: number;
  height: number;
}

export interface RunSimpleDesignBlueprintInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  businessFactsRef: string;
  /** Replacement business context the DESIGN may adapt to — never content. */
  replacementBusiness: { name: string; type?: string; description?: string; brandPaletteHint?: string };
  referenceUrl?: string;
  /** Normalized model-facing Reference visual inputs (from frozen intake
   *  evidence). Full-page desktop first when present. */
  visualInputs: SimpleBlueprintVisualInput[];
  generate?: RawAiGenerate;
}

export interface SimpleDesignBlueprintResult {
  blueprint: DesignBlueprint;
  artifactR2Key: string;
  markdownR2Key: string;
  provenance: AiProvenance | null;
  attempts: AiStageAttemptRecord[];
}

function buildBlueprintUserPrompt(input: RunSimpleDesignBlueprintInput): string {
  const { replacementBusiness } = input;
  return `Study the attached Reference screenshots (design authority only) and produce the Design Blueprint for the REPLACEMENT business below. Describe the design, never the reference business.

REPLACEMENT BUSINESS (context for [ADAPTATION] decisions only — you receive no other business content and must not invent any):
- Name: ${replacementBusiness.name}
- Type/industry: ${replacementBusiness.type ?? "not specified — infer an appropriate framing from the reference's design language, but express it generically"}
${replacementBusiness.description ? `- Description: ${replacementBusiness.description}` : ""}
${replacementBusiness.brandPaletteHint ? `- Brand palette preference: ${replacementBusiness.brandPaletteHint} — adapt the reference accent role toward this while preserving its visual frequency; mark [ADAPTATION]` : ""}
${input.referenceUrl ? `- Reference URL (supplemental behavioral evidence): ${input.referenceUrl}` : ""}
BUSINESS FACTS POINTER (provenance only — repeat verbatim in businessFactsRef): ${input.businessFactsRef}

Prioritize the desktop full-page screenshot as the primary composition authority; use any mobile capture for the responsive spec; use detail slices for precision on typography, spacing and color values.`;
}

export async function runSimpleDesignBlueprintStage(
  env: Env,
  input: RunSimpleDesignBlueprintInput
): Promise<SimpleDesignBlueprintResult> {
  // Workflow-retry safety: the frozen blueprint IS the stage result.
  const existing = await getBuildStageArtifact<DesignBlueprint>(env, input.buildVersionId, "design_blueprint");
  if (existing) {
    return {
      blueprint: existing.value,
      artifactR2Key: existing.artifactR2Key,
      markdownR2Key: markdownKey(input.buildId, input.buildVersionNumber),
      provenance: existing.provenance,
      attempts: [],
    };
  }

  if (input.visualInputs.length === 0) {
    throw new SimpleDesignBlueprintError("NO_VISUAL_INPUT", "no Reference visual inputs available for the Design Blueprint");
  }

  // Attach up to 4 reference visuals: full-page desktop, full-page mobile,
  // then the first detail slices.
  const ordered = [
    ...input.visualInputs.filter((entry) => entry.kind === "full-page"),
    ...input.visualInputs.filter((entry) => entry.kind !== "full-page"),
  ].slice(0, 4);
  const images: Array<{ base64: string; mimeType: string }> = [];
  for (const entry of ordered) {
    const body = await getObject(env, entry.artifact);
    if (!body) continue;
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    images.push({ base64: bytesToBase64(bytes), mimeType: mimeForKey(entry.artifact) });
  }
  if (images.length === 0) {
    throw new SimpleDesignBlueprintError("NO_VISUAL_INPUT", "Reference visual inputs could not be loaded from storage");
  }

  const generate: RawAiGenerate =
    input.generate ?? createSimpleVisionGenerate(env, images, { buildId: input.buildId, stage: "simple-design-blueprint", buildVersionNumber: input.buildVersionNumber }, { maxTokens: 12288 });

  let run;
  try {
    run = await runSchemaValidatedAiStage<unknown>(env, {
      stage: "simple-design-blueprint",
      schema: DesignBlueprintSchema,
      schemaVersion: DESIGN_BLUEPRINT_SCHEMA_VERSION,
      userPrompt: buildBlueprintUserPrompt(input),
      buildId: input.buildId,
      siteGenerationId: input.siteGenerationId,
      buildVersionId: input.buildVersionId,
      buildVersionNumber: input.buildVersionNumber,
      inputArtifactIds: ordered.map((entry) => entry.sha256),
      maxTokens: 12288,
      generate,
    });
  } catch (error) {
    // The boundary already spent its ONE targeted structural repair (spec
    // section 30) — a persisting schema failure is a review escalation, not a
    // retry storm.
    if (error instanceof AiStageSchemaInvalidError) {
      throw new SimpleDesignBlueprintError("SCHEMA_INVALID", error.message);
    }
    throw error;
  }

  const validated = validateDesignBlueprint(run.value);
  if (!validated.valid) {
    throw new SimpleDesignBlueprintError("SCHEMA_INVALID", `design blueprint failed schema validation: ${validated.errors}`);
  }
  const blueprint = validated.value;

  const gate = evaluateBlueprintQualityGate(blueprint);
  if (!gate.passed) {
    throw new SimpleDesignBlueprintError(
      "QUALITY_GATE_FAILED",
      `design blueprint failed the deterministic quality gate: ${gate.failures.join("; ")}`
    );
  }

  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "design_blueprint",
    schemaVersion: DESIGN_BLUEPRINT_SCHEMA_VERSION,
    value: blueprint,
    provenance: run.provenance,
  });

  const markdownKeyFinal = markdownKey(input.buildId, input.buildVersionNumber);
  await putImmutableObjectTolerant(env, markdownKeyFinal, renderDesignBlueprintMarkdown(blueprint), {
    httpMetadata: { contentType: "text/markdown" },
  });

  return {
    blueprint,
    artifactR2Key: stored.artifactR2Key,
    markdownR2Key: markdownKeyFinal,
    provenance: run.provenance,
    attempts: run.attempts,
  };
}

function markdownKey(buildId: string, buildVersionNumber: number): string {
  return `${buildVersionRoot(buildId, buildVersionNumber)}/design-blueprint/DESIGN-BLUEPRINT.md`;
}
