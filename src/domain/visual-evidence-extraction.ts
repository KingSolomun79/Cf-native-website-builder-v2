// Deterministic screenshot-derived evidence extraction (issue #41).
//
// Pixels become measured facts BEFORE any AI interpretation: row-band
// segmentation of the canonical Reference Screenshot yields measured region
// bands (ratios, dominant surface colours, ink density), image-mass
// rectangles, surface sequence, container-width estimate and colour roles.
//
// This is ONE channel, not the entire evidence model: horizontal band
// segmentation cannot see overlaps, asymmetrical splits, floating cards or
// masked imagery — DOM/computed measurements (URL captures) remain the
// preferred channel and the two persist side by side in Reference Evidence.
// Every field the pixels cannot support is UNKNOWN (null/absent), never a
// fabricated default.

import { decodePng, downscaleRgb } from "../lib/png-codec";

export const SCREENSHOT_EXTRACTION_VERSION = "rowband-v1";

// Bounded analysis budget: sample width for row profiling and the pixel
// ceiling beyond which decoding is refused (bounded worker memory).
const SAMPLE_WIDTH = 160;
const MAX_DECODE_PIXELS = 40_000_000;
// Minimum dimensions for band analysis to be meaningful (a real page
// screenshot exceeds these; anything smaller carries no design structure).
const MIN_ANALYSIS_WIDTH = 320;
const MIN_ANALYSIS_HEIGHT = 400;

export interface ExtractionBand {
  id: string;
  startY: number;
  endY: number;
  height: number;
  viewportHeightRatio: number;
  /** Quantized dominant surface colour, rgb(r, g, b). */
  dominantColour: string;
  /** 0-255 mean perceived luminance. */
  luminance: number;
  /** Fraction of sampled pixels that deviate from the band surface. */
  inkDensity: number;
  bandClass: "surface" | "content" | "image-mass";
}

export interface ExtractionImageMass {
  boundingBox: { x: number; y: number; width: number; height: number };
  density: number;
}

export interface ScreenshotExtraction {
  version: string;
  extractor: string;
  sourceArtifact: string;
  sourceSha256: string;
  coverage:
    | { decoded: true; width: number; height: number; sampledWidth: number }
    | { decoded: false; reason: string };
  bands: ExtractionBand[];
  imageMasses: ExtractionImageMass[];
  /** Ordered dominant surface colour per band. */
  surfaceSequence: string[];
  /** Estimated content container width / image width; UNKNOWN when no
   *  content or image-mass band exists. */
  containerWidthRatio: number | null;
  colourRoles: { background: string | null; accents: string[] };
  /** Aggregate image-mass share of page height; UNKNOWN when no image-mass
   *  band exists. */
  imageMassRatio: number | null;
}

function luminanceOf(r: number, g: number, b: number): number {
  return Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function quantize(r: number, g: number, b: number): string {
  // 16-level per channel quantization: stable colours, compact keys.
  const q = (v: number) => Math.min(255, Math.round(v / 16) * 16);
  return `rgb(${q(r)}, ${q(g)}, ${q(b)})`;
}

interface SampledRow {
  r: number;
  g: number;
  b: number;
  luma: number;
}

interface SampledImage {
  rows: SampledRow[];
  width: number;
  height: number;
  rgb: Uint8Array;
}

function sampleImage(png: { width: number; height: number; rgb: Uint8Array }, sampledWidth: number): SampledImage {
  const down = downscaleRgb(png, Math.min(png.width, sampledWidth));
  const rows: SampledRow[] = [];
  for (let y = 0; y < down.height; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < down.width; x++) {
      const at = (y * down.width + x) * 3;
      r += down.rgb[at];
      g += down.rgb[at + 1];
      b += down.rgb[at + 2];
    }
    const n = down.width;
    const mr = r / n;
    const mg = g / n;
    const mb = b / n;
    rows.push({ r: mr, g: mg, b: mb, luma: luminanceOf(mr, mg, mb) });
  }
  return { rows, width: down.width, height: down.height, rgb: down.rgb };
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function extractScreenshotEvidence(
  bytes: Uint8Array,
  sourceArtifact: string
): Promise<ScreenshotExtraction> {
  const sourceSha256 = await sha256HexBytes(bytes);
  const base: ScreenshotExtraction = {
    version: SCREENSHOT_EXTRACTION_VERSION,
    extractor: SCREENSHOT_EXTRACTION_VERSION,
    sourceArtifact,
    sourceSha256,
    coverage: { decoded: false, reason: "not analyzed" },
    bands: [],
    imageMasses: [],
    surfaceSequence: [],
    containerWidthRatio: null,
    colourRoles: { background: null, accents: [] },
    imageMassRatio: null,
  };

  // Header-level guards before any pixel work.
  if (bytes.length < 8 || bytes[0] !== 0x89) {
    return { ...base, coverage: { decoded: false, reason: "not a PNG (bad signature)" } };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredWidth = view.getUint32(16, false);
  const declaredHeight = view.getUint32(20, false);
  if (declaredWidth * declaredHeight > MAX_DECODE_PIXELS) {
    return { ...base, coverage: { decoded: false, reason: "image too large to decode within bounded worker memory" } };
  }
  if (declaredWidth < MIN_ANALYSIS_WIDTH || declaredHeight < MIN_ANALYSIS_HEIGHT) {
    return {
      ...base,
      coverage: {
        decoded: false,
        reason: `screenshot too small to carry design structure (${declaredWidth}x${declaredHeight}; extraction not applicable)`,
      },
    };
  }

  const decoded = await decodePng(bytes);
  if (!decoded.ok) {
    return { ...base, coverage: { decoded: false, reason: decoded.reason } };
  }
  const png = decoded.png;
  const sampled = sampleImage(png, SAMPLE_WIDTH);
  const rows = sampled.rows;

  // Row-colour boundary detection: two-sided window contrast — the distance
  // between the mean luma BEFORE and AFTER each row. Unlike smoothing one
  // side, a two-sided window preserves the full step height at a surface
  // change instead of smearing it across the window.
  const luma = rows.map((row) => row.luma);
  const sideMean = (from: number, to: number): number => {
    const lo = Math.max(0, from);
    const hi = Math.min(luma.length, to);
    if (hi <= lo) return luma[Math.max(0, Math.min(luma.length - 1, lo))];
    let sum = 0;
    for (let y = lo; y < hi; y++) sum += luma[y];
    return sum / (hi - lo);
  };
  const window = 2;
  const boundaries: number[] = [0];
  for (let y = 1; y < rows.length; y++) {
    const before = sideMean(y - window, y);
    const after = sideMean(y, y + window);
    if (Math.abs(after - before) > 24) boundaries.push(y);
  }
  // Collapse boundaries closer than 1% of page height.
  const minGap = Math.max(2, Math.round(rows.length * 0.01));
  const edges: number[] = [];
  for (const boundary of boundaries) {
    if (edges.length === 0 || boundary - edges[edges.length - 1] >= minGap) edges.push(boundary);
  }
  edges.push(rows.length);

  const rowScale = png.height / rows.length;
  const bands: ExtractionBand[] = [];
  for (let e = 0; e < edges.length - 1; e++) {
    const from = edges[e];
    const to = edges[e + 1];
    if (to - from < Math.max(2, Math.round(rows.length * 0.02))) continue;
    // Dominant colour: mean of the row means (smoothed by sampling already).
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = from; y < to; y++) {
      r += rows[y].r;
      g += rows[y].g;
      b += rows[y].b;
    }
    const n = to - from;
    const mr = Math.round(r / n);
    const mg = Math.round(g / n);
    const mb = Math.round(b / n);
    // Ink density is PIXEL-level at FULL resolution (deterministic stride
    // sampling): the share of pixels whose luma deviates materially from the
    // band's median row luma. Block-averaged sampling would smooth texture
    // away; a full-band photograph with a stable mean (uniform texture) must
    // still read as image mass.
    const rowLumas = rows.slice(from, to).map((row) => row.luma).sort((a, b) => a - b);
    const bandLuma = rowLumas[Math.floor(rowLumas.length / 2)];
    let inkedPixels = 0;
    let totalPixels = 0;
    const yStart = Math.min(png.height - 1, Math.round(from * rowScale));
    const yEnd = Math.min(png.height, Math.round(to * rowScale));
    for (let y = yStart; y < yEnd; y += 2) {
      for (let x = 0; x < png.width; x += 3) {
        const at = (y * png.width + x) * 3;
        const luma = luminanceOf(png.rgb[at], png.rgb[at + 1], png.rgb[at + 2]);
        totalPixels += 1;
        if (Math.abs(luma - bandLuma) > 32) inkedPixels += 1;
      }
    }
    const inkDensity = totalPixels === 0 ? 0 : inkedPixels / totalPixels;
    const bandClass: ExtractionBand["bandClass"] = inkDensity > 0.45 ? "image-mass" : inkDensity > 0.12 ? "content" : "surface";
    bands.push({
      id: `shot-band-${bands.length + 1}`,
      startY: Math.round(from * rowScale),
      endY: Math.round(to * rowScale),
      height: Math.round((to - from) * rowScale),
      viewportHeightRatio: Number(((to - from) * rowScale / 900).toFixed(3)),
      dominantColour: quantize(mr, mg, mb),
      luminance: bandLuma,
      inkDensity: Number(inkDensity.toFixed(3)),
      bandClass,
    });
  }

  // Image masses: merge contiguous image-mass bands.
  const imageMasses: ExtractionImageMass[] = [];
  let run: ExtractionBand[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const startY = run[0].startY;
    const endY = run[run.length - 1].endY;
    imageMasses.push({
      boundingBox: { x: 0, y: startY, width: png.width, height: endY - startY },
      density: Number((run.reduce((sum, band) => sum + band.inkDensity, 0) / run.length).toFixed(3)),
    });
    run = [];
  };
  for (const band of bands) {
    if (band.bandClass === "image-mass") run.push(band);
    else flushRun();
  }
  flushRun();

  // Colour roles: background = dominant colour across surface bands (or the
  // overall mode); accents = distinct quantized colours far from background.
  const counts = new Map<string, number>();
  for (const band of bands) counts.set(band.dominantColour, (counts.get(band.dominantColour) ?? 0) + band.height);
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const background = ordered[0]?.[0] ?? null;
  const accents = ordered
    .slice(1)
    .filter(([colour, height]) => height / Math.max(1, png.height) > 0.04)
    .map(([colour]) => colour)
    .slice(0, 5);

  // Container estimate: mean horizontal extent of non-surface pixels per
  // content band is not available at this sampling fidelity; carry UNKNOWN
  // unless an image-mass band provides a full-bleed reference. Measured
  // container geometry comes from the DOM channel when a URL exists.
  const imageMassRatio = bands.some((band) => band.bandClass === "image-mass")
    ? Number((bands.filter((band) => band.bandClass === "image-mass").reduce((sum, band) => sum + band.height, 0) / png.height).toFixed(3))
    : null;

  return {
    ...base,
    coverage: { decoded: true, width: png.width, height: png.height, sampledWidth: Math.min(png.width, SAMPLE_WIDTH) },
    bands,
    imageMasses,
    surfaceSequence: bands.map((band) => band.dominantColour),
    containerWidthRatio: null,
    colourRoles: { background, accents },
    imageMassRatio,
  };
}
