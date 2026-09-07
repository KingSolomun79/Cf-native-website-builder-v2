import { describe, expect, it } from "vitest";
import {
  resolveReferenceGeometry,
  unmappedHeightFindingRegions,
  type ReferenceGeometryPackage,
  type CanonicalRegionGeometry,
} from "../src/domain/reference-geometry";
import { canonicalRegionComposition } from "../src/domain/visual-blueprint";
import { runCraftPreflight, type CraftCapture } from "../src/domain/craft-preflight";
import { encodePng } from "../src/lib/png-codec";
import type { ReferenceEvidence } from "../src/domain/reference-evidence-schema";
import {
  FIXTURE_REFERENCE_REGIONS,
  FIXTURE_BLUEPRINT_PROVENANCE,
  FIXTURE_CANDIDATE_CRAFT_LAYOUT,
} from "./_generated-craft-repair-fixture";

// Issue #65 — canonical Reference region measurement contract.
//
// Production Build 282f9b9d (2026-09-07) proved the old chain measured
// candidate regions against a broken reference side: scrolled-capture DOM
// coordinates never normalized into the screenshot's page space, overlapping
// evidence bands double-counted into inflated targets, the Blueprint's
// shifted provenance went undetected, and craft reference crops resolved by
// canonical ids against raw evidence ids (silently NULL) while the repair
// prompt claimed reference+candidate pairs were attached. These tests derive
// the corrected behavior from the FROZEN production fixtures — never from
// hardcoded forensic conclusions.

const FIXTURE_REGIONS = FIXTURE_REFERENCE_REGIONS.regions as ReferenceEvidence["regions"];

function fixtureEvidence(overrides?: Partial<ReferenceEvidence>): ReferenceEvidence {
  return {
    version: "2",
    screenshotId: "fixtures/craft-repair-2026-09-07/reference-screenshot.png",
    screenshotMetadata: {
      pixelHeight: FIXTURE_REFERENCE_REGIONS.screenshotHeight,
      likelyCssViewportWidth: FIXTURE_REFERENCE_REGIONS.likelyCssViewportWidth,
    },
    captures: [{ viewportWidth: 1440, viewportHeight: 900, screenshotArtifact: "fixtures/craft-repair-2026-09-07/reference-screenshot.png" }],
    regions: FIXTURE_REGIONS,
    measuredElements: [],
    responsiveObservations: [],
    motionObservations: [],
    discrepancies: [],
    ...overrides,
  };
}

function fixtureBlueprint() {
  return { homepageRegions: FIXTURE_BLUEPRINT_PROVENANCE.homepageRegions };
}

function regionOf(geometry: ReferenceGeometryPackage, regionId: string): CanonicalRegionGeometry {
  const region = geometry.regions.find((candidate) => candidate.regionId === regionId);
  if (!region) throw new Error(`fixture geometry is missing canonical region '${regionId}'`);
  return region;
}

describe("reference geometry mapping authority (issue #65)", () => {
  it("recovers the frozen scrolled-capture space into validated page space", () => {
    const geometry = resolveReferenceGeometry({ blueprint: fixtureBlueprint(), evidence: fixtureEvidence() });
    expect(geometry.transform.kind).toBe("recovered");
    expect(geometry.transform.offsetPx).toBe(1600);
    expect(geometry.transform.verified).toBe(true);
    expect(geometry.screenshotHeightPx).toBe(FIXTURE_REFERENCE_REGIONS.screenshotHeight);
    expect(geometry.viewportHeightPx).not.toBeNull();
    expect(geometry.viewportHeightPx!).toBeGreaterThan(880);
    expect(geometry.viewportHeightPx!).toBeLessThan(920);
  });

  it("unions overlapping evidence bands instead of double counting them", () => {
    const geometry = resolveReferenceGeometry({ blueprint: fixtureBlueprint(), evidence: fixtureEvidence() });
    // region_intro_trust claims region-3 (-636..234) + region-4 (34..664):
    // translated 964..1834 and 1634..2264 — overlapping. The old sum produced
    // 1500px (1.667vh); the union is 964..2264 = 1300px.
    const intro = regionOf(geometry, "region_intro_trust");
    expect(intro.status).toBe("MEASURED");
    expect(intro.slices).toEqual([{ startY: 964, endY: 2264 }]);
    expect(intro.referenceHeightPx).toBe(1300);
    expect(intro.referenceViewportRatio).toBeCloseTo(1.444, 2);
    // region_hero claims region-0/1/2: 0..143 nested inside 0..964, plus a
    // stray floating-nav band 1649..1674 — union with an honest gap.
    const hero = regionOf(geometry, "region_hero");
    expect(hero.slices).toEqual([
      { startY: 0, endY: 964 },
      { startY: 1649, endY: 1674 },
    ]);
    expect(hero.referenceHeightPx).toBe(989);
  });

  it("detects the frozen shifted mapping by source-order inversion and fails closed", () => {
    const geometry = resolveReferenceGeometry({ blueprint: fixtureBlueprint(), evidence: fixtureEvidence() });
    // Production provenance: editorial_split claims region-6 (evidence index
    // 6) while services claims region-5 (index 5) — services sits LATER in
    // canonical order but EARLIER in evidence order.
    const editorial = regionOf(geometry, "region_editorial_split");
    const services = regionOf(geometry, "region_services");
    expect(editorial.status).toBe("AMBIGUOUS");
    expect(editorial.reason).toContain("inverts canonical order");
    expect(services.status).toBe("AMBIGUOUS");
    expect(editorial.referenceViewportRatio).toBeNull();
    expect(services.referenceViewportRatio).toBeNull();
    // The remaining ordered provenance stays measurable.
    for (const regionId of ["region_hero", "region_intro_trust", "region_process", "region_mid_content", "region_testimonial_break", "region_closing_cta"]) {
      expect(regionOf(geometry, regionId).status).toBe("MEASURED");
    }
    expect(geometry.status).toBe("AMBIGUOUS");
  });

  it("a recorded captureScrollY normalizes equivalently to recovery", () => {
    const geometry = resolveReferenceGeometry({
      blueprint: fixtureBlueprint(),
      evidence: fixtureEvidence({ captureScrollY: 1600 }),
    });
    expect(geometry.transform.kind).toBe("recorded");
    expect(geometry.transform.offsetPx).toBe(1600);
    expect(geometry.transform.verified).toBe(true);
    const intro = regionOf(geometry, "region_intro_trust");
    expect(intro.referenceHeightPx).toBe(1300);
  });

  it("an unknown evidence region id fails closed", () => {
    const geometry = resolveReferenceGeometry({
      blueprint: { homepageRegions: [{ id: "region_a", purpose: "top band", sourceEvidenceRegionIds: ["region-0"] }, { id: "region_b", purpose: "bottom band", sourceEvidenceRegionIds: ["region-missing"] }] },
      evidence: fixtureEvidence({
        regions: [
          { id: "region-0", startY: 0, endY: 500, height: 500, viewportHeightRatio: 0.55 },
        ],
      }),
    });
    const b = regionOf(geometry, "region_b");
    expect(b.status).toBe("AMBIGUOUS");
    expect(b.reason).toContain("unknown evidence region id");
    expect(regionOf(geometry, "region_a").status).toBe("MEASURED");
  });

  it("a coordinate space contradicted by the screenshot height fails closed", () => {
    const geometry = resolveReferenceGeometry({
      blueprint: { homepageRegions: [{ id: "region_a", purpose: "band", sourceEvidenceRegionIds: ["region-0"] }] },
      evidence: fixtureEvidence({
        regions: [{ id: "region-0", startY: -100, endY: 100, height: 200, viewportHeightRatio: 0.22 }],
        extraction: {
          version: "rowband-v1",
          extractor: "rowband-v1",
          sourceArtifact: "fixtures/reference-screenshot.png",
          sourceSha256: "fixture-sha",
          coverage: { decoded: true, width: 1440, height: 5000, sampledWidth: 160 },
          bands: [],
          imageMasses: [],
          surfaceSequence: [],
          containerWidthRatio: null,
          colourRoles: { background: null, accents: [] },
          imageMassRatio: null,
        },
      }),
    });
    expect(geometry.transform.kind).toBe("recovered");
    expect(geometry.transform.verified).toBe(false);
    expect(regionOf(geometry, "region_a").status).toBe("AMBIGUOUS");
  });

  it("non-contiguous sources become ordered slices and never invent gap mass", () => {
    const geometry = resolveReferenceGeometry({
      blueprint: { homepageRegions: [{ id: "region_split", purpose: "two separated bands", sourceEvidenceRegionIds: ["region-0", "region-1"] }] },
      evidence: fixtureEvidence({
        regions: [
          { id: "region-0", startY: 100, endY: 400, height: 300, viewportHeightRatio: 0.33 },
          { id: "region-1", startY: 900, endY: 1200, height: 300, viewportHeightRatio: 0.33 },
        ],
      }),
    });
    const split = regionOf(geometry, "region_split");
    expect(split.status).toBe("MEASURED");
    expect(split.slices).toEqual([
      { startY: 100, endY: 400 },
      { startY: 900, endY: 1200 },
    ]);
    expect(split.referenceHeightPx).toBe(600);
  });

  it("canonicalRegionComposition delegates to the union authority and keeps a legacy sum path", () => {
    const blueprint = fixtureBlueprint() as Parameters<typeof canonicalRegionComposition>[0];
    const union = canonicalRegionComposition(blueprint, FIXTURE_REGIONS);
    const intro = union.find((region) => region.regionId === "region_intro_trust")!;
    expect(intro.viewportHeightRatio).toBeCloseTo(1.444, 2);
    expect(intro.status).toBe("MEASURED");
    const services = union.find((region) => region.regionId === "region_services")!;
    expect(services.status).toBe("AMBIGUOUS");
    expect(services.viewportHeightRatio).toBeNull();

    // Coordinate-free evidence keeps the documented legacy summation.
    const legacy = canonicalRegionComposition(
      { homepageRegions: [{ id: "region_a", purpose: "a", sourceEvidenceRegionIds: ["seg-0", "seg-1"] }] } as Parameters<typeof canonicalRegionComposition>[0],
      [
        { id: "seg-0", height: 300, viewportHeightRatio: 0.33 },
        { id: "seg-1", height: 400, viewportHeightRatio: 0.44 },
      ]
    );
    expect(legacy[0].status).toBe("MEASURED");
    expect(legacy[0].heightPx).toBe(700);
    expect(legacy[0].viewportHeightRatio).toBeCloseTo(0.77, 2);
  });

  it("the fail-closed repair gate refuses unmapped regions and reference-less crops", () => {
    const geometry = resolveReferenceGeometry({ blueprint: fixtureBlueprint(), evidence: fixtureEvidence() });
    const findings = [
      { checkId: "REGION_HEIGHT_DEVIATION", regionId: "region_process" },
      { checkId: "REGION_HEIGHT_DEVIATION", regionId: "region_editorial_split" },
      { checkId: "HEADLINE_CLIPPING", regionId: null },
    ];
    // Mapped region with a stored reference crop: allowed.
    expect(
      unmappedHeightFindingRegions(findings, geometry, [{ regionId: "region_process", referenceSlices: [{ artifactR2Key: "builds/x.png" }] }])
    ).toEqual(["region_editorial_split: REFERENCE_REGION_MAPPING_AMBIGUOUS"]);
    // Mapped region whose crop never materialized: refused.
    expect(
      unmappedHeightFindingRegions([{ checkId: "REGION_HEIGHT_DEVIATION", regionId: "region_process" }], geometry, [
        { regionId: "region_process", referenceSlices: [] },
      ])
    ).toEqual(["region_process: REFERENCE_CROP_UNAVAILABLE"]);
    // No height findings: nothing to refuse.
    expect(unmappedHeightFindingRegions([{ checkId: "HEADLINE_CLIPPING", regionId: null }], geometry, [])).toEqual([]);
  });
});

describe("frozen seven-finding recomputation under the corrected mapping (issue #65 §10)", () => {
  const geometry = resolveReferenceGeometry({ blueprint: fixtureBlueprint(), evidence: fixtureEvidence() });
  const measuredTargets = geometry.regions
    .filter((region) => region.status === "MEASURED" && region.referenceViewportRatio !== null)
    .map((region) => ({ regionId: region.regionId, viewportHeightRatio: region.referenceViewportRatio! }));

  const layout = FIXTURE_CANDIDATE_CRAFT_LAYOUT;
  const craftCapture: CraftCapture = {
    viewportWidth: layout.viewportWidth,
    viewportHeight: layout.viewportHeight,
    fullPageScreenshot: new TextEncoder().encode("fixture-capture"),
    layout: {
      finalUrl: "https://b-282f9b9de6-v1.wazibizwebsites.workers.dev/",
      title: "RankForge Kenya",
      lang: "en",
      description: null,
      viewportMeta: "width=device-width, initial-scale=1",
      sections: layout.sections.map((section, order) => ({
        order,
        tag: "section",
        role: null,
        heading: null,
        text: null,
        bounds: { x: 0, y: section.y, width: section.width, height: section.height },
        evidenceId: null,
        dataRegion: section.dataRegion,
      })),
      typography: [],
      colors: { background: "rgb(249,250,251)", text: "rgb(55,65,81)", accents: [] },
      nav: [],
      images: layout.images.map((image) => ({
        src: `assets/images/${image.imageId}.webp`,
        alt: "",
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayedWidth: image.displayedWidth,
        displayedHeight: image.displayedHeight,
        boundsY: 0,
        inMain: true,
        evidenceId: null,
        regionId: image.regionId,
        imageId: image.imageId,
      })),
      spacing: null,
      contrastSamples: [],
      consentDetected: false,
      headline: {
        text: layout.headline.text,
        fontFamily: "Figtree",
        fontSize: layout.headline.fontSize,
        bounds: { x: layout.headline.x, y: layout.headline.y, width: layout.headline.width, height: layout.headline.height },
      },
      viewportHeight: layout.viewportHeight,
      viewportWidth: layout.viewportWidth,
    },
  };

  it("derives the corrected findings from the frozen evidence — not from the forensic conclusion", async () => {
    const verdict = await runCraftPreflight(
      {
        capture: craftCapture,
        blueprint: { homepageRegions: FIXTURE_BLUEPRINT_PROVENANCE.homepageRegions, homepageFirstViewport: { summary: "", regionIds: ["region_hero"] } },
        contract: { realization: { regionStyleBinding: [] } } as Parameters<typeof runCraftPreflight>[0]["contract"],
        slots: [
          {
            id: "home-region_services",
            page: "home",
            regionId: "region_services",
            semanticRole: "services field supporting image",
            blueprintRole: "role-detail",
            priority: "HIGH",
            orientation: "square",
            negativeSpaceForText: false,
          },
        ],
        compositionTargets: measuredTargets,
        referenceImageMassRatio: null,
        reference: null,
      },
      1
    );

    const heightFindings = verdict.findings.filter((finding) => finding.checkId === "REGION_HEIGHT_DEVIATION");
    const heightRegionIds = heightFindings.map((finding) => finding.regionId).sort();
    // The shifted editorial_split/services mapping produces NO numeric target,
    // so its bogus height finding is gone; the measured regions still compare.
    expect(heightRegionIds).toEqual(["region_intro_trust", "region_mid_content", "region_process", "region_testimonial_break"]);
    // The corrected intro target is the UNION (1.444), not the double-counted 1.667.
    const introFinding = heightFindings.find((finding) => finding.regionId === "region_intro_trust")!;
    expect(introFinding.target).toContain("1.444");
    expect(verdict.directiveText).toContain("1.444");
    expect(verdict.directiveText).not.toContain("1.667");
    // The two genuine realization defects survive the corrected mapping.
    expect(verdict.findings.some((finding) => finding.checkId === "HEADLINE_CLIPPING")).toBe(true);
    const imageFinding = verdict.findings.find((finding) => finding.checkId === "IMAGE_ROLE_REALIZATION");
    expect(imageFinding).toBeDefined();
    expect(imageFinding!.detail).toContain("72x72");
  });

  it("produces provenance-bound reference slice crops from the normalized intervals", async () => {
    const screenshotHeight = FIXTURE_REFERENCE_REGIONS.screenshotHeight;
    const downscale = 10; // encode a 144x766 proxy of the 1440x7660 screenshot
    const width = 144;
    const height = Math.round(screenshotHeight / downscale);
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 964 / downscale; y < 2264 / downscale; y++) {
      for (let x = 0; x < width; x++) {
        const at = (Math.floor(y) * width + x) * 3;
        rgb[at] = 200;
        rgb[at + 1] = 40;
        rgb[at + 2] = 120;
      }
    }
    const screenshot = await encodePng({ width, height, rgb });
    // Candidate crops cut the capture at CSS-pixel scale, so the candidate
    // proxy must span the intro band (1024..1585): 144x1700 suffices.
    const candidateRgb = new Uint8Array(144 * 1700 * 3);
    const candidateScreenshot = await encodePng({ width: 144, height: 1700, rgb: candidateRgb });
    const candidateCapture: CraftCapture = { ...craftCapture, fullPageScreenshot: candidateScreenshot };
    const verdict = await runCraftPreflight(
      {
        capture: candidateCapture,
        blueprint: { homepageRegions: FIXTURE_BLUEPRINT_PROVENANCE.homepageRegions, homepageFirstViewport: { summary: "", regionIds: ["region_hero"] } },
        contract: { realization: { regionStyleBinding: [] } } as Parameters<typeof runCraftPreflight>[0]["contract"],
        slots: [],
        compositionTargets: measuredTargets,
        referenceImageMassRatio: null,
        reference: {
          screenshot,
          cssViewportWidth: 1440,
          regions: [
            {
              id: "region_intro_trust",
              slices: [{ startY: 964, endY: 2264 }],
            },
          ],
        },
      },
      1
    );
    const pair = verdict.crops.find((crop) => crop.regionId === "region_intro_trust");
    expect(pair).toBeDefined();
    expect(pair!.candidate).not.toBeNull();
    expect(pair!.referenceSlices).toHaveLength(1);
    const slice = pair!.referenceSlices[0];
    expect(slice.yStart).toBe(964);
    expect(slice.yEnd).toBe(2264);
    // The reference crop is cut at the screenshot's own scale (0.1 proxy).
    expect(slice.width).toBe(width);
    expect(slice.height).toBeCloseTo((2264 - 964) / downscale, 0);
    expect(slice.cropSha256).toBeTruthy();
    expect(pair!.reference!.cropSha256).toBe(slice.cropSha256);
  });
});
