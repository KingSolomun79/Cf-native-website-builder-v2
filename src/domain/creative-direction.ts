// ORIGINAL_DESIGN product input contract (issue #24).
//
// The no-reference mode feeds Business Facts + these onboarding-level
// creative-direction inputs into the SAME SIMPLE pipeline
// (Design Blueprint → Nano Banana → Website Builder → QA → optional ONE
// Repair); only the Blueprint inputs differ. This module intentionally has no
// dependency on any design-pipeline implementation.
//
// Field policy (GO §7/§8): the immutable Onboarding Submission carries the
// human's creative intent. Use existing fields first; only add domain fields
// that are genuinely missing (preferredPalette / visualStyle / tone /
// avoidances). Absent values are absent — the absence of detailed creative
// preferences must NOT produce a bland default; the blueprint stage owns the
// deliberate choice instead.
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { BusinessFacts } from "./lifecycle-schema";

export const CreativeDirectionSchema = Type.Object(
  {
    direction: Type.String({ minLength: 1, maxLength: 4000 }),
    audience: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    conversionGoal: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    serviceEnvironment: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    /** Non-binding inspiration vocabulary; never a selector. */
    inspirationNotes: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    /** Brand/preferred colors if the human supplied them — a constraint, never a deterministic selector. */
    preferredPalette: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    /** Visual-style guidance if supplied (e.g. "editorial print feel"). */
    visualStyle: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    /** Brand tone/personality if supplied. */
    tone: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
    /** Things to avoid if supplied. */
    avoidances: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  },
  { additionalProperties: false }
);
export type CreativeDirection = Static<typeof CreativeDirectionSchema>;

export function parseCreativeDirection(raw: unknown): CreativeDirection | null {
  return Value.Check(CreativeDirectionSchema, raw) ? (raw as CreativeDirection) : null;
}

// ── Deterministic derivation (GO §8) ────────────────────────────────────────
//
// A small deterministic Creative Direction derived from the immutable
// Onboarding Submission: the submission's explicit creative fields first,
// then ordinary onboarding Business Facts where a creative field is absent
// (industry/category, audience context). NO layout choices here — hero type,
// card style or section-layout dropdowns are AI design decisions. No default
// is ever invented for an absent field.

export interface CreativeDirectionContext {
  direction: string;
  audience?: string;
  conversionGoal?: string;
  serviceEnvironment?: string;
  inspirationNotes?: string;
  preferredPalette?: string;
  visualStyle?: string;
  tone?: string;
  avoidances?: string;
  /** Industry/category context — from Business Facts, never invented. */
  industry?: string;
  businessName: string;
}

export function deriveCreativeDirection(input: {
  creativeDirection: CreativeDirection;
  facts: Pick<BusinessFacts, "businessName" | "businessType" | "idealClientProfile">;
}): CreativeDirectionContext {
  const { creativeDirection, facts } = input;
  return {
    businessName: facts.businessName,
    direction: creativeDirection.direction,
    ...(creativeDirection.audience ?? facts.idealClientProfile
      ? { audience: creativeDirection.audience ?? facts.idealClientProfile }
      : {}),
    ...(creativeDirection.conversionGoal ? { conversionGoal: creativeDirection.conversionGoal } : {}),
    ...(creativeDirection.serviceEnvironment ? { serviceEnvironment: creativeDirection.serviceEnvironment } : {}),
    ...(creativeDirection.inspirationNotes ? { inspirationNotes: creativeDirection.inspirationNotes } : {}),
    ...(creativeDirection.preferredPalette ? { preferredPalette: creativeDirection.preferredPalette } : {}),
    ...(creativeDirection.visualStyle ? { visualStyle: creativeDirection.visualStyle } : {}),
    ...(creativeDirection.tone ? { tone: creativeDirection.tone } : {}),
    ...(creativeDirection.avoidances ? { avoidances: creativeDirection.avoidances } : {}),
    ...(facts.businessType ? { industry: facts.businessType } : {}),
  };
}

/** Deterministic single-block brief for the blueprint / visual-QA prompts. */
export function renderCreativeDirectionBrief(context: CreativeDirectionContext): string {
  const lines = [
    `- Business: ${context.businessName}`,
    `- Creative direction: ${context.direction}`,
  ];
  const optional: Array<[string, string | undefined]> = [
    ["Industry/category", context.industry],
    ["Audience", context.audience],
    ["Conversion goal", context.conversionGoal],
    ["Service environment", context.serviceEnvironment],
    ["Visual-style guidance", context.visualStyle],
    ["Tone/brand personality", context.tone],
    ["Preferred palette", context.preferredPalette],
    ["Avoid", context.avoidances],
    ["Inspiration notes (non-binding, never a selector)", context.inspirationNotes],
  ];
  for (const [label, value] of optional) {
    if (value) lines.push(`- ${label}: ${value}`);
  }
  return lines.join("\n");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Provenance identity of the exact creative-direction input (GO §30):
 *  sha256 over the canonical stable serialization of the frozen field. */
export async function creativeDirectionChecksum(creativeDirection: CreativeDirection): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableStringify(creativeDirection))
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
