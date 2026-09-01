// V2 Reference intake, suitability and evidence freeze (issue #7, PRD 9-11).
//
// Takes a REFERENCE_BOUND Site Generation from Reference input to a frozen
// versioned Reference Evidence package:
//   - Screenshot-only References are accepted when the frozen screenshot
//     object exists.
//   - URL-only References are converted into a canonical frozen screenshot
//     plus evidence before any downstream analysis.
//   - When screenshot and live URL disagree on static composition, the frozen
//     Reference Screenshot stays authoritative and the discrepancy is
//     recorded.
// Deterministic measurements and suitability classification happen BEFORE AI
// interpretation. Reference content/branding never becomes Business Facts:
// this service never writes onboarding_submissions or fact_updates.

import type { Env } from "../env.d";
import { Value } from "@sinclair/typebox/value";
import { generateId, nowIso } from "../lib/crypto";
import { getObject, putImmutableObject } from "../lib/assets";
import { validateScreenshot } from "../lib/reference-input";
import { appendBuildWorkflowEvent } from "./lifecycle";
import type { OnboardingSubmissionRow } from "./lifecycle";
import { buildVersionEvidenceKey } from "./artifact-keys";
import {
  ADAPTATION_CONTRACT_VERSION,
  REFERENCE_EVIDENCE_VERSION,
  ReferenceEvidenceSchema,
  adaptIfValid,
  classifyReferenceSuitability,
  deriveSuitabilitySignals,
  validateAdaptationContract,
  type AdaptationContract,
  type ReferenceEvidence,
  type ReferenceSuitability,
  type StructuredObservation,
} from "./reference-evidence-schema";

export type ReferenceIntakeErrorCode =
  | "GENERATION_NOT_FOUND"
  | "NOT_REFERENCE_BOUND"
  | "REFERENCE_SCREENSHOT_MISSING"
  | "REFERENCE_SCREENSHOT_INVALID"
  | "REFERENCE_CAPTURE_FAILED"
  | "ADAPTATION_CONTRACT_REQUIRED"
  | "EVIDENCE_SCHEMA_INVALID";

export class ReferenceIntakeError extends Error {
  readonly code: ReferenceIntakeErrorCode;

  constructor(code: ReferenceIntakeErrorCode, message: string) {
    super(message);
    this.name = "ReferenceIntakeError";
    this.code = code;
  }
}

// ── Capture contract ────────────────────────────────────────────────────────

export interface ReferenceCaptureScreenshot {
  content: Uint8Array;
  mimeType: string;
  pixelWidth?: number;
  pixelHeight?: number;
  likelyCssViewportWidth?: number;
}

export interface ReferenceCaptureOutput {
  /** Canonical screenshot candidate (authoritative for URL-only input). */
  canonicalScreenshot: ReferenceCaptureScreenshot;
  captures: Array<{
    viewportWidth: number;
    viewportHeight?: number;
    content: Uint8Array;
    mimeType: string;
  }>;
  regions: ReferenceEvidence["regions"];
  measuredElements: ReferenceEvidence["measuredElements"];
  responsiveObservations: unknown[];
  motionObservations: StructuredObservation[];
  /** Adapter-detected live-vs-frozen-screenshot conflicts. */
  discrepancies: unknown[];
}

export type ReferenceCaptureFn = (input: {
  referenceUrl: string;
  hasSuppliedScreenshot: boolean;
}) => Promise<ReferenceCaptureOutput>;

// ── Inputs / outputs ────────────────────────────────────────────────────────

export interface RunReferenceIntakeInput {
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  buildVersionNumber: number;
  adaptationContract?: AdaptationContract;
  capture?: ReferenceCaptureFn;
}

export interface FrozenReferencePackage {
  packageId: string;
  suitability: ReferenceSuitability;
  suitabilityReasons: string[];
  adaptationContract: AdaptationContract | null;
  inputMode: "SCREENSHOT_ONLY" | "URL_ONLY" | "SCREENSHOT_AND_URL";
  evidenceR2Key: string;
  canonicalScreenshotR2Key: string;
  alreadyFrozen: boolean;
}

interface ReferencePackageRow {
  id: string;
  site_generation_id: string;
  build_id: string;
  build_version_id: string;
  suitability: ReferenceSuitability;
  suitability_reasons_json: string;
  adaptation_contract_json: string | null;
  input_mode: FrozenReferencePackage["inputMode"];
  evidence_r2_key: string;
  canonical_screenshot_r2_key: string;
  frozen_at: string;
}

function packageFromRow(row: ReferencePackageRow, alreadyFrozen: boolean): FrozenReferencePackage {
  return {
    packageId: row.id,
    suitability: row.suitability,
    suitabilityReasons: JSON.parse(row.suitability_reasons_json) as string[],
    adaptationContract: row.adaptation_contract_json
      ? (JSON.parse(row.adaptation_contract_json) as AdaptationContract)
      : null,
    inputMode: row.input_mode,
    evidenceR2Key: row.evidence_r2_key,
    canonicalScreenshotR2Key: row.canonical_screenshot_r2_key,
    alreadyFrozen,
  };
}

async function loadSubmission(
  env: Env,
  siteGenerationId: string
): Promise<{ submission: OnboardingSubmissionRow; reference: { screenshotR2Key?: string; url?: string }; buildMode: string }> {
  const generation = await env.DB.prepare("SELECT * FROM site_generations WHERE id = ?")
    .bind(siteGenerationId)
    .first<{ id: string; onboarding_submission_id: string; build_mode: string }>();
  if (!generation) {
    throw new ReferenceIntakeError("GENERATION_NOT_FOUND", `Site Generation ${siteGenerationId} does not exist`);
  }
  const submission = await env.DB.prepare("SELECT * FROM onboarding_submissions WHERE id = ?")
    .bind(generation.onboarding_submission_id)
    .first<OnboardingSubmissionRow>();
  if (!submission) {
    throw new ReferenceIntakeError("GENERATION_NOT_FOUND", "Site Generation has no Onboarding Submission");
  }
  const payload = JSON.parse(submission.payload_json) as {
    buildMode: string;
    reference?: { screenshotR2Key?: string; url?: string };
  };
  return { submission, reference: payload.reference ?? {}, buildMode: payload.buildMode };
}

// Reads and validates the submitted Reference Screenshot before anything is
// frozen: it must be a structurally complete PNG within the size/geometry
// contract (QA-F2 — the retained reference-input validator is authoritative).
async function readScreenshotBytes(
  env: Env,
  key: string
): Promise<{ bytes: Uint8Array; mimeType: string; width: number; height: number }> {
  const body = await getObject(env, key);
  if (!body) {
    throw new ReferenceIntakeError(
      "REFERENCE_SCREENSHOT_MISSING",
      `Reference Screenshot '${key}' is not persisted and cannot be frozen`
    );
  }
  const buffer = await new Response(body).arrayBuffer();
  const validation = validateScreenshot({ data: buffer, byteSize: buffer.byteLength, mimeType: "image/png" });
  if (!validation.ok) {
    throw new ReferenceIntakeError(
      "REFERENCE_SCREENSHOT_INVALID",
      `Reference Screenshot '${key}' failed content validation (${validation.code}): ${validation.error}`
    );
  }
  return {
    bytes: new Uint8Array(buffer),
    mimeType: validation.metadata.mimeType,
    width: validation.metadata.width,
    height: validation.metadata.height,
  };
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ── Intake ──────────────────────────────────────────────────────────────────

export async function runReferenceIntake(
  env: Env,
  input: RunReferenceIntakeInput
): Promise<FrozenReferencePackage> {
  const existing = await env.DB.prepare(
    "SELECT * FROM reference_evidence_packages WHERE site_generation_id = ?"
  )
    .bind(input.siteGenerationId)
    .first<ReferencePackageRow>();
  if (existing) {
    // Frozen evidence is never re-captured or rewritten; a re-run is an
    // idempotent read of the immutable package.
    return packageFromRow(existing, true);
  }

  const { reference, buildMode } = await loadSubmission(env, input.siteGenerationId);
  if (buildMode !== "REFERENCE_BOUND") {
    throw new ReferenceIntakeError(
      "NOT_REFERENCE_BOUND",
      `Reference intake only applies to REFERENCE_BOUND Site Generations (got '${buildMode}')`
    );
  }

  const hasScreenshot = typeof reference.screenshotR2Key === "string" && reference.screenshotR2Key.length > 0;
  const hasUrl = typeof reference.url === "string" && reference.url.length > 0;
  const inputMode: FrozenReferencePackage["inputMode"] = hasScreenshot && hasUrl
    ? "SCREENSHOT_AND_URL"
    : hasScreenshot
      ? "SCREENSHOT_ONLY"
      : "URL_ONLY";

  let captureOutput: ReferenceCaptureOutput | null = null;
  if (hasUrl) {
    const capture = input.capture ?? defaultProductionCapture;
    try {
      captureOutput = await capture({ referenceUrl: reference.url!, hasSuppliedScreenshot: hasScreenshot });
    } catch (error) {
      throw new ReferenceIntakeError(
        "REFERENCE_CAPTURE_FAILED",
        `Canonical capture of Reference URL failed: ${(error as Error).message}`
      );
    }
  }

  // Canonical frozen screenshot: the supplied Reference Screenshot when one
  // exists (it stays authoritative over live state), otherwise the canonical
  // capture from the Reference URL.
  let canonicalBytes: Uint8Array;
  let canonicalMime: string;
  let screenshotMetadata: ReferenceEvidence["screenshotMetadata"] = {};
  if (hasScreenshot) {
    const read = await readScreenshotBytes(env, reference.screenshotR2Key!);
    canonicalBytes = read.bytes;
    canonicalMime = read.mimeType;
    screenshotMetadata = { pixelWidth: read.width, pixelHeight: read.height, likelyCssViewportWidth: read.width };
  } else {
    canonicalBytes = captureOutput!.canonicalScreenshot.content;
    canonicalMime = captureOutput!.canonicalScreenshot.mimeType;
    screenshotMetadata = {
      pixelWidth: captureOutput!.canonicalScreenshot.pixelWidth,
      pixelHeight: captureOutput!.canonicalScreenshot.pixelHeight,
      likelyCssViewportWidth: captureOutput!.canonicalScreenshot.likelyCssViewportWidth,
    };
  }

  const extension = canonicalMime === "image/jpeg" ? "jpg" : "png";
  const canonicalScreenshotR2Key = buildVersionEvidenceKey(
    input.buildId,
    input.buildVersionNumber,
    `reference/screenshot.${extension}`
  );

  // Live-vs-screenshot conflicts: the frozen screenshot wins; every recorded
  // discrepancy is annotated with that precedence.
  const discrepancies: unknown[] = (captureOutput?.discrepancies ?? []).map((entry) => ({
    ...(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : { detail: entry }),
    resolution: "REFERENCE_SCREENSHOT_AUTHORITATIVE",
  }));
  if (inputMode === "SCREENSHOT_AND_URL" && captureOutput) {
    discrepancies.push({
      kind: "supplemental_live_evidence",
      detail: "Live URL evidence recorded as runtime/interaction supplement only; static composition authority remains the frozen Reference Screenshot.",
      resolution: "REFERENCE_SCREENSHOT_AUTHORITATIVE",
    });
  }

  const captureArtifacts: ReferenceEvidence["captures"] = [];
  const captureWrites: Array<{ key: string; content: Uint8Array; mimeType: string }> = [];
  const supplemental = captureOutput?.captures ?? (captureOutput ? [captureOutput.canonicalScreenshot].map((shot) => ({
    viewportWidth: shot.likelyCssViewportWidth ?? 1440,
    content: shot.content,
    mimeType: shot.mimeType,
  })) : []);
  let captureIndex = 0;
  for (const shot of supplemental) {
    captureIndex += 1;
    const key = buildVersionEvidenceKey(
      input.buildId,
      input.buildVersionNumber,
      `reference/captures/${captureIndex}-${shot.viewportWidth}.png`
    );
    captureWrites.push({ key, content: shot.content, mimeType: shot.mimeType });
    captureArtifacts.push({
      viewportWidth: shot.viewportWidth,
      viewportHeight: "viewportHeight" in shot && typeof shot.viewportHeight === "number" ? shot.viewportHeight : undefined,
      screenshotArtifact: key,
    });
  }

  const evidence: ReferenceEvidence = {
    version: REFERENCE_EVIDENCE_VERSION,
    ...(reference.url ? { referenceUrl: reference.url } : {}),
    screenshotId: canonicalScreenshotR2Key,
    screenshotMetadata,
    captures: captureArtifacts,
    regions: captureOutput?.regions ?? [],
    measuredElements: captureOutput?.measuredElements ?? [],
    responsiveObservations: captureOutput?.responsiveObservations ?? [],
    motionObservations: captureOutput?.motionObservations ?? [],
    discrepancies,
  };
  if (!Value.Check(ReferenceEvidenceSchema, evidence)) {
    throw new ReferenceIntakeError("EVIDENCE_SCHEMA_INVALID", "Assembled Reference Evidence failed its versioned schema");
  }

  // Deterministic suitability classification from structured observations —
  // before any AI interpretation.
  const signals = deriveSuitabilitySignals(evidence.motionObservations as StructuredObservation[]);
  const decision = classifyReferenceSuitability(signals);

  let adaptationContract: AdaptationContract | null = null;
  if (decision.suitability === "SUPPORTED_WITH_LIMITATIONS") {
    const contract = input.adaptationContract;
    if (!contract) {
      throw new ReferenceIntakeError(
        "ADAPTATION_CONTRACT_REQUIRED",
        `SUPPORTED_WITH_LIMITATIONS Reference requires a concrete Adaptation Contract before generation continues (features: ${decision.signals.map((signal) => signal.feature).join(", ")})`
      );
    }
    const validation = validateAdaptationContract(contract, decision);
    if (!validation.valid) {
      throw new ReferenceIntakeError(
        "ADAPTATION_CONTRACT_REQUIRED",
        `Adaptation Contract does not cover the accepted limitations: ${validation.uncovered.join(", ")}`
      );
    }
    adaptationContract = contract;
  }

  const evidenceJson = JSON.stringify(evidence);
  const evidenceR2Key = buildVersionEvidenceKey(input.buildId, input.buildVersionNumber, "reference/evidence.json");
  const checksum = await sha256Hex(evidenceJson);
  const frozenAt = nowIso();
  const packageId = generateId();

  await putImmutableObject(env, canonicalScreenshotR2Key, canonicalBytes, {
    httpMetadata: { contentType: canonicalMime },
  });
  for (const write of captureWrites) {
    await putImmutableObject(env, write.key, write.content, {
      httpMetadata: { contentType: write.mimeType },
    });
  }
  await putImmutableObject(env, evidenceR2Key, evidenceJson, {
    httpMetadata: { contentType: "application/json" },
  });

  await env.DB.prepare(
    `INSERT INTO reference_evidence_packages (
       id, site_generation_id, build_id, build_version_id, suitability, suitability_reasons_json,
       adaptation_contract_json, input_mode, evidence_r2_key, canonical_screenshot_r2_key, checksum, frozen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      packageId,
      input.siteGenerationId,
      input.buildId,
      input.buildVersionId,
      decision.suitability,
      JSON.stringify(decision.reasons),
      adaptationContract ? JSON.stringify(adaptationContract) : null,
      inputMode,
      evidenceR2Key,
      canonicalScreenshotR2Key,
      checksum,
      frozenAt
    )
    .run();

  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "INTAKE_READY",
    toState: "REFERENCE_CHECK",
    stage: "reference_check",
    detail: `Reference input classified (${inputMode})`,
  });
  await appendBuildWorkflowEvent(env, {
    buildId: input.buildId,
    buildVersionId: input.buildVersionId,
    fromState: "REFERENCE_CHECK",
    toState: "REFERENCE_EVIDENCE",
    stage: "reference_evidence",
    detail: `Reference Evidence frozen (suitability ${decision.suitability}${adaptationContract ? `, Adaptation Contract ${adaptationContract.version}` : ""})`,
  });

  return {
    packageId,
    suitability: decision.suitability,
    suitabilityReasons: decision.reasons,
    adaptationContract,
    inputMode,
    evidenceR2Key,
    canonicalScreenshotR2Key,
    alreadyFrozen: false,
  };
}

// ── Reader for later stages ─────────────────────────────────────────────────

export interface FrozenReferenceEvidence {
  packageId: string;
  suitability: ReferenceSuitability;
  suitabilityReasons: string[];
  adaptationContract: AdaptationContract | null;
  evidence: ReferenceEvidence;
  evidenceR2Key: string;
  canonicalScreenshotR2Key: string;
  frozenAt: string;
}

export async function getFrozenReferenceEvidence(
  env: Env,
  siteGenerationId: string
): Promise<FrozenReferenceEvidence | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM reference_evidence_packages WHERE site_generation_id = ?"
  )
    .bind(siteGenerationId)
    .first<ReferencePackageRow>();
  if (!row) return null;
  const evidenceBody = await getObject(env, row.evidence_r2_key);
  if (!evidenceBody) return null;
  const evidence = adaptIfValid(JSON.parse(await new Response(evidenceBody).text()));
  if (!evidence) return null;
  return {
    packageId: row.id,
    suitability: row.suitability,
    suitabilityReasons: JSON.parse(row.suitability_reasons_json) as string[],
    adaptationContract: row.adaptation_contract_json
      ? (JSON.parse(row.adaptation_contract_json) as AdaptationContract)
      : null,
    evidence,
    evidenceR2Key: row.evidence_r2_key,
    canonicalScreenshotR2Key: row.canonical_screenshot_r2_key,
    frozenAt: row.frozen_at,
  };
}

// ── Production capture adapter ──────────────────────────────────────────────
// Deterministic browser capture through the typed no-evaluate boundary
// (src/lib/browser-adapter.ts). Loaded lazily so test environments without a
// BROWSER binding only pay for it when a URL actually needs capturing.

import { playwrightAdapter } from "../lib/browser-adapter";
import { REFERENCE_VIEWPORTS } from "../lib/viewports";
import { withBrowser } from "../lib/browser-lifecycle";

const defaultProductionCapture: ReferenceCaptureFn = async ({ referenceUrl }) => {
  const session = await playwrightAdapter.launch(undefined);
  return withBrowser(session, async (browser) => {
    const desktop = REFERENCE_VIEWPORTS[0];
    const page = await browser.newPage({ viewport: desktop, reducedMotion: false });
    try {
      await page.goto(referenceUrl, { timeoutMs: 45_000, waitUntil: "networkidle" });
      await page.assignEvidenceIds();
      await page.waitForImages(10_000);
      const layout = await page.extractLayout();
      const interactions = await page.discoverInteractables();
      const fullPageScreenshot = await page.screenshot({ fullPage: true });

      const viewportHeight = desktop.height;
      const regions: ReferenceEvidence["regions"] = layout.sections.map((section) => ({
        id: `region-${section.order}`,
        startY: section.bounds.y,
        endY: section.bounds.y + section.bounds.height,
        height: section.bounds.height,
        viewportHeightRatio: Number((section.bounds.height / viewportHeight).toFixed(3)),
        boundingBox: section.bounds,
      }));

      const measuredElements: ReferenceEvidence["measuredElements"] = [
        ...layout.sections.map((section) => ({
          selectorHint: section.evidenceId ? `[data-cf-evidence-id="${section.evidenceId}"]` : section.tag,
          role: section.role ?? section.tag,
          boundingBox: section.bounds,
          confidence: "HIGH" as const,
          source: "DOM" as const,
        })),
        ...layout.typography.slice(0, 24).map((typeStyle) => ({
          selectorHint: typeStyle.element,
          role: "typography",
          computed: {
            fontFamily: typeStyle.fontFamily,
            fontSize: typeStyle.fontSize,
            fontWeight: typeStyle.fontWeight,
            lineHeight: typeStyle.lineHeight,
            letterSpacing: typeStyle.letterSpacing,
            textTransform: typeStyle.textTransform,
          },
          confidence: "MEDIUM" as const,
          source: "COMPUTED_STYLE" as const,
        })),
      ];

      const motionObservations: StructuredObservation[] = [];
      const canvasCount = await page.countMatches("canvas");
      if (canvasCount > 0 && layout.sections.length === 0) {
        motionObservations.push({ kind: "canvas_webgl_primary", detail: `${canvasCount} canvas element(s) with no semantic sections` });
      }
      const videoCount = await page.countMatches("video");
      if (videoCount > 0 && layout.sections.length === 0) {
        motionObservations.push({ kind: "dominant_video", detail: `${videoCount} video element(s) with no semantic sections` });
      }
      if (interactions.sticky.length > 3) {
        motionObservations.push({ kind: "complex_stateful_interaction", detail: `${interactions.sticky.length} sticky elements` });
      }
      if (interactions.revealCandidates.length > 12) {
        motionObservations.push({ kind: "heavy_parallax", detail: `${interactions.revealCandidates.length} reveal/parallax candidates` });
      }

      const canonical = {
        content: fullPageScreenshot,
        mimeType: "image/png",
        pixelWidth: desktop.width,
        pixelHeight: undefined as number | undefined,
        likelyCssViewportWidth: desktop.width,
      };

      return {
        canonicalScreenshot: canonical,
        captures: [
          { viewportWidth: desktop.width, viewportHeight: desktop.height, content: fullPageScreenshot, mimeType: "image/png" },
        ],
        regions,
        measuredElements,
        responsiveObservations: [
          { kind: "viewport_matrix", viewports: REFERENCE_VIEWPORTS.map((viewport) => viewport.name) },
          { kind: "viewport_meta", content: layout.viewportMeta },
        ],
        motionObservations,
        discrepancies: [],
      };
    } finally {
      await page.close();
    }
  });
};
