// V2 standardized QA evidence and geometry comparison (issue #13, PRD
// sections 26-27).
//
// Every Release Candidate is evaluated through the same standardized
// evidence set: Home at desktop ~1440 / intermediate ~768 / mobile ~390 full
// page plus first-viewport captures; About/Services/Contact at desktop and
// mobile full page. The geometry comparator compares normalized structural
// properties — never raw pixels — and its output is evidence for QA-A, not a
// standalone verdict.

import type { Env } from "../env.d";
import { putImmutableObjectTolerant } from "../lib/assets";
import { appendBuildWorkflowEvent } from "./lifecycle";
import { storeBuildStageArtifactIdempotent, type StoredStageArtifact } from "./stage-artifacts";
import { buildVersionEvidenceKey } from "./artifact-keys";
import type { PageId } from "./site-generator";

export const QA_EVIDENCE_SCHEMA_VERSION = "qa-evidence/1";

export const QA_VIEWPORTS = {
  desktop: 1440,
  intermediate: 768,
  mobile: 390,
} as const;

export interface GeometryProfile {
  regionOrder: string[];
  firstViewportHeightRatio: number;
  sectionHeightRatios: number[];
  imageMassRatio: number;
  containerWidthRatio: number;
  columnRatios: number[];
  dominantAlignment: "left" | "center" | "right" | "asymmetric";
  surfaceSequence: string[];
  whitespaceRatio: number;
}

export interface PageCapture {
  page: PageId;
  viewportWidth: number;
  fullPageScreenshot: Uint8Array;
  firstViewportScreenshot?: Uint8Array;
  geometry: GeometryProfile;
  runtime?: { consoleErrors: string[]; failedRequests: string[] };
}

export type QaCaptureFn = (spec: Array<{ page: PageId; viewportWidth: number; firstViewport: boolean }>) => Promise<PageCapture[]>;

// Builds a comparable GeometryProfile from a regions list (reference evidence
// or candidate layout — same mapping both sides). Metrics not carried by
// regions (surface sequence, whitespace) keep neutral values so the
// comparator judges the measurable structural properties.
export function geometryFromRegions(
  regions: Array<{ id: string; height: number; viewportHeightRatio: number }>,
  imageMassRatio: number
): GeometryProfile {
  return {
    regionOrder: regions.map((region) => region.id),
    firstViewportHeightRatio: regions[0]?.viewportHeightRatio ?? 0.9,
    sectionHeightRatios: regions.map((region) => region.height / (regions[0]?.height || 1)),
    imageMassRatio,
    containerWidthRatio: 0.83,
    columnRatios: [5 / 7],
    dominantAlignment: "asymmetric",
    surfaceSequence: regions.map((_, index) => (index % 3 === 2 ? "ink" : "paper")),
    whitespaceRatio: 0.22,
  };
}

// The standardized capture matrix (PRD section 26).
export function standardCaptureSpec(): Array<{ page: PageId; viewportWidth: number; firstViewport: boolean }> {
  return [
    { page: "home", viewportWidth: QA_VIEWPORTS.desktop, firstViewport: true },
    { page: "home", viewportWidth: QA_VIEWPORTS.intermediate, firstViewport: true },
    { page: "home", viewportWidth: QA_VIEWPORTS.mobile, firstViewport: true },
    { page: "about", viewportWidth: QA_VIEWPORTS.desktop, firstViewport: false },
    { page: "about", viewportWidth: QA_VIEWPORTS.mobile, firstViewport: false },
    { page: "services", viewportWidth: QA_VIEWPORTS.desktop, firstViewport: false },
    { page: "services", viewportWidth: QA_VIEWPORTS.mobile, firstViewport: false },
    { page: "contact", viewportWidth: QA_VIEWPORTS.desktop, firstViewport: false },
    { page: "contact", viewportWidth: QA_VIEWPORTS.mobile, firstViewport: false },
  ];
}

export interface QaEvidenceBundle {
  schemaVersion: string;
  captures: Array<{
    page: PageId;
    viewportWidth: number;
    hasFirstViewport: boolean;
    artifactR2Key: string;
    geometry: GeometryProfile;
    consoleErrorCount: number;
    failedRequestCount: number;
  }>;
  createdAt: string;
}

export async function buildStandardEvidenceBundle(
  env: Env,
  input: {
    buildId: string;
    buildVersionId: string;
    buildVersionNumber: number;
    siteGenerationId: string;
    capture: QaCaptureFn;
  }
): Promise<StoredStageArtifact & { bundle: QaEvidenceBundle }> {
  const spec = standardCaptureSpec();
  const captures = await input.capture(spec);

  const bundle: QaEvidenceBundle = {
    schemaVersion: QA_EVIDENCE_SCHEMA_VERSION,
    captures: [],
    createdAt: new Date().toISOString(),
  };
  let index = 0;
  for (const capture of captures) {
    index += 1;
    const key = buildVersionEvidenceKey(
      input.buildId,
      input.buildVersionNumber,
      `qa/${capture.page}-${capture.viewportWidth}-${index}.png`
    );
    await putImmutableObjectTolerant(env, key, capture.fullPageScreenshot, { httpMetadata: { contentType: "image/png" } });
    if (capture.firstViewportScreenshot) {
      await putImmutableObjectTolerant(
        env,
        buildVersionEvidenceKey(input.buildId, input.buildVersionNumber, `qa/${capture.page}-${capture.viewportWidth}-first.png`),
        capture.firstViewportScreenshot,
        { httpMetadata: { contentType: "image/png" } }
      );
    }
    bundle.captures.push({
      page: capture.page,
      viewportWidth: capture.viewportWidth,
      hasFirstViewport: capture.firstViewportScreenshot !== undefined,
      artifactR2Key: key,
      geometry: capture.geometry,
      consoleErrorCount: capture.runtime?.consoleErrors.length ?? 0,
      failedRequestCount: capture.runtime?.failedRequests.length ?? 0,
    });
  }

  const stored = await storeBuildStageArtifactIdempotent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    siteGenerationId: input.siteGenerationId,
    kind: "qa_evidence_bundle",
    schemaVersion: QA_EVIDENCE_SCHEMA_VERSION,
    value: bundle,
  });

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId, buildVersionId: input.buildVersionId,
    fromState: "PREVIEW", toState: "QA_EVIDENCE", stage: "qa_evidence",
    detail: `Standardized evidence captured (${bundle.captures.length} page/viewport captures)`,
  });

  return { ...stored, bundle };
}

// ── Geometry comparator ─────────────────────────────────────────────────────

export interface GeometryComparisonMetric {
  id: string;
  referenceValue: string | number;
  candidateValue: string | number;
  deviation: number;
  tolerance: number;
  withinTolerance: boolean;
}

export interface GeometryComparison {
  metrics: GeometryComparisonMetric[];
  similarityScore: number;
  materialDeviations: string[];
}

// Normalized structural comparison with explicit tolerances — no pixel
// equality anywhere (PRD section 27).
export function compareGeometry(reference: GeometryProfile, candidate: GeometryProfile): GeometryComparison {
  const metrics: GeometryComparisonMetric[] = [];

  const regionCountRef = reference.regionOrder.length;
  const regionCountCand = candidate.regionOrder.length;
  metrics.push({
    id: "region_count",
    referenceValue: regionCountRef,
    candidateValue: regionCountCand,
    deviation: Math.abs(regionCountRef - regionCountCand),
    tolerance: Math.max(1, Math.round(regionCountRef * 0.2)),
    withinTolerance: Math.abs(regionCountRef - regionCountCand) <= Math.max(1, Math.round(regionCountRef * 0.2)),
  });

  const common = Math.min(regionCountRef, regionCountCand);
  let orderedMatches = 0;
  for (let i = 0; i < common; i++) {
    if (reference.regionOrder[i] === candidate.regionOrder[i]) orderedMatches += 1;
  }
  const orderSimilarity = common === 0 ? 0 : orderedMatches / Math.max(regionCountRef, regionCountCand);
  metrics.push({
    id: "region_order",
    referenceValue: reference.regionOrder.join(">"),
    candidateValue: candidate.regionOrder.join(">"),
    deviation: Number((1 - orderSimilarity).toFixed(3)),
    tolerance: 0.25,
    withinTolerance: orderSimilarity >= 0.75,
  });

  const fvDeviation = Math.abs(reference.firstViewportHeightRatio - candidate.firstViewportHeightRatio);
  metrics.push({
    id: "first_viewport_height_ratio",
    referenceValue: Number(reference.firstViewportHeightRatio.toFixed(3)),
    candidateValue: Number(candidate.firstViewportHeightRatio.toFixed(3)),
    deviation: Number(fvDeviation.toFixed(3)),
    tolerance: 0.15,
    withinTolerance: fvDeviation <= 0.15,
  });

  const imageMassDeviation = Math.abs(reference.imageMassRatio - candidate.imageMassRatio);
  metrics.push({
    id: "image_mass_ratio",
    referenceValue: Number(reference.imageMassRatio.toFixed(3)),
    candidateValue: Number(candidate.imageMassRatio.toFixed(3)),
    deviation: Number(imageMassDeviation.toFixed(3)),
    tolerance: 0.2,
    withinTolerance: imageMassDeviation <= 0.2,
  });

  const containerDeviation = Math.abs(reference.containerWidthRatio - candidate.containerWidthRatio);
  metrics.push({
    id: "container_width_ratio",
    referenceValue: Number(reference.containerWidthRatio.toFixed(3)),
    candidateValue: Number(candidate.containerWidthRatio.toFixed(3)),
    deviation: Number(containerDeviation.toFixed(3)),
    tolerance: 0.1,
    withinTolerance: containerDeviation <= 0.1,
  });

  metrics.push({
    id: "dominant_alignment",
    referenceValue: reference.dominantAlignment,
    candidateValue: candidate.dominantAlignment,
    deviation: reference.dominantAlignment === candidate.dominantAlignment ? 0 : 1,
    tolerance: 0,
    withinTolerance: reference.dominantAlignment === candidate.dominantAlignment,
  });

  const surfaceCommon = Math.min(reference.surfaceSequence.length, candidate.surfaceSequence.length);
  const surfaceMatches = Array.from({ length: surfaceCommon }).filter(
    (_, i) => reference.surfaceSequence[i] === candidate.surfaceSequence[i]
  ).length;
  const surfaceSimilarity = surfaceCommon === 0 ? 1 : surfaceMatches / Math.max(reference.surfaceSequence.length, candidate.surfaceSequence.length);
  metrics.push({
    id: "surface_sequence",
    referenceValue: reference.surfaceSequence.join(">"),
    candidateValue: candidate.surfaceSequence.join(">"),
    deviation: Number((1 - surfaceSimilarity).toFixed(3)),
    tolerance: 0.34,
    withinTolerance: surfaceSimilarity >= 0.66,
  });

  const whitespaceDeviation = Math.abs(reference.whitespaceRatio - candidate.whitespaceRatio);
  metrics.push({
    id: "whitespace_ratio",
    referenceValue: Number(reference.whitespaceRatio.toFixed(3)),
    candidateValue: Number(candidate.whitespaceRatio.toFixed(3)),
    deviation: Number(whitespaceDeviation.toFixed(3)),
    tolerance: 0.15,
    withinTolerance: whitespaceDeviation <= 0.15,
  });

  const passed = metrics.filter((metric) => metric.withinTolerance).length;
  const similarityScore = Math.round((passed / metrics.length) * 100);
  return {
    metrics,
    similarityScore,
    materialDeviations: metrics.filter((metric) => !metric.withinTolerance).map((metric) => `${metric.id} (ref ${metric.referenceValue} vs cand ${metric.candidateValue})`),
  };
}
