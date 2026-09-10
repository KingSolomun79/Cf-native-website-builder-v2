// ORIGINAL_DESIGN product input contract — preserved for the deferred SIMPLE
// implementation (operator decision, 2026-09-10).
//
// The future no-reference mode feeds Business Facts + these onboarding-level
// creative-direction inputs into the SAME SIMPLE pipeline
// (Design Blueprint → Nano Banana → Website Builder → QA → optional ONE
// Repair); only the Blueprint inputs differ. This module intentionally has no
// dependency on any design-pipeline implementation.
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

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

export function parseCreativeDirection(raw: unknown): CreativeDirection | null {
  return Value.Check(CreativeDirectionSchema, raw) ? (raw as CreativeDirection) : null;
}
