// V2 ORIGINAL_DESIGN Site Generation (issue #24, PRD sections 7, 13, Phase 10).
//
// ORIGINAL_DESIGN reuses the entire downstream lifecycle — Implementation
// Contract, incremental four-page generation, two-wave images, Technical
// Preflight, standardized QA, bounded Automated Repair, Approval/Publication
// and the central form contracts — and differs ONLY in where the Visual
// Blueprint comes from: Business, audience, brand, offer/service model,
// physical/service environment, conversion goal, explicit creative direction
// and design reasoning instead of a frozen Reference. No Reference or
// Reference Evidence exists on this path. Design Archetypes are non-binding
// inspiration vocabulary only and can never deterministically select the
// design. The mode itself is locked behind the REFERENCE_BOUND proof gate
// (enforced in createInitialBuild).

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../env.d";
import { runSchemaValidatedAiStage, type RawAiGenerate } from "./ai-boundary";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { storeBuildStageArtifact, type StoredStageArtifact } from "./stage-artifacts";
import {
  VisualBlueprintSchema,
  validateBlueprintConsistency,
  type VisualBlueprint,
} from "./visual-blueprint";
import type { BusinessFacts } from "./lifecycle-schema";

export const ORIGINAL_DESIGN_BLUEPRINT_SCHEMA_VERSION = "visual-blueprint/1";

export type OriginalDesignErrorCode = "ARCHETYPE_DETERMINISM" | "BLUEPRINT_INCONSISTENT" | "ARTIFACT_ALREADY_EXISTS";

export class OriginalDesignError extends Error {
  readonly code: OriginalDesignErrorCode;

  constructor(code: OriginalDesignErrorCode, message: string) {
    super(message);
    this.name = "OriginalDesignError";
    this.code = code;
  }
}

// Explicit creative direction carried by the operator for this Site
// Generation (PRD section 7: "explicit creative direction" is an input, not
// an industry preset).
export const CreativeDirectionSchema = Type.Object(
  {
    direction: Type.String({ minLength: 1, maxLength: 4000 }),
    audience: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    conversionGoal: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    serviceEnvironment: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    /** Non-binding inspiration vocabulary; never a selector. */
    inspirationNotes: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false }
);
export type CreativeDirection = Static<typeof CreativeDirectionSchema>;

// Design Archetypes must remain inspiration vocabulary: the produced
// Blueprint may not embed deterministic industry-to-archetype selection.
// The versioned schema already has no archetype/preset field
// (additionalProperties: false); this lint additionally rejects the
// vocabulary of deterministic selection in blueprint text.
export function lintOriginalDesignForArchetypeDeterminism(blueprint: VisualBlueprint): void {
  const serialized = JSON.stringify(blueprint).toLowerCase();
  const forbidden = [
    /archetype\s*(selection|preset|rule|mapping)/,
    /industry\s*(preset|template|archetype)/,
    /style[-_ ]?key/,
    /because\s+the\s+industry\s+(is|requires)\s+(a\s+)?(fixed|standard)\s+layout/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      throw new OriginalDesignError(
        "ARCHETYPE_DETERMINISM",
        "Design Archetypes are non-binding inspiration only: the Blueprint embeds deterministic industry-to-archetype selection"
      );
    }
  }
}

export function buildOriginalDesignUserPrompt(input: {
  facts: BusinessFacts;
  creativeDirection?: CreativeDirection;
}): string {
  return `Create an ORIGINAL Visual Blueprint for THIS Business. Derive the design from the Business itself — its facts, audience, brand, offer/service model, physical/service environment, conversion goal and the explicit creative direction below — through explicit design reasoning. Produce a distinctive visual system; do NOT select any industry preset, template or archetype (any archetype vocabulary is inspiration only and must never determine the layout). Define the same binding Blueprint fields as the schema requires. Every image must be describable without the Business's competitors' assets.

BUSINESS FACTS:
${JSON.stringify(input.facts, null, 2)}${
    input.creativeDirection
      ? `

EXPLICIT CREATIVE DIRECTION:
${JSON.stringify(input.creativeDirection, null, 2)}`
      : ""

  }`;
}

export interface RunOriginalDesignBlueprintInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  facts: BusinessFacts;
  creativeDirection?: CreativeDirection;
  generate?: RawAiGenerate;
}

export async function runOriginalDesignBlueprintStage(
  env: Env,
  input: RunOriginalDesignBlueprintInput
): Promise<StoredStageArtifact & { blueprint: VisualBlueprint }> {
  if (input.creativeDirection && !Value.Check(CreativeDirectionSchema, input.creativeDirection)) {
    throw new OriginalDesignError("BLUEPRINT_INCONSISTENT", "Creative direction failed its schema");
  }

  const run = await runSchemaValidatedAiStage<VisualBlueprint>(env, {
    stage: "original-design-blueprint-generator",
    schema: VisualBlueprintSchema,
    schemaVersion: ORIGINAL_DESIGN_BLUEPRINT_SCHEMA_VERSION,
    userPrompt: buildOriginalDesignUserPrompt({ facts: input.facts, creativeDirection: input.creativeDirection }),
    buildId: input.buildId,
    siteGenerationId: input.siteGenerationId,
    buildVersionId: input.buildVersionId,
    buildVersionNumber: input.buildVersionNumber,
    temperature: 0.5,
    generate: input.generate,
  });

  lintOriginalDesignForArchetypeDeterminism(run.value);
  const consistency = validateBlueprintConsistency(run.value);
  if (!consistency.valid) {
    throw new OriginalDesignError("BLUEPRINT_INCONSISTENT", consistency.problems.join("; "));
  }

  const stored = await storeBuildStageArtifact(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "visual_blueprint",
    schemaVersion: ORIGINAL_DESIGN_BLUEPRINT_SCHEMA_VERSION,
    value: run.value,
    provenance: run.provenance,
  });

  // ORIGINAL_DESIGN skips the Reference states entirely: intake goes
  // straight to BLUEPRINT.
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "INTAKE_READY",
    toState: "BLUEPRINT",
    stage: "blueprint",
    detail: `ORIGINAL_DESIGN Visual Blueprint created from Business/audience/brand/creative inputs (${run.value.signatureTraits.length} signature traits, no Reference)`,
  });

  return { ...stored, blueprint: run.value };
}

export function parseCreativeDirection(raw: unknown): CreativeDirection | null {
  return Value.Check(CreativeDirectionSchema, raw) ? (raw as CreativeDirection) : null;
}
