import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn } from "../src/domain/reference-intake";
import { encodePng, decodePng, downscaleRgb } from "../src/lib/png-codec";
import { extractScreenshotEvidence } from "../src/domain/visual-evidence-extraction";
import { compareGeometry, geometryFromRegions, type GeometryProfile } from "../src/domain/qa-evidence";
import { getObject, putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

// Issue #41 — Reference Visual Package + deterministic evidence extraction:
// pixels become measured facts before any AI interpretation; normalized
// visual inputs are hashed and persisted; missing measurements are UNKNOWN —
// never fabricated defaults; an unmeasured reference can no longer produce a
// similarity score.

const env = providedEnv as unknown as Env;

async function structuredPagePng(): Promise<Uint8Array> {
  // 1024x1560 synthetic page: paper hero band, photo-textured band, ink band
  // (tallest band -> dominant background). Photo texture keeps a stable row
  // mean but a wide pixel-level luma spread, like real photography.
  const width = 1024;
  const height = 1560;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      if (y < 560) {
        rgb[at] = 245;
        rgb[at + 1] = 242;
        rgb[at + 2] = 235;
      } else if (y < 940) {
        const wave = (x * 5 + y * 11) % 80;
        rgb[at] = 40 + wave;
        rgb[at + 1] = 40 + ((wave * 2) % 170);
        rgb[at + 2] = 40 + wave;
      } else {
        rgb[at] = 26;
        rgb[at + 1] = 26;
        rgb[at + 2] = 26;
      }
    }
  }
  return encodePng({ width, height, rgb });
}

describe("PNG codec round trip (issue #41)", () => {
  it("decodes what it encodes, byte-stable pixels", async () => {
    const original = await structuredPagePng();
    const decoded = await decodePng(original);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.png.width).toBe(1024);
    expect(decoded.png.height).toBe(1560);
    // Re-encode the decoded pixels and decode again — identical buffer.
    const reencoded = await encodePng(decoded.png);
    const decodedAgain = await decodePng(reencoded);
    expect(decodedAgain.ok).toBe(true);
    if (!decodedAgain.ok) return;
    expect(Buffer.from(decodedAgain.png.rgb).equals(Buffer.from(decoded.png.rgb))).toBe(true);
  });

  it("downscales by block average with preserved aspect ratio", async () => {
    const decoded = await decodePng(await structuredPagePng());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const down = downscaleRgb(decoded.png, 160);
    expect(down.width).toBe(160);
    expect(down.height).toBe(244);
    expect(down.rgb.length).toBe(160 * down.height * 3);
  });
});

describe("deterministic screenshot extraction (issue #41)", () => {
  it("extracts measured bands, image masses, surface sequence and colour roles", async () => {
    const extraction = await extractScreenshotEvidence(await structuredPagePng(), "reference/screenshot.png");
    expect(extraction.coverage).toMatchObject({ decoded: true, width: 1024, height: 1560 });
    expect(extraction.bands.length).toBeGreaterThanOrEqual(3);
    const classes = extraction.bands.map((band) => band.bandClass);
    expect(classes).toContain("image-mass");
    expect(classes).toContain("surface");
    // Photo band detected as mass with pixel-level density.
    const mass = extraction.bands.filter((band) => band.bandClass === "image-mass");
    expect(mass.every((band) => band.inkDensity > 0.5)).toBe(true);
    expect(extraction.imageMasses.length).toBeGreaterThanOrEqual(1);
    expect(extraction.surfaceSequence).toHaveLength(extraction.bands.length);
    expect(extraction.colourRoles.background).toBe("rgb(32, 32, 32)");
    expect(extraction.colourRoles.accents.length).toBeGreaterThanOrEqual(2);
    expect(extraction.imageMassRatio).not.toBeNull();
    // Viewport ratios sum to roughly the page height in 900px viewports.
    const ratioSum = extraction.bands.reduce((sum, band) => sum + band.viewportHeightRatio, 0);
    expect(ratioSum).toBeGreaterThan(1.4);
    expect(ratioSum).toBeLessThan(2.0);
    // Deterministic: same input, same output.
    const again = await extractScreenshotEvidence(await structuredPagePng(), "reference/screenshot.png");
    expect(again).toEqual(extraction);
  });

  it("records decoded:false with a reason for undecodable pixels — never fabricated bands", async () => {
    // Header-valid PNG whose IDAT payload is not decodable pixel data
    // (the classic structural-fixture shape from tests/helpers/png).
    const extraction = await extractScreenshotEvidence(new Uint8Array(buildPng({ width: 1200, height: 3000, idatBytes: 64 })), "reference/screenshot.png");
    expect(extraction.coverage.decoded).toBe(false);
    if (!extraction.coverage.decoded) expect(extraction.coverage.reason).toContain("decodable");
    expect(extraction.bands).toEqual([]);
    expect(extraction.imageMassRatio).toBeNull();
  });

  it("refuses extraction on screenshots too small to carry design structure", async () => {
    const tiny = await encodePng({ width: 100, height: 100, rgb: new Uint8Array(100 * 100 * 3).fill(200) });
    const extraction = await extractScreenshotEvidence(tiny, "reference/screenshot.png");
    expect(extraction.coverage.decoded).toBe(false);
    if (!extraction.coverage.decoded) expect(extraction.coverage.reason).toContain("too small");
    expect(extraction.bands).toEqual([]);
  });
});

// ── Comparator truthfulness ───────────────────────────────────────────────────

describe("geometry comparator truthfulness (issue #41)", () => {
  const fullCandidate: GeometryProfile = {
    regionOrder: ["hero", "gallery", "services", "footer-cta"],
    firstViewportHeightRatio: 0.92,
    sectionHeightRatios: [1, 0.8, 0.9, 0.5],
    imageMassRatio: 0.3,
    containerWidthRatio: 0.8,
    columnRatios: [5 / 7],
    dominantAlignment: "asymmetric",
    surfaceSequence: ["paper", "ink", "paper"],
    whitespaceRatio: 0.2,
  };

  it("an empty reference profile yields INSUFFICIENT_REFERENCE_EVIDENCE, never a similarity score", () => {
    // The exact RankForge failure shape: reference side with zero measured
    // regions used to pass vacuously against fabricated constants.
    const emptyReference = geometryFromRegions([], null);
    const comparison = compareGeometry(emptyReference, fullCandidate);
    expect(comparison.status).toBe("INSUFFICIENT_REFERENCE_EVIDENCE");
    expect(comparison.similarityScore).toBeNull();
    expect(comparison.measuredCoverage).toBe(0);
    expect(comparison.metrics).toEqual([]);
  });

  it("emits a similarity percentage only over metrics both sides actually measured", () => {
    const reference = geometryFromRegions(
      [
        { id: "hero", height: 990, viewportHeightRatio: 1.1 },
        { id: "gallery", height: 720, viewportHeightRatio: 0.8 },
        { id: "services", height: 810, viewportHeightRatio: 0.9 },
        { id: "footer-cta", height: 450, viewportHeightRatio: 0.5 },
      ],
      0.28
    );
    const comparison = compareGeometry(reference, fullCandidate);
    expect(comparison.status).toBe("MEASURED");
    // Only region_count, region_order, first_viewport and image_mass are
    // measured on both sides; the rest stay UNKNOWN instead of constants.
    expect(comparison.metrics.map((metric) => metric.id).sort()).toEqual([
      "first_viewport_height_ratio",
      "image_mass_ratio",
      "region_count",
      "region_order",
    ]);
    expect(comparison.measuredCoverage).toBeCloseTo(4 / 8, 3);
    expect(comparison.similarityScore).not.toBeNull();
  });

  it("geometryFromRegions carries UNKNOWN instead of 0.9/0.83/0.22/asymmetric", () => {
    const profile = geometryFromRegions([{ id: "r1", height: 900, viewportHeightRatio: 1 }], null);
    expect(profile.firstViewportHeightRatio).toBe(1);
    expect(profile.containerWidthRatio).toBeNull();
    expect(profile.whitespaceRatio).toBeNull();
    expect(profile.dominantAlignment).toBeNull();
    expect(profile.surfaceSequence).toEqual([]);
    expect(profile.imageMassRatio).toBeNull();
  });
});

// ── Intake integration: screenshot-only + extraction = valid ─────────────────

const noopCapture: ReferenceCaptureFn = async () => {
  throw new Error("capture must not run for screenshot-only input");
};

describe("Reference Visual Package at intake (issue #41)", () => {
  it("freezes extracted bands as regions, persists the package and passes the sufficiency gate", async () => {
    const screenshotKey = `references/uploads/vis-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, await structuredPagePng());
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Visual Package Co", contactEmail: "vp@visual.example" },
        reference: { screenshotR2Key: screenshotKey },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const frozen = await runReferenceIntake(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      capture: noopCapture,
    });

    // Screenshot-only + useful extracted evidence = VALID (issue #39 mapping).
    expect(frozen.evidenceSufficiency.sufficiency).toBe("SUFFICIENT");

    const read = await getFrozenReferenceEvidence(env, started.siteGenerationId);
    expect(read!.evidence.version).toBe("2");
    // Extracted bands became the measured region structure.
    expect(read!.evidence.regions.length).toBeGreaterThanOrEqual(3);
    expect(read!.evidence.regions.every((region) => region.id.startsWith("shot-band-"))).toBe(true);
    // The extraction channel + normalized visual inputs are frozen with the package.
    expect(read!.evidence.extraction?.coverage.decoded).toBe(true);
    expect(read!.evidence.visualInputs!.length).toBeGreaterThanOrEqual(1);
    // Measured surface-band entries carry pixel-level facts.
    const surfaceBands = read!.evidence.measuredElements.filter((element) => element.role?.startsWith("surface-band:"));
    expect(surfaceBands.length).toBeGreaterThanOrEqual(3);

    // The normalized full-page visual input exists in R2 and its hash matches.
    const visualInput = read!.evidence.visualInputs!.find((input) => input.kind === "full-page")!;
    const stored = await getObject(env, visualInput.artifact);
    expect(stored).not.toBeNull();
    const storedBytes = new Uint8Array(await new Response(stored!).arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", storedBytes);
    const sha = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(sha).toBe(visualInput.sha256);
  });
});
