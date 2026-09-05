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
import { getObject, putImmutableObject, putImmutableObjectTolerant } from "../lib/assets";
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
import { evaluateReferenceEvidenceSufficiency, type EvidenceSufficiencyVerdict } from "./reference-sufficiency";
import { extractScreenshotEvidence, type ScreenshotExtraction } from "./visual-evidence-extraction";
import { decodePng, downscaleRgb, encodePng, sliceRgbRows } from "../lib/png-codec";

// Normalized visual-input bounds (issue #41): model-facing artifacts are
// bounded-width downscales; very tall pages become ordered vertical slices
// so no model input exceeds the height budget. Composition is never altered.
const NORMALIZED_VISUAL_WIDTH = 1024;
const MAX_NORMALIZED_SLICE_HEIGHT = 6000;

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
  /** Deterministic verdict frozen with the package (issue #39). Null only for
   *  packages frozen before the sufficiency guard existed; those are
   *  evaluated lazily by getFrozenReferenceEvidence without rewriting frozen
   *  evidence. */
  evidenceSufficiency: EvidenceSufficiencyVerdict | null;
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
  evidence_sufficiency: string | null;
  evidence_sufficiency_verdict_json: string | null;
  frozen_at: string;
}

function sufficiencyVerdictFromRow(row: ReferencePackageRow): EvidenceSufficiencyVerdict | null {
  if (!row.evidence_sufficiency_verdict_json) return null;
  return JSON.parse(row.evidence_sufficiency_verdict_json) as EvidenceSufficiencyVerdict;
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
    evidenceSufficiency: sufficiencyVerdictFromRow(row),
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
    // Production default binds the Worker environment (issue #40); tests may
    // inject a deterministic capture through input.capture.
    const capture = input.capture ?? createProductionReferenceCapture(env);
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

  // ── Deterministic screenshot evidence extraction (issue #41) ──────────────
  // Pixels become measured facts BEFORE any AI interpretation. Runs on the
  // canonical screenshot regardless of input mode: for SCREENSHOT_ONLY this
  // is THE structure channel (bands become the evidence regions); for URL
  // captures it is the independent second channel beside DOM measurements.
  const extraction = await extractScreenshotEvidence(canonicalBytes, canonicalScreenshotR2Key);
  const extractionBands = extraction.coverage.decoded ? extraction.bands : [];

  // ── Normalized visual inputs (Reference Visual Package, issue #41) ───────
  // Deterministic model-consumable representations of the canonical
  // screenshot: one bounded-width full page plus ordered vertical slices for
  // very tall pages. Composition is never rearranged — slicing preserves
  // spatial order, hashes bind every artifact to the canonical source.
  const visualWrites: Array<{ key: string; content: Uint8Array; mimeType: string }> = [];
  const visualInputs: NonNullable<ReferenceEvidence["visualInputs"]> = [];
  {
    const decoded = await decodePng(canonicalBytes);
    if (decoded.ok) {
      const normalized = downscaleRgb(decoded.png, Math.min(decoded.png.width, NORMALIZED_VISUAL_WIDTH));
      const pieces: Array<{ kind: "full-page" | "slice"; image: { width: number; height: number; rgb: Uint8Array }; sliceIndex?: number }> =
        normalized.height <= MAX_NORMALIZED_SLICE_HEIGHT
          ? [{ kind: "full-page", image: normalized }]
          : Array.from({ length: Math.ceil(normalized.height / MAX_NORMALIZED_SLICE_HEIGHT) }, (_, index) => ({
              kind: "slice" as const,
              sliceIndex: index + 1,
              image: sliceRgbRows(normalized, index * MAX_NORMALIZED_SLICE_HEIGHT, (index + 1) * MAX_NORMALIZED_SLICE_HEIGHT),
            }));
      let sliceIndex = 0;
      for (const piece of pieces) {
        sliceIndex += 1;
        const png = await encodePng(piece.image);
        const key = buildVersionEvidenceKey(
          input.buildId,
          input.buildVersionNumber,
          piece.kind === "full-page" ? "reference/visual/full-page.png" : `reference/visual/slice-${sliceIndex}.png`
        );
        visualWrites.push({ key, content: png, mimeType: "image/png" });
        visualInputs.push({
          kind: piece.kind,
          artifact: key,
          sha256: await sha256HexBytes(png),
          width: piece.image.width,
          height: piece.image.height,
        });
      }
    }
  }

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
    // SCREENSHOT_ONLY: the extracted pixel bands ARE the measured region
    // structure (issue #41). URL captures keep DOM-measured regions; the
    // pixel channel rides the extraction field as the independent channel.
    regions: captureOutput?.regions ?? extractionBands.map((band) => ({
      id: band.id,
      startY: band.startY,
      endY: band.endY,
      height: band.height,
      viewportHeightRatio: band.viewportHeightRatio,
    })),
    measuredElements: [
      ...(captureOutput?.measuredElements ?? []),
      // The canonical Reference Screenshot itself is a measured artifact
      // (dimensions recorded at freeze). Screenshot-only References carry no
      // browser measurements, so without this anchor Reference Analysis
      // could never lawfully anchor a signature trait to the screenshot that
      // is authoritative for static composition.
      {
        selectorHint: "screenshot",
        role: "canonical-reference-screenshot",
        computed: {
          pixelWidth: screenshotMetadata.pixelWidth ?? null,
          pixelHeight: screenshotMetadata.pixelHeight ?? null,
          likelyCssViewportWidth: screenshotMetadata.likelyCssViewportWidth ?? null,
        },
        confidence: "HIGH",
        source: "SCREENSHOT",
      },
      // Screenshot-only: extracted surface bands, image masses and colour
      // roles are machine-measured facts (issue #41).
      ...(captureOutput
        ? []
        : [
            ...extractionBands.map((band) => ({
              selectorHint: `#${band.id}`,
              role: `surface-band:${band.bandClass}`,
              boundingBox: {
                x: 0,
                y: band.startY,
                width: screenshotMetadata.pixelWidth ?? 0,
                height: band.height,
              },
              computed: {
                dominantColour: band.dominantColour,
                luminance: band.luminance,
                inkDensity: band.inkDensity,
              },
              confidence: "HIGH" as const,
              source: "SCREENSHOT" as const,
            })),
            ...extraction.imageMasses.map((mass, index) => ({
              selectorHint: `#shot-image-mass-${index + 1}`,
              role: "image-mass",
              boundingBox: mass.boundingBox,
              computed: { density: mass.density },
              confidence: "HIGH" as const,
              source: "SCREENSHOT" as const,
            })),
            ...(extraction.coverage.decoded
              ? [{
                  selectorHint: "screenshot",
                  role: "colour-roles",
                  computed: {
                    background: extraction.colourRoles.background,
                    accents: extraction.colourRoles.accents.join(" | "),
                  },
                  confidence: "HIGH" as const,
                  source: "SCREENSHOT" as const,
                }]
              : []),
          ]),
    ],
    responsiveObservations: captureOutput?.responsiveObservations ?? [],
    motionObservations: captureOutput?.motionObservations ?? [],
    discrepancies,
    extraction,
    ...(visualInputs.length > 0 ? { visualInputs } : {}),
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

  // Deterministic evidence-sufficiency verdict (issue #39): information-free
  // evidence must fail closed instead of reaching blueprint generation. The
  // verdict is evaluated BEFORE freeze and frozen with the package; a missing
  // blocking dimension stays INSUFFICIENT unless the Adaptation Contract
  // explicitly declares it (evidence_missing:<dimension>), which yields
  // PARTIAL for the downstream coverage contract to treat as uncovered.
  // Evidence-missing declarations may also arrive on a contract supplied for
  // an otherwise SUPPORTED reference (the SWL branch above leaves
  // `adaptationContract` null there), so consult the submitted contract too.
  const evidenceSufficiency = evaluateReferenceEvidenceSufficiency(evidence, {
    adaptationContract: adaptationContract ?? input.adaptationContract ?? null,
  });

  const evidenceJson = JSON.stringify(evidence);
  const evidenceR2Key = buildVersionEvidenceKey(input.buildId, input.buildVersionNumber, "reference/evidence.json");
  const checksum = await sha256Hex(evidenceJson);
  const frozenAt = nowIso();
  const packageId = generateId();

  await putImmutableObjectTolerant(env, canonicalScreenshotR2Key, canonicalBytes, {
    httpMetadata: { contentType: canonicalMime },
  });
  for (const write of [...captureWrites, ...visualWrites]) {
    await putImmutableObjectTolerant(env, write.key, write.content, {
      httpMetadata: { contentType: write.mimeType },
    });
  }
  await putImmutableObjectTolerant(env, evidenceR2Key, evidenceJson, {
    httpMetadata: { contentType: "application/json" },
  });

  await env.DB.prepare(
    `INSERT INTO reference_evidence_packages (
       id, site_generation_id, build_id, build_version_id, suitability, suitability_reasons_json,
       adaptation_contract_json, input_mode, evidence_r2_key, canonical_screenshot_r2_key, checksum, frozen_at,
       evidence_sufficiency, evidence_sufficiency_verdict_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      frozenAt,
      evidenceSufficiency.sufficiency,
      JSON.stringify(evidenceSufficiency)
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
    detail: `Reference Evidence frozen (suitability ${decision.suitability}, evidence sufficiency ${evidenceSufficiency.sufficiency}${adaptationContract ? `, Adaptation Contract ${adaptationContract.version}` : ""})`,
  });

  return {
    packageId,
    suitability: decision.suitability,
    suitabilityReasons: decision.reasons,
    adaptationContract,
    inputMode,
    evidenceR2Key,
    canonicalScreenshotR2Key,
    evidenceSufficiency,
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
  /** Verdict frozen with the package, or — for packages frozen before the
   *  sufficiency guard existed — the same versioned evaluation computed on
   *  read (frozen evidence itself is never rewritten). */
  evidenceSufficiency: EvidenceSufficiencyVerdict;
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
  const adaptationContract = row.adaptation_contract_json
    ? (JSON.parse(row.adaptation_contract_json) as AdaptationContract)
    : null;
  return {
    packageId: row.id,
    suitability: row.suitability,
    suitabilityReasons: JSON.parse(row.suitability_reasons_json) as string[],
    adaptationContract,
    evidence,
    evidenceSufficiency:
      sufficiencyVerdictFromRow(row) ?? evaluateReferenceEvidenceSufficiency(evidence, { adaptationContract }),
    evidenceR2Key: row.evidence_r2_key,
    canonicalScreenshotR2Key: row.canonical_screenshot_r2_key,
    frozenAt: row.frozen_at,
  };
}

// ── Production capture adapter ──────────────────────────────────────────────
// Modern multi-signal reference capture (issue #40). A single stitched
// full-page screenshot is NOT a capture strategy for modern sites: cookie
// banners, newsletter popups, scroll lock, lazy loading, sticky headers,
// smooth-scroll libraries, transform-based scroll and reveal animations all
// corrupt it. The bounded deterministic sequence is:
//
//   load -> dismiss bounded blocking overlays where safe -> wait for
//   images/assets -> exercise real scrolling with settle waits (reveal states
//   settle, lazy content loads) -> viewport checkpoints at section boundaries
//   -> post-sweep layout (the flattened truth) -> canonical full-page capture
//   -> bounded mobile pass.
//
// Designs that cannot be deterministically flattened are RECORDED (see
// flatteningSignal -> unreliable_scroll_flattening limitation, which flows
// into Reference Suitability), never papered over with invented evidence.
// The Worker environment is REQUIRED at factory time and validated before
// launch: `launch(undefined)` is unreachable by construction (issue #40).

import { playwrightAdapter, type BrowserAdapter, type BrowserPage, type RawLayout } from "../lib/browser-adapter";
import { REFERENCE_VIEWPORTS } from "../lib/viewports";
import { withBrowser } from "../lib/browser-lifecycle";

const MAX_OVERLAY_DISMISSALS = 3;
const MAX_SCROLL_CHECKPOINTS = 8;
const SWEEP_SETTLE_MS = 350;
const MOBILE_NAV_TIMEOUT_MS = 30_000;

// Generic overlay-dismissal probes (no site-specific scripts). Each probe is
// gated behind a cheap typed countMatches so a selector that matches nothing
// costs one evaluate, never a click timeout.
const OVERLAY_DISMISS_SELECTORS = [
  "[id*=cookie i] button, [class*=cookie i] button, [aria-label*=cookie i] button",
  "[id*=consent i] button, [class*=consent i] button, [id*=gdpr i] button",
  "[aria-label*='accept all' i], [aria-label*='allow all' i]",
  "[class*=popup i] [class*=close i], [class*=modal i] [class*=close i], [aria-label*='close' i]",
];

export interface ProductionCaptureDeps {
  /** Test seam; defaults to the Playwright production adapter. */
  adapter?: BrowserAdapter;
}

/**
 * Binds the Worker environment into the production capture path. The returned
 * closure validates the BROWSER binding before every launch so a production
 * URL capture fails with a precise error instead of `launch(undefined)`.
 */
export function createProductionReferenceCapture(env: Env, deps: ProductionCaptureDeps = {}): ReferenceCaptureFn {
  return async ({ referenceUrl }) => {
    if (!env || !env.BROWSER) {
      throw new ReferenceIntakeError(
        "REFERENCE_CAPTURE_FAILED",
        "Production Reference capture requires the BROWSER binding (issue #40); refusing to launch without it"
      );
    }
    const adapter = deps.adapter ?? playwrightAdapter;
    const session = await adapter.launch(env);
    return withBrowser(session, (browser) => captureReferenceSignals(browser, referenceUrl));
  };
}

interface OverlayDismissalReport {
  probes: number;
  clicked: string[];
  notes: string[];
}

// Bounded, best-effort: every failure is recorded as a note, never fatal.
async function dismissBoundedOverlays(page: BrowserPage): Promise<OverlayDismissalReport> {
  const report: OverlayDismissalReport = { probes: 0, clicked: [], notes: [] };
  for (const selector of OVERLAY_DISMISS_SELECTORS) {
    if (report.probes >= MAX_OVERLAY_DISMISSALS) break;
    try {
      const matches = await page.countMatches(selector);
      if (matches === 0) continue;
      await page.click(selector);
      report.probes += 1;
      report.clicked.push(selector);
      await page.settle(400);
    } catch (error) {
      report.notes.push(`overlay dismiss probe failed for '${selector}': ${(error as Error).message}`);
    }
  }
  return report;
}

export interface ScrollSweepResult {
  checkpoints: Array<{ label: string; png: Uint8Array }>;
  notes: string[];
}

// Real scrolling with settle waits: reveals settle, lazy content loads, and
// each section boundary yields an independent viewport checkpoint so capture
// never depends on one stitched screenshot.
async function scrollSweep(page: BrowserPage, layout: RawLayout): Promise<ScrollSweepResult> {
  const result: ScrollSweepResult = { checkpoints: [], notes: [] };
  for (const section of layout.sections.slice(0, MAX_SCROLL_CHECKPOINTS)) {
    const selector = section.evidenceId ? `[data-cf-evidence-id="${section.evidenceId}"]` : section.tag;
    try {
      await page.scrollTo(selector);
      await page.settle(SWEEP_SETTLE_MS);
      result.checkpoints.push({
        label: `checkpoint-${section.order}-${section.tag}`,
        png: await page.screenshot({ fullPage: false }),
      });
    } catch (error) {
      result.notes.push(`scroll checkpoint failed at section ${section.order}: ${(error as Error).message}`);
    }
  }
  return result;
}

/**
 * Generic flattening signal: did the page's section topology change materially
 * by exercising real scroll? Scroll-transform / smooth-scroll layouts have no
 * single static rendering. Topology COLLAPSE under scroll (sections vanish,
 * e.g. a scroll-jacked track being transformed) or an extreme reflow means the
 * canonical full-page capture cannot be trusted alone. Modest growth from
 * lazy-loading during the sweep is normal settling, not instability.
 */
export function flatteningSignal(
  preSweep: RawLayout,
  postSweep: RawLayout
): { unstable: boolean; detail: string } {
  const before = preSweep.sections.length;
  const after = postSweep.sections.length;
  if (before === 0) return { unstable: false, detail: "no sections measured pre-sweep" };
  if (after < before) {
    return {
      unstable: true,
      detail: `section topology collapsed under scrolling (${before} -> ${after} sections); static flattening is unreliable`,
    };
  }
  if ((after - before) / before > 0.5) {
    return {
      unstable: true,
      detail: `section topology reflowed materially under scrolling (${before} -> ${after} sections); static flattening is unreliable`,
    };
  }
  return { unstable: false, detail: `section topology stable under scroll (${before} sections)` };
}

type BrowserSessionLike = Awaited<ReturnType<BrowserAdapter["launch"]>>;

async function captureMobilePass(
  browser: BrowserSessionLike,
  referenceUrl: string
): Promise<{ ok: true; layout: RawLayout; fullPage: Uint8Array } | { ok: false; error: string }> {
  const mobile = REFERENCE_VIEWPORTS[2];
  const page = await browser.newPage({ viewport: mobile, reducedMotion: false });
  try {
    await page.goto(referenceUrl, { timeoutMs: MOBILE_NAV_TIMEOUT_MS, waitUntil: "networkidle" });
    await page.assignEvidenceIds();
    await page.waitForImages(8_000);
    await dismissBoundedOverlays(page);
    const layout = await page.extractLayout();
    const fullPage = await page.screenshot({ fullPage: true });
    return { ok: true, layout, fullPage };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    await page.close();
  }
}

async function captureReferenceSignals(
  browser: BrowserSessionLike,
  referenceUrl: string
): Promise<ReferenceCaptureOutput> {
  const desktop = REFERENCE_VIEWPORTS[0];
  const page = await browser.newPage({ viewport: desktop, reducedMotion: false });
  try {
    await page.goto(referenceUrl, { timeoutMs: 45_000, waitUntil: "networkidle" });
    await page.assignEvidenceIds();
    await page.waitForImages(10_000);

    const preSweepLayout = await page.extractLayout();
    const overlay = await dismissBoundedOverlays(page);
    const sweepLayout = overlay.clicked.length > 0 ? await page.extractLayout() : preSweepLayout;
    const sweep = await scrollSweep(page, sweepLayout);
    const layout = await page.extractLayout();

    const interactions = await page.discoverInteractables();
    const canonicalFullPage = await page.screenshot({ fullPage: true });
    const mobile = await captureMobilePass(browser, referenceUrl);

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
      // Surface/colour and rhythm observations ride the measured-elements
      // channel (issue #40): the adapter already measures them; stop dropping
      // them at the capture boundary.
      {
        selectorHint: "body",
        role: "surface",
        computed: {
          background: layout.colors.background ?? null,
          text: layout.colors.text ?? null,
          accents: layout.colors.accents.join(" | "),
        },
        confidence: "HIGH" as const,
        source: "COMPUTED_STYLE" as const,
      },
      ...(layout.spacing
        ? [{
            selectorHint: layout.spacing.evidenceId
              ? `[data-cf-evidence-id="${layout.spacing.evidenceId}"]`
              : "section",
            role: "spacing",
            computed: {
              sectionPadding: layout.spacing.sectionPadding,
              sectionMargin: layout.spacing.sectionMargin,
              rhythm: layout.spacing.rhythm,
            },
            confidence: "MEDIUM" as const,
            source: "COMPUTED_STYLE" as const,
          }]
        : []),
      ...layout.images.slice(0, 12).map((image) => ({
        selectorHint: image.evidenceId ? `[data-cf-evidence-id="${image.evidenceId}"]` : "img",
        role: "image",
        computed: {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          displayedWidth: image.displayedWidth,
          alt: image.alt,
        },
        confidence: "MEDIUM" as const,
        source: "DOM" as const,
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
    const flattening = flatteningSignal(preSweepLayout, layout);
    if (flattening.unstable) {
      motionObservations.push({ kind: "unreliable_scroll_flattening", detail: flattening.detail });
    }

    const discrepancies: unknown[] = [
      ...overlay.notes.map((note) => ({ kind: "overlay_dismissal", detail: note })),
      ...(overlay.clicked.length > 0
        ? [{ kind: "overlay_dismissed", detail: `dismissed ${overlay.clicked.length} blocking overlay(s): ${overlay.clicked.join(", ")}` }]
        : []),
      ...sweep.notes.map((note) => ({ kind: "scroll_sweep", detail: note })),
      { kind: "flattening_check", detail: flattening.detail },
    ];

    const captures: ReferenceCaptureOutput["captures"] = [
      { viewportWidth: desktop.width, viewportHeight: desktop.height, content: canonicalFullPage, mimeType: "image/png" },
      ...sweep.checkpoints.map((checkpoint) => ({
        viewportWidth: desktop.width,
        viewportHeight: desktop.height,
        content: checkpoint.png,
        mimeType: "image/png",
      })),
    ];
    if (mobile.ok) {
      captures.push({ viewportWidth: REFERENCE_VIEWPORTS[2].width, content: mobile.fullPage, mimeType: "image/png" });
    } else {
      discrepancies.push({ kind: "mobile_capture_unavailable", detail: mobile.error });
    }

    return {
      canonicalScreenshot: {
        content: canonicalFullPage,
        mimeType: "image/png",
        pixelWidth: desktop.width,
        pixelHeight: undefined as number | undefined,
        likelyCssViewportWidth: desktop.width,
      },
      captures,
      regions,
      measuredElements,
      responsiveObservations: [
        { kind: "viewport_matrix", viewports: REFERENCE_VIEWPORTS.map((viewport) => viewport.name) },
        { kind: "viewport_meta", content: layout.viewportMeta },
        { kind: "viewport_checkpoints", count: sweep.checkpoints.length },
        mobile.ok
          ? { kind: "mobile_capture", viewport: REFERENCE_VIEWPORTS[2].name, sections: mobile.layout.sections.length, navItems: mobile.layout.nav.length }
          : { kind: "mobile_capture", viewport: REFERENCE_VIEWPORTS[2].name, unavailable: true },
      ],
      motionObservations,
      discrepancies,
    };
  } finally {
    await page.close();
  }
}
