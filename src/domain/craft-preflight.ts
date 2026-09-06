// V2 deterministic Design Craft Preflight (issue #49).
//
// Runs AFTER an inspectable Preview of the candidate exists and BEFORE
// expensive full QA: one home-desktop browser capture is judged by
// deterministic checks whose only authorities are the frozen Blueprint, the
// Implementation Contract's realization binding and the MEASURED Reference
// evidence (composition targets, image-mass extraction). This is deliberately
// NOT a second designer: nothing here flags a pattern as "generic" — in
// REFERENCE_BOUND the Reference wins (mode split, issue #49 section C), and
// the ORIGINAL_DESIGN anti-generic system remains future issue #51.
//
// Lifecycle seam (issue #49 section A, analysed): the preflight NEVER gates
// and NEVER consumes the QA repair budget. Its only power is triggering at
// most ONE informed per-page realization repair (the #47 entry point, new
// immutable page subkeys). Assembly is split into build (pure) and freeze
// (immutable) so the intermediate pre-failed candidate is deployed for
// inspection but never frozen as the Build Version's source: only the final
// candidate is frozen, so invalid intermediate artifacts cannot distort
// Build Version content or repair accounting. Every attempt is recorded as a
// craft_preflight stage artifact plus crop artifacts bound by hashes and
// coordinates (issue #49 sections D/E).

import type { PageId, ImageSlot } from "./site-generator";
import type { VisualBlueprint } from "./visual-blueprint";
import type { ImplementationContract } from "./implementation-planner";
import type { RawLayout } from "../lib/browser-adapter";
import { orientationConforms } from "../lib/image-dimensions";
import { decodePng, encodePng, sliceRgbRows } from "../lib/png-codec";
import { putImmutableObjectTolerant } from "../lib/assets";
import { buildVersionEvidenceKey } from "./artifact-keys";
import type { Env } from "../env.d";

export const CRAFT_PREFLIGHT_SCHEMA_VERSION = "craft-preflight/1";

/** One deterministic browser capture of the home page at desktop width. */
export interface CraftCapture {
  layout: RawLayout;
  fullPageScreenshot: Uint8Array;
  viewportWidth: number;
  viewportHeight: number;
}

export type CraftRepairScope = "page-realization" | "image-asset" | "observe";

export interface CraftFinding {
  checkId:
    | "REGION_MISSING"
    | "REGION_STYLE_REALIZATION"
    | "REGION_HEIGHT_DEVIATION"
    | "HEADLINE_CLIPPING"
    | "DISPLAY_TYPE_SCALE"
    | "IMAGE_ROLE_REALIZATION"
    | "IMAGE_ORIENTATION_MISMATCH"
    | "IMAGE_MASS_GROSS_DEVIATION"
    | "VIEWPORT_OVERFLOW";
  regionId: string | null;
  detail: string;
  /** The measured current state — numbers, never adjectives. */
  measured: string;
  /** The binding target (Blueprint/Contract/measured Reference evidence). */
  target: string;
  /** What may be touched: page realization feeds the informed repair; image
   *  asset defects flow to QA (the page regen cannot repaint pixels). */
  repairScope: CraftRepairScope;
  affectedPage: PageId;
}

export interface CropProvenance {
  sourceSha256: string;
  cropSha256: string;
  yStart: number;
  yEnd: number;
  /** Screenshot px per CSS px on the source (candidate: 1; reference may be downscaled). */
  scale: number;
  artifactR2Key: string;
  width: number;
  height: number;
}

export interface RegionCropPair {
  regionId: string;
  reference: CropProvenance | null;
  candidate: CropProvenance | null;
}

export interface CraftPreflightVerdict {
  attempt: number;
  passed: boolean;
  findings: CraftFinding[];
  /** Page-realization findings are the ONLY ones that trigger the informed
   *  repair (issue #49 section G); image-asset findings flow to QA. */
  pageRepairable: boolean;
  /** Deterministic directive text for regeneratePagesForRealization. */
  directiveText: string;
  crops: RegionCropPair[];
}

export interface CraftPreflightInput {
  capture: CraftCapture;
  blueprint: VisualBlueprint;
  contract: ImplementationContract;
  slots: ImageSlot[];
  /** Measured per-region composition targets (canonical topology aggregated
   *  from frozen Reference Evidence, issue #37). Absent targets are skipped —
   *  never replaced by fabricated defaults. */
  compositionTargets?: Array<{ regionId: string; viewportHeightRatio: number }>;
  /** Measured reference image-mass ratio from the deterministic screenshot
   *  extraction channel (issue #41); null when unmeasured. */
  referenceImageMassRatio: number | null;
  /** Frozen Reference side for deterministic region crops: the normalized
   *  full-page screenshot bytes, its CSS viewport width and the measured
   *  evidence region coordinates. Null (or missing coordinates) skips the
   *  reference side of a crop — coordinates are never invented. */
  reference?: {
    screenshot: Uint8Array;
    cssViewportWidth: number;
    regions: Array<{ id: string; startY?: number; endY?: number }>;
  } | null;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MAX_CROP_REGIONS = 3;

// Crops a vertical band [yStart, yEnd) from a PNG deterministically. Browser
// and pipeline PNGs are 8-bit non-interlaced, exactly what decodePng supports;
// anything else returns null (the pair simply loses that side — no invented
// imagery).
export async function cropPngBand(
  source: Uint8Array,
  yStart: number,
  yEnd: number
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const decoded = await decodePng(source);
  if (!decoded.ok) return null;
  const from = Math.max(0, Math.min(decoded.png.height, Math.round(yStart)));
  const to = Math.max(from, Math.min(decoded.png.height, Math.round(yEnd)));
  if (to - from < 4) return null;
  const slice = sliceRgbRows(decoded.png, from, to);
  return { bytes: await encodePng(slice), width: slice.width, height: slice.height };
}

export async function runCraftPreflight(input: CraftPreflightInput, attempt: number): Promise<CraftPreflightVerdict> {
  const { capture, blueprint, contract, slots } = input;
  const findings: CraftFinding[] = [];
  const viewportWidth = capture.viewportWidth || capture.layout.viewportWidth || 1440;
  const viewportHeight = capture.viewportHeight || capture.layout.viewportHeight || 900;
  const sections = capture.layout.sections;
  const canonical = new Map<string, { height: number; y: number; width: number }>();
  for (const section of sections) {
    if (!section.dataRegion) continue;
    const existing = canonical.get(section.dataRegion);
    canonical.set(section.dataRegion, {
      height: Math.max(existing?.height ?? 0, section.bounds.height),
      y: existing?.y ?? section.bounds.y,
      width: Math.max(existing?.width ?? 0, section.bounds.width),
    });
  }

  // 1. Canonical region presence (identity — never style-dependent).
  for (const region of blueprint.homepageRegions) {
    if (!canonical.has(region.id)) {
      findings.push({
        checkId: "REGION_MISSING",
        regionId: region.id,
        detail: `canonical region '${region.id}' is absent from the rendered home page`,
        measured: "not rendered",
        target: "one top-level section with this data-region",
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 2. Rendered style realization: a bound region must at least occupy a real
  // box; zero-area or collapsed regions mean the bound CSS never applied.
  for (const binding of contract.realization?.regionStyleBinding ?? []) {
    const box = canonical.get(binding.regionId);
    if (box && (box.height <= 2 || box.width <= 2)) {
      findings.push({
        checkId: "REGION_STYLE_REALIZATION",
        regionId: binding.regionId,
        detail: `canonical region '${binding.regionId}' renders as a collapsed box — the bound CSS realization never applied`,
        measured: `${Math.round(box.width)}x${Math.round(box.height)}px`,
        target: `non-collapsed box scoped by ${binding.cssSelector}`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 3. Per-region height deviation against MEASURED composition targets.
  // Gross-only: |rendered - target| beyond max(0.30, 50% of target) — normal
  // variance never trips this; a 0.8-viewport region rendering as a 3.2-viewport
  // stack (the frozen v3 failure) is unmistakable.
  for (const target of input.compositionTargets ?? []) {
    const rendered = canonical.get(target.regionId);
    if (!rendered) continue;
    const ratio = rendered.height / viewportHeight;
    const deviation = Math.abs(ratio - target.viewportHeightRatio);
    const tolerance = Math.max(0.3, 0.5 * target.viewportHeightRatio);
    if (deviation > tolerance) {
      findings.push({
        checkId: "REGION_HEIGHT_DEVIATION",
        regionId: target.regionId,
        detail: `region '${target.regionId}' renders ${ratio.toFixed(2)} viewport-heights against the measured ${target.viewportHeightRatio.toFixed(2)} target`,
        measured: `${ratio.toFixed(3)} viewport-heights (${Math.round(rendered.height)}px at ${viewportHeight}px viewport)`,
        target: `${target.viewportHeightRatio.toFixed(3)} viewport-heights (measured Reference evidence)`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 4. Headline clipping / critical text off-canvas.
  const headline = capture.layout.headline;
  if (headline && headline.bounds) {
    const rightEdge = headline.bounds.x + headline.bounds.width;
    const clipped = headline.bounds.width <= 0 || headline.bounds.x < -8 || rightEdge > viewportWidth + 8;
    if (clipped) {
      findings.push({
        checkId: "HEADLINE_CLIPPING",
        regionId: null,
        detail: "the H1 is clipped or pushed off-canvas in the first viewport",
        measured: `x=${Math.round(headline.bounds.x)}, width=${Math.round(headline.bounds.width)} at ${viewportWidth}px viewport`,
        target: "headline fully inside the viewport",
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 5. Display type scale: only when the Blueprint carries a NUMERIC display
  // token (never derived from prose). Catches UA-default headlines (the frozen
  // v3 32px default against a 60px display token).
  const displayTokenEntry = Object.entries(blueprint.tokens ?? {}).find(
    ([key, value]) => /display/i.test(key) && typeof value === "string" && /^(\d+(\.\d+)?)px$/.test((value as string).trim())
  );
  const displayToken = displayTokenEntry && typeof displayTokenEntry[1] === "string" ? [displayTokenEntry[0], displayTokenEntry[1]] as const : null;
  if (displayToken && headline?.fontSize) {
    const tokenPx = Number(/(\d+(\.\d+)?)/.exec(displayToken[1])![1]);
    const renderedPx = Number(/(\d+(\.\d+)?)/.exec(headline.fontSize)?.[1] ?? "0");
    if (renderedPx > 0 && renderedPx < 0.55 * tokenPx) {
      findings.push({
        checkId: "DISPLAY_TYPE_SCALE",
        regionId: null,
        detail: `the H1 renders at ${headline.fontSize} — far below the Blueprint display token`,
        measured: `${renderedPx}px`,
        target: `${tokenPx}px (${displayToken[0]})`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 6. CRITICAL/HIGH image-role realization + rendered orientation.
  const imageByRegion = new Map<string, Array<{ imageId: string | null; width: number; y: number; height: number; naturalWidth: number; naturalHeight: number }>>();
  for (const image of capture.layout.images) {
    if (!image.regionId) continue;
    const list = imageByRegion.get(image.regionId) ?? [];
    list.push({
      imageId: image.imageId ?? null,
      width: image.displayedWidth,
      y: image.boundsY ?? 0,
      height: image.displayedHeight ?? 0,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    });
    imageByRegion.set(image.regionId, list);
  }
  const regionIdBySlot = new Map(slots.filter((slot) => slot.page === "home" && slot.regionId).map((slot) => [slot.id, slot.regionId!]));
  for (const slot of slots) {
    if (slot.page !== "home" || slot.priority === "NORMAL") continue;
    const regionId = slot.regionId ?? regionIdBySlot.get(slot.id);
    if (!regionId) continue;
    const region = canonical.get(regionId);
    const rendered = (imageByRegion.get(regionId) ?? []).find((image) => image.imageId === slot.id);
    if (!rendered || rendered.width <= 0 || rendered.height <= 0) {
      findings.push({
        checkId: "IMAGE_ROLE_REALIZATION",
        regionId,
        detail: `${slot.priority} slot '${slot.id}' has no rendered image inside region '${regionId}'`,
        measured: rendered ? "zero-area" : "absent",
        target: `rendered <img data-image-id="${slot.id}"> with meaningful area`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
      continue;
    }
    const regionArea = Math.max(1, (region?.height ?? 0) * (region?.width ?? viewportWidth));
    const area = rendered.width * rendered.height;
    if (area < 0.04 * regionArea && area < 0.05 * viewportWidth * viewportHeight) {
      findings.push({
        checkId: "IMAGE_ROLE_REALIZATION",
        regionId,
        detail: `${slot.priority} slot '${slot.id}' renders at ${Math.round(rendered.width)}x${Math.round(rendered.height)}px — negligible against its region`,
        measured: `${Math.round(area)}px² (${((area / regionArea) * 100).toFixed(1)}% of region)`,
        target: "meaningful area within the region (≥4% region area)",
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
    if (
      rendered.naturalWidth > 0 &&
      rendered.naturalHeight > 0 &&
      !orientationConforms(slot.orientation, { width: rendered.naturalWidth, height: rendered.naturalHeight })
    ) {
      findings.push({
        checkId: "IMAGE_ORIENTATION_MISMATCH",
        regionId,
        detail: `slot '${slot.id}' requires ${slot.orientation}; the accepted asset measures ${rendered.naturalWidth}x${rendered.naturalHeight}`,
        measured: `${rendered.naturalWidth}x${rendered.naturalHeight}`,
        target: `${slot.orientation} composition`,
        repairScope: "image-asset",
        affectedPage: "home",
      });
    }
  }

  // 7. First-viewport image mass: a measured image-dominant reference against
  // an image-free first viewport. Gross-only, measured-vs-measured.
  const firstViewportRegionIds = new Set(blueprint.homepageFirstViewport.regionIds);
  if (input.referenceImageMassRatio !== null && input.referenceImageMassRatio >= 0.3) {
    let candidateMass = 0;
    for (const regionId of firstViewportRegionIds) {
      for (const image of imageByRegion.get(regionId) ?? []) {
        candidateMass += image.width * image.height;
      }
    }
    const massRatio = candidateMass / Math.max(1, viewportWidth * viewportHeight);
    if (massRatio < 0.02) {
      findings.push({
        checkId: "IMAGE_MASS_GROSS_DEVIATION",
        regionId: [...firstViewportRegionIds].join(",") || null,
        detail: "the measured image-dominant Reference first viewport renders essentially image-free",
        measured: `first-viewport image mass ${massRatio.toFixed(3)}`,
        target: `reference image-mass ${input.referenceImageMassRatio.toFixed(3)} (measured extraction)`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
    }
  }

  // 8. Horizontal overflow of canonical content beyond the viewport.
  for (const section of sections) {
    if (section.bounds.width > viewportWidth * 1.05) {
      findings.push({
        checkId: "VIEWPORT_OVERFLOW",
        regionId: section.dataRegion,
        detail: `content renders ${Math.round(section.bounds.width)}px wide on a ${viewportWidth}px viewport`,
        measured: `${Math.round(section.bounds.width)}px`,
        target: `≤ ${Math.round(viewportWidth * 1.05)}px`,
        repairScope: "page-realization",
        affectedPage: "home",
      });
      break; // one overflow finding is enough to direct the repair
    }
  }

  const pageRepairable = findings.some((finding) => finding.repairScope === "page-realization");
  const directiveText = findings
    .map((finding) =>
      `- [${finding.checkId}] ${finding.regionId ? `region '${finding.regionId}': ` : ""}${finding.detail}. Measured: ${finding.measured}. Binding target: ${finding.target}.`
    )
    .join("\n");

  // 9. Deterministic region crops for the failed regions (issue #49 D/E):
  // candidate bands from the capture screenshot, reference bands from the
  // frozen normalized screenshot at its own measured coordinates — never
  // fabricated, each bound by source hash + coordinates.
  const failedRegions = [...new Set(findings.map((finding) => finding.regionId).filter((id): id is string => id !== null))].slice(0, MAX_CROP_REGIONS);
  const crops: RegionCropPair[] = [];
  for (const regionId of failedRegions) {
    const pair: RegionCropPair = { regionId, reference: null, candidate: null };
    const box = canonical.get(regionId);
    if (box && box.height >= 4) {
      const candidateCrop = await cropPngBand(capture.fullPageScreenshot, box.y, box.y + box.height);
      if (candidateCrop) {
        pair.candidate = {
          sourceSha256: await sha256Hex(capture.fullPageScreenshot),
          cropSha256: await sha256Hex(candidateCrop.bytes),
          yStart: Math.round(box.y),
          yEnd: Math.round(box.y + box.height),
          scale: 1,
          artifactR2Key: "",
          width: candidateCrop.width,
          height: candidateCrop.height,
        };
        pair.candidateBytes = candidateCrop.bytes;
      }
    }
    const referenceRegion = input.reference?.regions.find((region) => region.id === regionId);
    if (input.reference && referenceRegion && typeof referenceRegion.startY === "number" && typeof referenceRegion.endY === "number") {
      const scale = (await pngWidthOf(input.reference.screenshot)) / input.reference.cssViewportWidth;
      const referenceCrop = await cropPngBand(input.reference.screenshot, referenceRegion.startY * scale, referenceRegion.endY * scale);
      if (referenceCrop) {
        pair.reference = {
          sourceSha256: await sha256Hex(input.reference.screenshot),
          cropSha256: await sha256Hex(referenceCrop.bytes),
          yStart: Math.round(referenceRegion.startY),
          yEnd: Math.round(referenceRegion.endY),
          scale,
          artifactR2Key: "",
          width: referenceCrop.width,
          height: referenceCrop.height,
        };
        pair.referenceBytes = referenceCrop.bytes;
      }
    }
    crops.push(pair);
  }

  return { attempt, passed: findings.length === 0, findings, pageRepairable, directiveText, crops };
}

// Crop bytes ride the verdict object in memory between the preflight and the
// artifact store; they are not part of the stored JSON.
export interface RegionCropPair {
  regionId: string;
  reference: CropProvenance | null;
  candidate: CropProvenance | null;
  candidateBytes?: Uint8Array;
  referenceBytes?: Uint8Array;
}

async function pngWidthOf(png: Uint8Array): Promise<number> {
  if (png.length < 24) return 0;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return view.getUint32(16);
}

// Persists the crop pairs deterministically (issue #49 E): coordinates and
// hashes bind every crop to its immutable source; keys derive from
// build/version/attempt/region — never manual selection.
export async function storeCraftCrops(
  env: Env,
  input: { buildId: string; buildVersionNumber: number; attempt: number; crops: RegionCropPair[] }
): Promise<void> {
  for (const pair of input.crops) {
    if (pair.candidate && pair.candidateBytes) {
      const key = buildVersionEvidenceKey(input.buildId, input.buildVersionNumber, `craft/attempt-${input.attempt}/${pair.regionId}-candidate.png`);
      await putImmutableObjectTolerant(env, key, pair.candidateBytes, { httpMetadata: { contentType: "image/png" } });
      pair.candidate.artifactR2Key = key;
    }
    if (pair.reference && pair.referenceBytes) {
      const key = buildVersionEvidenceKey(input.buildId, input.buildVersionNumber, `craft/attempt-${input.attempt}/${pair.regionId}-reference.png`);
      await putImmutableObjectTolerant(env, key, pair.referenceBytes, { httpMetadata: { contentType: "image/png" } });
      pair.reference.artifactR2Key = key;
    }
  }
}

// The stored verdict: crops keep provenance (hashes/coordinates/keys) but not
// the bytes themselves.
export interface StoredCraftPreflight {
  attempt: number;
  passed: boolean;
  findings: CraftFinding[];
  pageRepairable: boolean;
  directiveText: string;
  crops: Array<{
    regionId: string;
    reference: CropProvenance | null;
    candidate: CropProvenance | null;
  }>;
}

export function storedVerdict(verdict: CraftPreflightVerdict): StoredCraftPreflight {
  return {
    attempt: verdict.attempt,
    passed: verdict.passed,
    findings: verdict.findings,
    pageRepairable: verdict.pageRepairable,
    directiveText: verdict.directiveText,
    crops: verdict.crops.map((pair) => ({
      regionId: pair.regionId,
      reference: pair.reference,
      candidate: pair.candidate,
    })),
  };
}
