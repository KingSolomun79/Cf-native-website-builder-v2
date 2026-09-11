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
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent, type StoredStageArtifact } from "./stage-artifacts";
import { buildVersionEvidenceKey } from "./artifact-keys";
import type { PageId } from "./site-contracts";

export const QA_EVIDENCE_SCHEMA_VERSION = "qa-evidence/1";

export const QA_VIEWPORTS = {
  desktop: 1440,
  intermediate: 768,
  mobile: 390,
} as const;

export interface GeometryProfile {
  regionOrder: string[];
  /** UNKNOWN (null) when not measured — never a fabricated default. */
  firstViewportHeightRatio: number | null;
  sectionHeightRatios: number[];
  imageMassRatio: number | null;
  containerWidthRatio: number | null;
  columnRatios: number[];
  dominantAlignment: "left" | "center" | "right" | "asymmetric" | null;
  surfaceSequence: string[];
  whitespaceRatio: number | null;
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
// or candidate layout — same mapping both sides). Metrics the regions cannot
// measure are UNKNOWN (null): reference geometry is never fabricated for
// similarity scoring (issue #41). imageMassRatio must come from real
// measurement (pixel extraction channel or DOM capture) or stay null.
export function geometryFromRegions(
  regions: Array<{ id: string; height: number; viewportHeightRatio: number }>,
  imageMassRatio: number | null
): GeometryProfile {
  return {
    regionOrder: regions.map((region) => region.id),
    firstViewportHeightRatio: regions[0]?.viewportHeightRatio ?? null,
    sectionHeightRatios: regions.map((region) => region.height / (regions[0]?.height || 1)),
    imageMassRatio,
    containerWidthRatio: null,
    columnRatios: [],
    dominantAlignment: null,
    surfaceSequence: [],
    whitespaceRatio: null,
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
  // Workflow-step retry safety: the bundle carries a createdAt timestamp, so
  // a retried capture never reproduces the frozen checksum. The frozen bundle
  // for this Build Version IS the evidence — reuse it instead of recapturing.
  const existing = await getBuildStageArtifact<QaEvidenceBundle>(env, input.buildVersionId, "qa_evidence_bundle");
  if (existing) {
    return {
      artifactId: existing.artifactId,
      artifactR2Key: existing.artifactR2Key,
      checksum: existing.checksum,
      bundle: existing.value,
    };
  }

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

// ── Direct reference fidelity gate (issue #44) ──────────────────────────────

export interface GeometryComparisonMetric {
  id: string;
  referenceValue: string | number;
  candidateValue: string | number;
  deviation: number;
  tolerance: number;
  withinTolerance: boolean;
}

export interface GeometryComparison {
  /** MEASURED: at least the minimum comparable metric set exists.
   *  INSUFFICIENT_REFERENCE_EVIDENCE: the reference side lacks the
   *  measurements behind a similarity percentage — no score is emitted. */
  status: "MEASURED" | "INSUFFICIENT_REFERENCE_EVIDENCE";
  metrics: GeometryComparisonMetric[];
  /** Only meaningful when status === "MEASURED". */
  similarityScore: number | null;
  /** Share of comparable metrics that both sides actually measured (0-1). */
  measuredCoverage: number;
  materialDeviations: string[];
}

const COMPARABLE_METRIC_IDS = [
  "region_count",
  "region_order",
  "first_viewport_height_ratio",
  "image_mass_ratio",
  "container_width_ratio",
  "dominant_alignment",
  "surface_sequence",
  "whitespace_ratio",
] as const;

// Normalized structural comparison with explicit tolerances — no pixel
// equality anywhere (PRD section 27). A metric is compared ONLY when both
// sides carry a real measurement; a similarity percentage is never emitted
// against an unmeasured reference profile (issue #41).
