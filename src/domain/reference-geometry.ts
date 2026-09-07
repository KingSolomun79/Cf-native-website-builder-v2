// Canonical Reference region mapping authority (issue #65).
//
// Production (Build 282f9b9d, 2026-09-07) proved that the Blueprint's
// canonical regions and the Reference Evidence regions were related through
// THREE unvalidated hops: raw DOM bounding boxes recorded in a scrolled
// viewport coordinate space, per-band height summation that double-counted
// overlapping rowbands, and crop lookup by canonical id against raw evidence
// ids (reference crops silently NULL while the repair prompt claimed they
// were attached). This module is the ONE deterministic function every
// geometry consumer shares:
//
//   Blueprint canonical region
//     -> source Evidence region(s)
//     -> normalized Reference screenshot coordinates (page space)
//     -> union geometry (never overlap double-count, never gap invention)
//     -> Reference crop package
//
// Design rules (issue #65):
// - One coordinate space: page space of the frozen Reference Screenshot.
//   Scrolled-capture evidence is translated by the recorded capture scroll
//   offset, or — for legacy evidence — by the deterministic minimum-startY
//   recovery, validated against the screenshot height when it is known.
// - Overlap must union: a canonical region claiming overlapping evidence
//   bands gets the geometric union measure, never height(A)+height(B).
// - Non-contiguous sources become ORDERED SLICES; intervening visual mass is
//   never invented into the region's height.
// - Ambiguity fails closed: a region that cannot be mapped reliably is
//   AMBIGUOUS, carries no numeric target and no reference crop — it never
//   participates in automated geometry repair. HUMAN_REVIEW_REQUIRED is
//   preferred over repairing toward a fictitious target.
// - Semantic ordinal validation: the sourceEvidenceRegionIds of canonically
//   ordered regions must follow evidence order; an inversion proves a
//   shifted mapping and fails closed for the regions involved.

import type { ReferenceEvidence } from "./reference-evidence-schema";
import type { VisualBlueprint } from "./visual-blueprint";

export interface NormalizedInterval {
  startY: number;
  endY: number;
}

export type GeometryTransformKind = "recorded" | "recovered" | "identity";

export interface GeometryTransform {
  kind: GeometryTransformKind;
  /** Pixels added to raw evidence Y coordinates to reach page space. */
  offsetPx: number;
  /** Where this transform decision comes from (provenance, never a guess). */
  basis: string;
  /** true when the translated span was validated against the screenshot. */
  verified: boolean;
}

export type RegionMappingStatus = "MEASURED" | "AMBIGUOUS";

export interface CanonicalRegionGeometry {
  regionId: string;
  order: number;
  purpose: string;
  sourceEvidenceRegionIds: string[];
  status: RegionMappingStatus;
  /** Why mapping failed — null when MEASURED. */
  reason: string | null;
  /** Merged ordered intervals in normalized page space; null when AMBIGUOUS. */
  slices: NormalizedInterval[] | null;
  /** Union measure of the slices (never gap mass). */
  referenceHeightPx: number | null;
  referenceViewportRatio: number | null;
  referenceStartY: number | null;
  referenceEndY: number | null;
}

export interface ReferenceGeometryPackage {
  status: "MEASURED" | "AMBIGUOUS";
  transform: GeometryTransform;
  /** Viewport height derived from measured evidence bands (px). */
  viewportHeightPx: number | null;
  screenshotHeightPx: number | null;
  /** sha256 of the frozen reference screenshot when the evidence carries it. */
  referenceSha256: string | null;
  regions: CanonicalRegionGeometry[];
}

interface RawBand {
  id: string;
  index: number;
  startY: number | null;
  endY: number | null;
  height: number | null;
  viewportHeightRatio: number | null;
}

const PX_ROUNDING_TOLERANCE = 2;

function screenshotHeightOf(evidence: ReferenceEvidence): number | null {
  const extraction = evidence.extraction;
  if (extraction && extraction.coverage.decoded) return extraction.coverage.height;
  return evidence.screenshotMetadata.pixelHeight ?? null;
}

// Deterministic transform from raw evidence coordinates to the frozen
// screenshot's page space. Recorded capture scroll wins; legacy scrolled
// evidence is recovered from its own minimum and validated against the
// screenshot height when that height is known. Coordinates are never
// invented: an unrecoverable or contradicted space fails closed.
export function resolveGeometryTransform(evidence: ReferenceEvidence): { transform: GeometryTransform; bands: RawBand[] } {
  const bands: RawBand[] = evidence.regions.map((region, index) => ({
    id: region.id,
    index,
    startY: typeof region.startY === "number" ? region.startY : null,
    endY: typeof region.endY === "number" ? region.endY : null,
    height: typeof region.height === "number" ? region.height : null,
    viewportHeightRatio: typeof region.viewportHeightRatio === "number" ? region.viewportHeightRatio : null,
  }));
  const measured = bands.filter((band) => band.startY !== null && band.endY !== null);
  const screenshotHeightPx = screenshotHeightOf(evidence);

  let transform: GeometryTransform;
  if (typeof evidence.captureScrollY === "number" && evidence.captureScrollY >= 0) {
    transform = {
      kind: "recorded",
      offsetPx: evidence.captureScrollY,
      basis: `evidence.captureScrollY=${evidence.captureScrollY}`,
      verified: false,
    };
  } else {
    const minStart = measured.length ? Math.min(...measured.map((band) => band.startY!)) : 0;
    if (minStart < 0) {
      transform = {
        kind: "recovered",
        offsetPx: -minStart,
        basis: `legacy scrolled capture recovered from min(startY)=${minStart}`,
        verified: false,
      };
    } else {
      transform = { kind: "identity", offsetPx: 0, basis: "evidence already in page space", verified: true };
    }
  }

  if (transform.kind !== "identity" && screenshotHeightPx !== null) {
    if (measured.length > 0) {
      const spanStart = Math.min(...measured.map((band) => band.startY!)) + transform.offsetPx;
      const spanEnd = Math.max(...measured.map((band) => band.endY!)) + transform.offsetPx;
      const bottomSlack = screenshotHeightPx - spanEnd;
      // The lowest section may legitimately end above the page bottom (body
      // padding, trailing scripts), but the span must sit INSIDE the
      // screenshot and cover essentially all of it for a full-page capture.
      if (spanStart >= -PX_ROUNDING_TOLERANCE && spanEnd <= screenshotHeightPx + PX_ROUNDING_TOLERANCE && bottomSlack <= Math.max(120, 0.05 * screenshotHeightPx)) {
        transform = { ...transform, verified: true };
      }
    }
  }
  return { transform, bands };
}

export interface ResolveReferenceGeometryInput {
  blueprint: Pick<VisualBlueprint, "homepageRegions">;
  evidence: ReferenceEvidence;
}

// Minimal structural shapes the gate needs from the craft preflight — kept
// structural (not imported types) so the gate stays unit-testable.
export interface HeightFindingLike {
  checkId: string;
  regionId: string | null;
}
export interface CropPairLike {
  regionId: string;
  referenceSlices: Array<{ artifactR2Key: string }>;
}

// The #65 §7/§9 fail-closed repair gate: every REGION_HEIGHT_DEVIATION
// finding needs a MEASURED canonical mapping AND an existing stored reference
// crop. Returns one refusal reason per unmapped region; empty = repair may
// proceed. Repairing toward an unverifiable target is prohibited.
export function unmappedHeightFindingRegions(
  findings: HeightFindingLike[],
  geometry: ReferenceGeometryPackage,
  crops: CropPairLike[]
): string[] {
  const refusals: string[] = [];
  const heightRegions = new Set(
    findings.filter((finding) => finding.checkId === "REGION_HEIGHT_DEVIATION" && finding.regionId).map((finding) => finding.regionId!)
  );
  for (const regionId of heightRegions) {
    const geometryRegion = geometry.regions.find((region) => region.regionId === regionId);
    const cropPair = crops.find((pair) => pair.regionId === regionId);
    if (!geometryRegion || geometryRegion.status !== "MEASURED") {
      refusals.push(`${regionId}: REFERENCE_REGION_MAPPING_AMBIGUOUS`);
    } else if (!cropPair || cropPair.referenceSlices.length === 0 || !cropPair.referenceSlices[0].artifactR2Key) {
      refusals.push(`${regionId}: REFERENCE_CROP_UNAVAILABLE`);
    }
  }
  return refusals;
}

// THE mapping function (issue #65 §2): canonical region -> evidence regions
// -> normalized screenshot coordinates -> union geometry. Every geometry
// consumer (composition targets, craft preflight crops, QA reference
// profile) resolves through here — mapping logic is never reimplemented.
export function resolveReferenceGeometry(input: ResolveReferenceGeometryInput): ReferenceGeometryPackage {
  const { transform, bands } = resolveGeometryTransform(input.evidence);
  const screenshotHeightPx = screenshotHeightOf(input.evidence);
  const referenceSha256 = input.evidence.extraction?.sourceSha256 ?? null;

  // Validate the recovered/recorded space where possible; a contradicted
  // space poisons every region (fail closed, no numeric targets at all).
  let spaceValid = true;
  if (transform.kind !== "identity" && screenshotHeightPx !== null && !transform.verified) {
    spaceValid = false;
  }

  // Viewport height: the recorded capture viewport wins (it is the exact
  // denominator the evidence's own ratios were computed against); the median
  // per-band height/ratio is the fallback for evidence that lost it.
  const recordedViewportHeight = input.evidence.captures.find((capture) => typeof capture.viewportHeight === "number")?.viewportHeight ?? null;
  const viewportCandidates = bands
    .filter((band) => band.height !== null && band.viewportHeightRatio !== null && band.viewportHeightRatio > 0)
    .map((band) => band.height! / band.viewportHeightRatio!)
    .sort((a, b) => a - b);
  const medianViewportHeight = viewportCandidates.length ? viewportCandidates[Math.floor(viewportCandidates.length / 2)] : null;
  const viewportHeightPx = recordedViewportHeight ?? medianViewportHeight;

  const normalizedById = new Map<string, NormalizedInterval | null>();
  for (const band of bands) {
    if (band.startY === null || band.endY === null) {
      normalizedById.set(band.id, null);
      continue;
    }
    const startY = band.startY + transform.offsetPx;
    const endY = band.endY + transform.offsetPx;
    if (!spaceValid || startY < -PX_ROUNDING_TOLERANCE || endY <= startY) {
      normalizedById.set(band.id, null);
      continue;
    }
    normalizedById.set(band.id, {
      startY: Math.max(0, Math.round(startY)),
      endY: Math.round(Math.min(endY, screenshotHeightPx ?? endY)),
    });
  }

  // Merge overlapping/adjacent intervals (2px rounding tolerance): the union
  // measure of the region's source bands, never a naive sum (#65 §4).
  function unionSlices(intervals: NormalizedInterval[]): NormalizedInterval[] {
    const sorted = [...intervals].sort((a, b) => a.startY - b.startY);
    const merged: NormalizedInterval[] = [];
    for (const interval of sorted) {
      const last = merged[merged.length - 1];
      if (last && interval.startY <= last.endY + 2) {
        last.endY = Math.max(last.endY, interval.endY);
      } else {
        merged.push({ ...interval });
      }
    }
    return merged;
  }

  const ambiguities: Array<{ regionId: string; reason: string }> = [];
  const regions: CanonicalRegionGeometry[] = input.blueprint.homepageRegions.map((region, order) => ({
    regionId: region.id,
    order: order + 1,
    purpose: region.purpose,
    sourceEvidenceRegionIds: [...(region.sourceEvidenceRegionIds ?? [])],
    status: "MEASURED" as RegionMappingStatus,
    reason: null,
    slices: null,
    referenceHeightPx: null,
    referenceViewportRatio: null,
    referenceStartY: null,
    referenceEndY: null,
  }));

  const ambiguous = new Map<string, string>();
  const markAmbiguous = (regionId: string, reason: string) => {
    if (!ambiguous.has(regionId)) {
      ambiguous.set(regionId, reason);
      ambiguities.push({ regionId, reason });
    }
  };

  if (!spaceValid) {
    for (const region of regions) {
      markAmbiguous(region.regionId, `reference coordinate space is not recoverable against the frozen screenshot (transform: ${transform.basis})`);
    }
  }

  // Duplicate evidence claims across canonical regions (each band may be
  // claimed by at most one canonical region — Blueprint rule).
  const claimOwner = new Map<string, string>();
  for (const region of regions) {
    for (const sourceId of region.sourceEvidenceRegionIds) {
      const owner = claimOwner.get(sourceId);
      if (owner && owner !== region.regionId) {
        markAmbiguous(region.regionId, `evidence region '${sourceId}' is also claimed by canonical region '${owner}'`);
        markAmbiguous(owner, `evidence region '${sourceId}' is also claimed by canonical region '${region.regionId}'`);
      } else {
        claimOwner.set(sourceId, region.regionId);
      }
    }
  }

  // Semantic ordinal validation (#65 §6): canonically ordered regions must
  // reference evidence in evidence order. An inversion proves a shifted
  // mapping — the pair involved fails closed instead of producing targets
  // from the wrong zone.
  let previousMaxIndex: number | null = null;
  let previousRegionId: string | null = null;
  for (const region of regions) {
    const indices = region.sourceEvidenceRegionIds
      .map((id) => bands.find((band) => band.id === id)?.index)
      .filter((index): index is number => typeof index === "number");
    if (previousRegionId !== null && previousMaxIndex !== null && indices.length > 0 && Math.min(...indices) < previousMaxIndex) {
      const reason = `source evidence order inverts canonical order: '${region.regionId}' claims evidence before '${previousRegionId}' (shifted mapping)`;
      markAmbiguous(region.regionId, reason);
      markAmbiguous(previousRegionId!, reason);
    }
    if (indices.length > 0) {
      previousMaxIndex = Math.max(...indices);
      previousRegionId = region.regionId;
    }
  }

  for (const region of regions) {
    if (ambiguous.has(region.regionId)) {
      region.status = "AMBIGUOUS";
      region.reason = ambiguous.get(region.regionId)!;
      continue;
    }
    if (region.sourceEvidenceRegionIds.length === 0) {
      region.status = "AMBIGUOUS";
      region.reason = "canonical region carries no sourceEvidenceRegionIds provenance";
      ambiguities.push({ regionId: region.regionId, reason: region.reason });
      continue;
    }
    const intervals: NormalizedInterval[] = [];
    for (const sourceId of region.sourceEvidenceRegionIds) {
      const interval = normalizedById.get(sourceId);
      if (interval === undefined) {
        markAmbiguous(region.regionId, `unknown evidence region id '${sourceId}'`);
        break;
      }
      if (interval === null) {
        markAmbiguous(region.regionId, `evidence region '${sourceId}' has no valid normalized coordinates`);
        break;
      }
      intervals.push(interval);
    }
    if (ambiguous.has(region.regionId)) {
      region.status = "AMBIGUOUS";
      region.reason = ambiguous.get(region.regionId)!;
      continue;
    }
    const slices = unionSlices(intervals);
    const heightPx = slices.reduce((sum, slice) => sum + (slice.endY - slice.startY), 0);
    region.slices = slices;
    region.referenceHeightPx = heightPx;
    region.referenceViewportRatio = viewportHeightPx !== null ? Number((heightPx / viewportHeightPx).toFixed(3)) : null;
    region.referenceStartY = slices[0]?.startY ?? null;
    region.referenceEndY = slices[slices.length - 1]?.endY ?? null;
  }

  return {
    status: regions.every((region) => region.status === "MEASURED") ? "MEASURED" : "AMBIGUOUS",
    transform,
    viewportHeightPx,
    screenshotHeightPx,
    referenceSha256,
    regions,
  };
}
