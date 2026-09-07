// V2 Reference Evidence schemas + deterministic Suitability classification
// (issue #7, PRD sections 9-11).
//
// Reference Evidence records observations and measurements BEFORE
// interpretation and is frozen immutably per Site Generation. Reference
// Screenshot is authoritative for static composition; Reference URL evidence
// supplements runtime/interaction/responsive behavior. Reference content,
// branding, trademarks and imagery are never promoted into Business Facts —
// these shapes carry no Business-fact fields by construction.

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const REFERENCE_EVIDENCE_VERSION = "2";
export const ADAPTATION_CONTRACT_VERSION = "1";

// Parses a stored evidence JSON document and returns it only when it still
// satisfies the versioned schema (read-side guard for frozen artifacts).
export function adaptIfValid(raw: unknown): ReferenceEvidence | null {
  return Value.Check(ReferenceEvidenceSchema, raw) ? (raw as ReferenceEvidence) : null;
}

const BoundsSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number(),
  height: Type.Number(),
});

// PRD section 11 minimum versioned schema.
export const ReferenceEvidenceSchema = Type.Object(
  {
  version: Type.String({ minLength: 1 }),
  referenceUrl: Type.Optional(Type.String({ minLength: 1 })),
  screenshotId: Type.String({ minLength: 1 }),
  // Issue #65: the page's scrollY at the moment the DOM region bounds were
  // measured. Region bounding boxes from getBoundingClientRect are
  // viewport-relative; page-space normalization adds this offset. Evidence
  // captured before #65 lacks the field and is normalized through the
  // deterministic recovery transform in reference-geometry.ts instead.
  captureScrollY: Type.Optional(Type.Number({ minimum: 0 })),
    screenshotMetadata: Type.Object(
      {
        pixelWidth: Type.Optional(Type.Number()),
        pixelHeight: Type.Optional(Type.Number()),
        likelyCssViewportWidth: Type.Optional(Type.Number()),
        devicePixelRatio: Type.Optional(Type.Number()),
      },
      { additionalProperties: false }
    ),
    captures: Type.Array(
      Type.Object(
        {
          viewportWidth: Type.Number(),
          viewportHeight: Type.Optional(Type.Number()),
          screenshotArtifact: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false }
      )
    ),
    regions: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1 }),
          startY: Type.Optional(Type.Number()),
          endY: Type.Optional(Type.Number()),
          height: Type.Optional(Type.Number()),
          viewportHeightRatio: Type.Optional(Type.Number()),
          boundingBox: Type.Optional(BoundsSchema),
        },
        { additionalProperties: false }
      )
    ),
    measuredElements: Type.Array(
      Type.Object(
        {
          selectorHint: Type.Optional(Type.String()),
          role: Type.Optional(Type.String()),
          boundingBox: Type.Optional(BoundsSchema),
          computed: Type.Optional(
            Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]))
          ),
          confidence: Type.Union([Type.Literal("HIGH"), Type.Literal("MEDIUM"), Type.Literal("LOW")]),
          source: Type.Union([
            Type.Literal("DOM"),
            Type.Literal("COMPUTED_STYLE"),
            Type.Literal("SCREENSHOT"),
            Type.Literal("BROWSER_INTERACTION"),
          ]),
        },
        { additionalProperties: false }
      )
    ),
    responsiveObservations: Type.Array(Type.Unknown()),
    motionObservations: Type.Array(Type.Unknown()),
    discrepancies: Type.Array(Type.Unknown()),
    // Issue #41 — deterministic screenshot-derived evidence channel. Optional:
    // v1 packages (and URL captures before #41) predate it and stay valid.
    extraction: Type.Optional(
      Type.Object(
        {
          version: Type.String({ minLength: 1 }),
          extractor: Type.String({ minLength: 1 }),
          sourceArtifact: Type.String({ minLength: 1 }),
          sourceSha256: Type.String({ minLength: 1 }),
          coverage: Type.Union([
            Type.Object(
              {
                decoded: Type.Literal(true),
                width: Type.Number(),
                height: Type.Number(),
                sampledWidth: Type.Number(),
              },
              { additionalProperties: false }
            ),
            Type.Object({ decoded: Type.Literal(false), reason: Type.String() }, { additionalProperties: false }),
          ]),
          bands: Type.Array(
            Type.Object(
              {
                id: Type.String({ minLength: 1 }),
                startY: Type.Number(),
                endY: Type.Number(),
                height: Type.Number(),
                viewportHeightRatio: Type.Number(),
                dominantColour: Type.String(),
                luminance: Type.Number(),
                inkDensity: Type.Number(),
                bandClass: Type.Union([
                  Type.Literal("surface"),
                  Type.Literal("content"),
                  Type.Literal("image-mass"),
                ]),
              },
              { additionalProperties: false }
            )
          ),
          imageMasses: Type.Array(
            Type.Object(
              {
                boundingBox: BoundsSchema,
                density: Type.Number(),
              },
              { additionalProperties: false }
            )
          ),
          surfaceSequence: Type.Array(Type.String()),
          containerWidthRatio: Type.Union([Type.Number(), Type.Null()]),
          colourRoles: Type.Object(
            {
              background: Type.Union([Type.String(), Type.Null()]),
              accents: Type.Array(Type.String()),
            },
            { additionalProperties: false }
          ),
          imageMassRatio: Type.Union([Type.Number(), Type.Null()]),
        },
        { additionalProperties: false }
      )
    ),
    // Issue #41 — normalized model-consumable visual inputs (the Reference
    // Visual Package's model-facing artifacts). Deterministic downscales and,
    // for very tall pages, ordered vertical slices; slicing preserves spatial
    // meaning (composition is never rearranged). Hashes bind them to the
    // canonical screenshot provenance.
    visualInputs: Type.Optional(
      Type.Array(
        Type.Object(
          {
            kind: Type.Union([Type.Literal("full-page"), Type.Literal("slice")]),
            artifact: Type.String({ minLength: 1 }),
            sha256: Type.String({ minLength: 1 }),
            width: Type.Number(),
            height: Type.Number(),
            sliceIndex: Type.Optional(Type.Number()),
          },
          { additionalProperties: false }
        )
      )
    ),
  },
  { additionalProperties: false }
);
export type ReferenceEvidence = Static<typeof ReferenceEvidenceSchema>;

// PRD section 10. A concrete Adaptation Contract is required before
// generation continues for SUPPORTED_WITH_LIMITATIONS References.
export const AdaptationContractSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    unsupportedFeatures: Type.Array(
      Type.Object({ feature: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 1 }) }),
      { minItems: 1 }
    ),
    acceptedApproximations: Type.Array(
      Type.Object({ replaces: Type.String({ minLength: 1 }), substituteOutcome: Type.String({ minLength: 1 }) })
    ),
    qaExceptions: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false }
);
export type AdaptationContract = Static<typeof AdaptationContractSchema>;

export type ReferenceSuitability = "SUPPORTED" | "SUPPORTED_WITH_LIMITATIONS" | "UNSUPPORTED";

// Deterministic capability signals extracted by capture/analysis before any
// AI interpretation (PRD section 10: deterministic checks first).
export interface SuitabilitySignal {
  feature: string;
  /** true when the feature carries the Reference's visual identity. */
  identityDefining: boolean;
  reason: string;
  /** 'unsupported' fails the capability envelope; 'limitation' is adaptable. */
  level: "unsupported" | "limitation";
}

export interface SuitabilityDecision {
  suitability: ReferenceSuitability;
  signals: SuitabilitySignal[];
  reasons: string[];
}

// Deterministic classification: identity-defining or unsupported signals make
// the Reference UNSUPPORTED (an Adaptation Contract cannot legalize removing
// an identity-defining feature); adaptable limitations make it
// SUPPORTED_WITH_LIMITATIONS; otherwise SUPPORTED.
export function classifyReferenceSuitability(signals: SuitabilitySignal[]): SuitabilityDecision {
  const reasons = signals.map((signal) => `${signal.feature}: ${signal.reason}`);
  if (signals.some((signal) => signal.level === "unsupported" || signal.identityDefining)) {
    return { suitability: "UNSUPPORTED", signals, reasons };
  }
  if (signals.length > 0) {
    return { suitability: "SUPPORTED_WITH_LIMITATIONS", signals, reasons };
  }
  return { suitability: "SUPPORTED", signals, reasons: [] };
}

// A concrete Adaptation Contract must cover every adaptable limitation before
// generation may continue.
export function validateAdaptationContract(
  contract: AdaptationContract,
  decision: SuitabilityDecision
): { valid: true } | { valid: false; uncovered: string[] } {
  if (decision.suitability === "UNSUPPORTED") {
    return { valid: false, uncovered: decision.signals.map((signal) => signal.feature) };
  }
  if (decision.suitability === "SUPPORTED") {
    return { valid: true };
  }
  const covered = new Set<string>([
    ...contract.unsupportedFeatures.map((entry) => entry.feature),
    ...contract.acceptedApproximations.map((entry) => entry.replaces),
  ]);
  const uncovered = decision.signals
    .map((signal) => signal.feature)
    .filter((feature) => !covered.has(feature));
  return uncovered.length === 0 ? { valid: true } : { valid: false, uncovered };
}

// Deterministic signal derivation from structured observations emitted by the
// capture step. Observations are tagged records, never free-form AI text.
export interface StructuredObservation {
  kind: string;
  identityDefining?: boolean;
  detail?: string;
}

const UNSUPPORTED_KINDS: Record<string, string> = {
  canvas_webgl_primary: "canvas/WebGL/Three.js is the primary experience",
  authenticated_behavior: "application/authenticated behavior dominates",
  dominant_video: "dominant video dependence",
  extreme_scroll_jacking: "extreme scroll-jacking",
  complex_stateful_interaction: "complex stateful interaction",
  unsupported_scale: "page/product scale outside capability envelope",
};

const LIMITATION_KINDS: Record<string, string> = {
  custom_cursor: "custom cursor behavior",
  complex_slider: "complex specialized slider/carousel",
  heavy_parallax: "heavy parallax choreography",
  exotic_typography: "proprietary/unavailable reference font (REFERENCE_FONT_UNAVAILABLE)",
  // Issue #40: the page's static composition changed materially under real
  // scrolling (scroll-transform/smooth-scroll layout). Checkpoint captures
  // carry the truth; the flattening limitation must be declared, not hidden.
  unreliable_scroll_flattening: "static flattening unreliable under scroll (scroll-transform layout); viewport checkpoints are the composition authority",
};

export function deriveSuitabilitySignals(observations: StructuredObservation[]): SuitabilitySignal[] {
  const signals: SuitabilitySignal[] = [];
  for (const observation of observations) {
    if (UNSUPPORTED_KINDS[observation.kind]) {
      signals.push({
        feature: observation.kind,
        identityDefining: observation.identityDefining ?? true,
        reason: observation.detail ?? UNSUPPORTED_KINDS[observation.kind],
        level: "unsupported",
      });
    } else if (LIMITATION_KINDS[observation.kind]) {
      signals.push({
        feature: observation.kind,
        identityDefining: false,
        reason: observation.detail ?? LIMITATION_KINDS[observation.kind],
        level: "limitation",
      });
    }
  }
  return signals;
}
