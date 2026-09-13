// V2 domain lifecycle schemas (issue #4, PRD Phase 1).
//
// Schema-as-code like blueprint-schema-v2.ts: one TypeBox source provides
// runtime validation and derives the TypeScript types. These are the input
// contracts for the Onboarding Submission -> Site Generation -> Build ->
// Build Version lifecycle. Terminology follows CONTEXT.md exactly; there is
// deliberately no Client Account / Client User / Client Profile shape here.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { AdaptationContractSchema } from "./reference-evidence-schema";
import { CreativeDirectionSchema, type CreativeDirection } from "./creative-direction";

// The creative-direction input contract is part of the Onboarding Submission
// payload surface (ORIGINAL_DESIGN); re-exported here so consumers of the
// lifecycle schemas see one coherent contract module.
export type { CreativeDirection };

export const ONBOARDING_SUBMISSION_SCHEMA_VERSION = 1;

export const BuildModeSchema = Type.Union([
  Type.Literal("REFERENCE_BOUND"),
  Type.Literal("ORIGINAL_DESIGN"),
]);
export type BuildMode = Static<typeof BuildModeSchema>;

// Canonical workflow states (PRD section 23). BLUEPRINT_REVIEW_REQUIRED is an
// escalation signal, not a state.
export const BUILD_LIFECYCLE_STATES = [
  "INTAKE_READY",
  "REFERENCE_CHECK",
  "REFERENCE_EVIDENCE",
  "REFERENCE_ANALYSIS",
  "BLUEPRINT",
  "IMPLEMENTATION_PLAN",
  "SITE_GENERATION",
  "SITE_VALIDATION",
  "IMAGE_WAVE_1",
  "IMAGE_WAVE_2",
  "ASSET_PERSISTENCE",
  "ASSEMBLY",
  "TECHNICAL_PREFLIGHT",
  "PREVIEW",
  "QA_EVIDENCE",
  "QA",
  "FIX",
  "CONFIRMATION",
  "RELEASE_BLOCKER_FIX",
  "RELEASE_READY",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "DEGRADED",
  "FAILED",
  "HUMAN_REVIEW_REQUIRED",
] as const;
export type BuildLifecycleState = (typeof BUILD_LIFECYCLE_STATES)[number];

const optionalTrimmedString = (maxLength: number) =>
  Type.Optional(Type.String({ minLength: 1, maxLength }));

// Reference input for a REFERENCE_BOUND Site Generation. A Reference consists
// of a Reference Screenshot, a Reference URL, or both (CONTEXT.md). Deep
// suitability/evidence validation is the Reference intake stage (issue #7);
// here we only pin the shape.
//
// adaptationContract (production retest 2026-09-05): the concrete
// human-authored Adaptation Contract demanded by PRD section 10 for
// SUPPORTED_WITH_LIMITATIONS References rides the immutable Onboarding
// Submission — capture-observed limitations (e.g. heavy_parallax) are declared
// and legalized here, before any Build exists. Intake re-validates it against
// the frozen suitability decision.
export const ReferenceInputSchema = Type.Object(
  {
    screenshotR2Key: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    url: Type.Optional(Type.String({ pattern: "^https?://", maxLength: 2048 })),
    adaptationContract: Type.Optional(AdaptationContractSchema),
  },
  { additionalProperties: false }
);
export type ReferenceInput = Static<typeof ReferenceInputSchema>;

// ── Canonical Business Facts: services / business hours / differentiator ────
//
// Operator GO 2026-09-12 (client intake layer): the public client intake
// collects these three facts and they become CONTENT AUTHORITY for BOTH Build
// Modes. 24-hour HH:MM is the canonical storage — display formatting is a
// frontend concern and is never stored as source truth.

export const HH_MM_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

const ServiceItemSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  },
  { additionalProperties: false }
);
export type ServiceItem = Static<typeof ServiceItemSchema>;

// A service list carries at least 3 service names (the four-page site's
// Services page has no content without them) and a suggested maximum of 20 —
// the hard cap keeps one public form from flooding the content authority.
export const SERVICES_MIN_ITEMS = 3;
export const SERVICES_MAX_ITEMS = 20;

export const BusinessHourDaySchema = Type.Union(
  [
    Type.Object({ status: Type.Literal("CLOSED") }, { additionalProperties: false }),
    Type.Object(
      {
        status: Type.Literal("OPEN"),
        open: Type.String({ pattern: HH_MM_PATTERN }),
        close: Type.String({ pattern: HH_MM_PATTERN }),
      },
      { additionalProperties: false }
    ),
  ],
  { additionalProperties: false }
);
export type BusinessHourDay = Static<typeof BusinessHourDaySchema>;

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const BusinessHoursSchema = Type.Object(
  {
    monday: BusinessHourDaySchema,
    tuesday: BusinessHourDaySchema,
    wednesday: BusinessHourDaySchema,
    thursday: BusinessHourDaySchema,
    friday: BusinessHourDaySchema,
    saturday: BusinessHourDaySchema,
    sunday: BusinessHourDaySchema,
  },
  { additionalProperties: false }
);
export type BusinessHours = Static<typeof BusinessHoursSchema>;

export const ServicesSchema = Type.Array(ServiceItemSchema, {
  minItems: SERVICES_MIN_ITEMS,
  maxItems: SERVICES_MAX_ITEMS,
});
export type Services = Static<typeof ServicesSchema>;

export const BusinessFactsSchema = Type.Object(
  {
    businessName: Type.String({ minLength: 1, maxLength: 200 }),
    contactEmail: Type.String({ pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", maxLength: 320 }),
    businessType: optionalTrimmedString(200),
    businessDescription: optionalTrimmedString(5000),
    idealClientProfile: optionalTrimmedString(2000),
    addressLine1: optionalTrimmedString(300),
    city: optionalTrimmedString(120),
    country: optionalTrimmedString(120),
    phoneNumber: optionalTrimmedString(60),
    whatsappNumber: optionalTrimmedString(60),
    logoUrl: Type.Optional(Type.String({ pattern: "^https?://", maxLength: 2048 })),
    socials: Type.Optional(
      Type.Object(
        {
          facebook: optionalTrimmedString(2048),
          instagram: optionalTrimmedString(2048),
          twitter: optionalTrimmedString(2048),
          linkedin: optionalTrimmedString(2048),
          other: optionalTrimmedString(2048),
        },
        { additionalProperties: false }
      )
    ),
    extraInformation: optionalTrimmedString(5000),
    // REQUIRED content authority: at least three real service names supplied by
    // the business. Missing services are never invented (intake semantics).
    services: ServicesSchema,
    // REQUIRED content authority: all seven days, CLOSED or an explicit OPEN
    // window. OPEN intervals MAY cross midnight — the open/close order is
    // never compared (public contract 2026-09-12); the canonical HH:MM pair
    // is stored exactly as supplied.
    businessHours: BusinessHoursSchema,
    // OPTIONAL human-supplied positioning text ("what sets you apart"). Absent
    // stays absent — never fabricated.
    competitiveDifferentiator: optionalTrimmedString(2000),
  },
  { additionalProperties: false }
);
export type BusinessFacts = Static<typeof BusinessFactsSchema>;

export const OnboardingSubmissionPayloadSchema = Type.Object(
  {
    buildMode: BuildModeSchema,
    facts: BusinessFactsSchema,
    reference: Type.Optional(ReferenceInputSchema),
    // ORIGINAL_DESIGN only: the human creative intent the Blueprint invents
    // from. Validated per-mode below — a design-origin input may never leak
    // across modes (changing Build Mode starts a new Site Generation).
    creativeDirection: Type.Optional(CreativeDirectionSchema),
  },
  { additionalProperties: false }
);
export type OnboardingSubmissionPayload = Static<typeof OnboardingSubmissionPayloadSchema>;

export interface SubmissionValidationIssue {
  path: string;
  message: string;
}

// Semantic rules the TypeBox shape cannot express: no duplicate service names.
// Business hours deliberately carry NO ordering rule — an OPEN interval MAY
// cross midnight (18:00→02:00 is valid); both times need only be canonical
// 24-hour HH:MM (pattern-enforced in the schema above). Shared by canonical
// intake, the public Draft and Fact Update application so every path
// validates identically.
export function validateBusinessFactsSemantics(facts: BusinessFacts): SubmissionValidationIssue[] {
  const issues: SubmissionValidationIssue[] = [];
  const seen = new Set<string>();
  for (const [index, service] of (facts.services ?? []).entries()) {
    const key = service.name.trim().toLowerCase();
    if (seen.has(key)) {
      issues.push({
        path: `$.facts.services[${index}].name`,
        message: `duplicate service name '${service.name.trim()}'`,
      });
    }
    seen.add(key);
  }
  return issues;
}

export function validateOnboardingSubmissionPayload(
  payload: unknown
): { valid: true; value: OnboardingSubmissionPayload } | { valid: false; issues: SubmissionValidationIssue[] } {
  if (typeof payload !== "object" || payload === null) {
    return { valid: false, issues: [{ path: "$", message: "submission payload must be an object" }] };
  }
  if (!Value.Check(OnboardingSubmissionPayloadSchema, payload)) {
    const issues: SubmissionValidationIssue[] = [];
    for (const error of Value.Errors(OnboardingSubmissionPayloadSchema, payload)) {
      issues.push({ path: error.path, message: error.message });
      if (issues.length >= 10) break;
    }
    return { valid: false, issues };
  }
  const value = payload as OnboardingSubmissionPayload;

  // New canonical Business Facts semantics (services / business hours /
  // differentiator) — the same rules the Fact Update path enforces on merged
  // snapshots.
  const semanticIssues = validateBusinessFactsSemantics(value.facts);
  if (semanticIssues.length > 0) return { valid: false, issues: semanticIssues };

  // A REFERENCE_BOUND Site Generation must carry a design origin: a Reference
  // Screenshot, a Reference URL, or both. URL-only input becomes valid only
  // after canonical screenshot/evidence capture (issue #7 enforces the freeze;
  // the presence requirement lives here).
  if (value.buildMode === "REFERENCE_BOUND") {
    const hasScreenshot = typeof value.reference?.screenshotR2Key === "string" && value.reference.screenshotR2Key.length > 0;
    const hasUrl = typeof value.reference?.url === "string" && value.reference.url.length > 0;
    if (!hasScreenshot && !hasUrl) {
      return {
        valid: false,
        issues: [
          {
            path: "$.reference",
            message: "REFERENCE_BOUND submissions require a reference screenshot, a reference URL, or both",
          },
        ],
      };
    }
    if (value.creativeDirection) {
      return {
        valid: false,
        issues: [
          {
            path: "$.creativeDirection",
            message:
              "REFERENCE_BOUND submissions must not carry creativeDirection — the Reference is the design origin; changing Build Mode starts a new Site Generation",
          },
        ],
      };
    }
  }

  // ORIGINAL_DESIGN has NO Reference design authority: the design origin is
  // Business Facts + the immutable submission + Creative Direction (GO §6).
  // Supplied Reference input is rejected outright so the mode can never
  // accidentally behave as Reference-bound, and the creative direction is
  // REQUIRED — it is the design-intent authority.
  if (value.buildMode === "ORIGINAL_DESIGN") {
    const issues: SubmissionValidationIssue[] = [];
    if (value.reference) {
      issues.push({
        path: "$.reference",
        message: "ORIGINAL_DESIGN submissions must not carry a Reference — there is no Reference design authority in this mode",
      });
    }
    if (!value.creativeDirection) {
      issues.push({
        path: "$.creativeDirection",
        message: "ORIGINAL_DESIGN submissions require creativeDirection — the explicit design-intent authority",
      });
    }
    if (issues.length > 0) return { valid: false, issues };
  }

  return { valid: true, value };
}

// Deterministic normalization applied before the fact snapshot is frozen:
// trims strings and drops emptied optional facts so the snapshot only carries
// supported claims.
export function normalizeBusinessFacts(facts: BusinessFacts): BusinessFacts {
  const trimmed = <T extends string | undefined>(value: T): T | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? (trimmedValue as T) : undefined;
  };
  const normalized = {} as BusinessFacts;
  normalized.businessName = facts.businessName.trim();
  normalized.contactEmail = facts.contactEmail.trim();
  const singles = [
    "businessType",
    "businessDescription",
    "idealClientProfile",
    "addressLine1",
    "city",
    "country",
    "phoneNumber",
    "whatsappNumber",
    "logoUrl",
    "extraInformation",
  ] as const;
  for (const key of singles) {
    const value = trimmed(facts[key]);
    if (value !== undefined) normalized[key] = value;
  }
  if (facts.socials) {
    const socials: NonNullable<BusinessFacts["socials"]> = {};
    for (const key of ["facebook", "instagram", "twitter", "linkedin", "other"] as const) {
      const value = trimmed(facts.socials[key]);
      if (value !== undefined) socials[key] = value;
    }
    if (Object.keys(socials).length > 0) normalized.socials = socials;
  }
  // Canonical structured facts: trim names/descriptions, drop emptied
  // descriptions, keep canonical 24-hour windows exactly as supplied (they are
  // already pattern-validated; storage is canonical, never display-formatted).
  if (facts.services) {
    normalized.services = facts.services.map((service) => {
      const name = service.name.trim();
      const description = trimmed(service.description);
      return description ? { name, description } : { name };
    });
  }
  if (facts.businessHours) {
    normalized.businessHours = { ...facts.businessHours };
  }
  const differentiator = trimmed(facts.competitiveDifferentiator);
  if (differentiator !== undefined) normalized.competitiveDifferentiator = differentiator;
  return normalized;
}
