// V2 Reference Evidence sufficiency (issue #39).
//
// Deterministic, versioned evaluation of whether frozen Reference Evidence
// carries enough measured design structure to describe the Reference's visual
// identity BEFORE any AI interpretation runs. Information-free evidence fails
// closed: no invented Blueprint values, no generic defaults, no silent
// ORIGINAL_DESIGN switch. Screenshot-only input remains a valid mode once
// screenshot evidence extraction exists (issue #41); screenshot-only with
// dimensions only never does.

import type { AdaptationContract, ReferenceEvidence } from "./reference-evidence-schema";

export const REFERENCE_SUFFICIENCY_VERSION = "1";

export type EvidenceSufficiency = "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT";

/**
 * Evidence dimensions whose measured presence is required to establish the
 * Reference's design identity. Their absence is blocking: undeclared absence
 * is INSUFFICIENT (fail closed), while an Adaptation Contract that explicitly
 * declares the absence downgrades the verdict to PARTIAL so the downstream
 * Blueprint coverage contract can treat those dimensions as uncovered.
 * Supplementary channels (responsive/motion/URL observations) are recorded by
 * Suitability, not by sufficiency — a static screenshot legitimately carries
 * none of them.
 */
export type BlockingEvidenceDimension = "region_structure" | "measured_elements";

export const BLOCKING_EVIDENCE_DIMENSIONS: BlockingEvidenceDimension[] = [
  "region_structure",
  "measured_elements",
];

/** Feature token an Adaptation Contract uses to declare a missing dimension. */
export function evidenceMissingFeature(dimension: BlockingEvidenceDimension): string {
  return `evidence_missing:${dimension}`;
}

export interface EvidenceSufficiencyVerdict {
  sufficiency: EvidenceSufficiency;
  version: string;
  /** Blocking dimensions with no measured data. */
  missingBlocking: BlockingEvidenceDimension[];
  /** Missing blocking dimensions the Adaptation Contract explicitly declares. */
  declaredMissing: BlockingEvidenceDimension[];
  reasons: string[];
}

// Intake anchors the canonical screenshot itself as one measured element
// (dimensions only). It is provenance metadata, not design-structure
// evidence, so it never satisfies a blocking dimension.
const SYNTHETIC_SCREENSHOT_ANCHOR_ROLE = "canonical-reference-screenshot";

function hasMeasuredGeometry(region: ReferenceEvidence["regions"][number]): boolean {
  return (
    typeof region.viewportHeightRatio === "number" ||
    typeof region.height === "number" ||
    (typeof region.startY === "number" && typeof region.endY === "number") ||
    region.boundingBox !== undefined
  );
}

function carriesMeasurement(element: ReferenceEvidence["measuredElements"][number]): boolean {
  return (
    element.role !== SYNTHETIC_SCREENSHOT_ANCHOR_ROLE &&
    (element.boundingBox !== undefined || (element.computed !== undefined && Object.keys(element.computed).length > 0))
  );
}

export function evaluateReferenceEvidenceSufficiency(
  evidence: ReferenceEvidence,
  options: { adaptationContract?: AdaptationContract | null } = {}
): EvidenceSufficiencyVerdict {
  const present: Record<BlockingEvidenceDimension, boolean> = {
    region_structure: evidence.regions.some(hasMeasuredGeometry),
    measured_elements: evidence.measuredElements.some(carriesMeasurement),
  };

  const declared = new Set<string>();
  const contract = options.adaptationContract;
  if (contract) {
    for (const entry of contract.unsupportedFeatures) declared.add(entry.feature);
    for (const entry of contract.acceptedApproximations) declared.add(entry.replaces);
  }

  const missingBlocking = BLOCKING_EVIDENCE_DIMENSIONS.filter((dimension) => !present[dimension]);
  const declaredMissing = missingBlocking.filter((dimension) => declared.has(evidenceMissingFeature(dimension)));

  const reasons = BLOCKING_EVIDENCE_DIMENSIONS.map((dimension) =>
    present[dimension]
      ? `${dimension}: measured evidence present`
      : declaredMissing.includes(dimension)
        ? `${dimension}: no measured evidence; absence declared by the Adaptation Contract (${evidenceMissingFeature(dimension)})`
        : `${dimension}: no measured evidence`
  );

  if (missingBlocking.length === 0) {
    return { sufficiency: "SUFFICIENT", version: REFERENCE_SUFFICIENCY_VERSION, missingBlocking: [], declaredMissing: [], reasons };
  }
  if (declaredMissing.length === missingBlocking.length) {
    return { sufficiency: "PARTIAL", version: REFERENCE_SUFFICIENCY_VERSION, missingBlocking, declaredMissing, reasons };
  }
  return {
    sufficiency: "INSUFFICIENT",
    version: REFERENCE_SUFFICIENCY_VERSION,
    missingBlocking,
    declaredMissing,
    reasons: [
      ...reasons,
      "INSUFFICIENT_REFERENCE_EVIDENCE: the frozen evidence cannot describe the Reference's design identity; REFERENCE_BOUND must not proceed to blueprint generation",
    ],
  };
}
