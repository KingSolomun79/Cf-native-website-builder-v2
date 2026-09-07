import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import {
  resolveGeometryTransform,
  resolveReferenceGeometry,
  type ReferenceGeometryPackage,
  type CanonicalRegionGeometry,
} from "../src/domain/reference-geometry";
import type { ReferenceEvidence } from "../src/domain/reference-evidence-schema";
import { EXTRACT_LAYOUT_SCRIPT } from "../src/lib/browser-adapter";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureOutput } from "../src/domain/reference-intake";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";
import type { Env } from "../src/env.d";
import {
  FIXTURE_FRESH_CAPTURE_EVIDENCE,
  FIXTURE_FRESH_CAPTURE_BLUEPRINT,
} from "./_generated-fresh-capture-fixture";

// Issue #68 — explicit Reference coordinate-space contract.
//
// The 2026-09-07 fresh production run (Build 436c357a) recorded
// captureScrollY=1600 as provenance alongside region coordinates that ALREADY
// fit the 1440x7660 frozen screenshot exactly (span 0..7659), and the #65
// geometry transform applied the offset a second time — 1600..9259 against a
// 7660px screenshot — falsely failing every canonical region closed as
// REFERENCE_REGION_MAPPING_AMBIGUOUS. These tests pin the #68 contract:
// declared spaces are authoritative (PAGE_SPACE identity, VIEWPORT_SPACE
// single offset), legacy artifacts without the declaration resolve through
// deterministic inference that accepts ONLY a uniquely valid transform, and
// the fresh production fixture resolves MEASURED — never ambiguous.

const VIEWPORT_900 = 900;

function evidenceOf(overrides: Partial<ReferenceEvidence> & { regions: ReferenceEvidence["regions"] }): ReferenceEvidence {
  return {
    version: "2",
    screenshotId: "fixtures/coordinate-space/reference-screenshot.png",
    screenshotMetadata: { pixelHeight: 4000, likelyCssViewportWidth: 1440 },
    captures: [{ viewportWidth: 1440, viewportHeight: VIEWPORT_900, screenshotArtifact: "fixtures/coordinate-space/reference-screenshot.png" }],
    measuredElements: [],
    responsiveObservations: [],
    motionObservations: [],
    discrepancies: [],
    ...overrides,
  };
}

const TWO_REGIONS: ReferenceEvidence["regions"] = [
  { id: "region-0", startY: 3000, endY: 3900, height: 900, viewportHeightRatio: 1.0 },
  { id: "region-1", startY: 3900, endY: 3980, height: 80, viewportHeightRatio: 0.089 },
];

function blueprintClaiming(...ids: string[]) {
  return { homepageRegions: [{ id: "region_claim", purpose: "claimed bands", sourceEvidenceRegionIds: ids }] };
}

function geometryOf(evidence: ReferenceEvidence, blueprint = blueprintClaiming("region-0", "region-1")): ReferenceGeometryPackage {
  return resolveReferenceGeometry({ blueprint, evidence });
}

function claimRegion(geometry: ReferenceGeometryPackage): CanonicalRegionGeometry {
  return geometry.regions[0];
}

describe("explicit coordinate-space contract (issue #68)", () => {
  it("PAGE_SPACE evidence never reapplies captureScrollY — even at 1600", () => {
    const evidence = evidenceOf({
      coordinateSpace: "PAGE_SPACE",
      captureScrollY: 1600,
      regions: [
        { id: "region-0", startY: 0, endY: 964, height: 964, viewportHeightRatio: 1.071 },
        { id: "region-1", startY: 964, endY: 3960, height: 2996, viewportHeightRatio: 3.329 },
      ],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("identity");
    expect(transform.offsetPx).toBe(0);
    expect(transform.verified).toBe(true);
    expect(transform.basis).toContain("PAGE_SPACE");
    expect(spaceValid).toBe(true);

    const geometry = geometryOf(evidence, blueprintClaiming("region-0"));
    const claimed = claimRegion(geometry);
    expect(claimed.status).toBe("MEASURED");
    // The offset was NOT reapplied: the hero band normalizes to its frozen
    // coordinates exactly (0..964), not 1600..2564.
    expect(claimed.slices).toEqual([{ startY: 0, endY: 964 }]);
    expect(claimed.referenceHeightPx).toBe(964);
    expect(claimed.referenceViewportRatio).toBeCloseTo(964 / VIEWPORT_900, 3);
  });

  it("VIEWPORT_SPACE evidence applies captureScrollY exactly once", () => {
    const evidence = evidenceOf({
      coordinateSpace: "VIEWPORT_SPACE",
      captureScrollY: 1600,
      regions: [
        { id: "region-0", startY: -1600, endY: -636, height: 964, viewportHeightRatio: 1.071 },
        { id: "region-1", startY: -636, endY: 2360, height: 2996, viewportHeightRatio: 3.329 },
      ],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("recorded");
    expect(transform.offsetPx).toBe(1600);
    expect(transform.verified).toBe(true);
    expect(spaceValid).toBe(true);

    const geometry = geometryOf(evidence, blueprintClaiming("region-0"));
    const claimed = claimRegion(geometry);
    expect(claimed.status).toBe("MEASURED");
    expect(claimed.slices).toEqual([{ startY: 0, endY: 964 }]);
  });

  it("VIEWPORT_SPACE without a recorded captureScrollY fails closed", () => {
    const evidence = evidenceOf({
      coordinateSpace: "VIEWPORT_SPACE",
      regions: [{ id: "region-0", startY: -1600, endY: -636, height: 964, viewportHeightRatio: 1.071 }],
    });
    const { spaceValid, spaceError } = resolveGeometryTransform(evidence);
    expect(spaceValid).toBe(false);
    expect(spaceError).toContain("VIEWPORT_SPACE");
    const geometry = geometryOf(evidence, blueprintClaiming("region-0"));
    expect(claimRegion(geometry).status).toBe("AMBIGUOUS");
    expect(claimRegion(geometry).reason).toContain("VIEWPORT_SPACE evidence lacks");
  });

  it("PAGE_SPACE bands that contradict the frozen screenshot bounds fail closed per region", () => {
    // A mixed-space artifact (some bands left in another space) manifests as
    // coordinates that leave the screenshot. The declared space makes the
    // contradiction checkable: those bands are rejected, in-bounds bands stay
    // measurable.
    const evidence = evidenceOf({
      coordinateSpace: "PAGE_SPACE",
      captureScrollY: 300,
      regions: [
        { id: "region-0", startY: 200, endY: 3600, height: 3400, viewportHeightRatio: 3.778 },
        { id: "region-1", startY: 3600, endY: 5200, height: 1600, viewportHeightRatio: 1.778 },
      ],
    });
    const geometry = geometryOf(evidence);
    const claimed = claimRegion(geometry);
    expect(claimed.status).toBe("AMBIGUOUS");
    expect(claimed.reason).toContain("exceeds the frozen screenshot height 4000");
  });
});

describe("legacy compatibility inference (no declared coordinate space)", () => {
  it("selects identity when it is uniquely valid against the screenshot", () => {
    const evidence = evidenceOf({
      regions: [
        { id: "region-0", startY: 20, endY: 3900, height: 3880, viewportHeightRatio: 4.311 },
        { id: "region-1", startY: 3900, endY: 3960, height: 60, viewportHeightRatio: 0.067 },
      ],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("identity");
    expect(transform.offsetPx).toBe(0);
    expect(transform.verified).toBe(true);
    expect(spaceValid).toBe(true);
    expect(claimRegion(geometryOf(evidence)).status).toBe("MEASURED");
  });

  it("selects the recorded offset when identity cannot fit (legacy viewport-space coordinates)", () => {
    const evidence = evidenceOf({
      captureScrollY: 1600,
      regions: [
        { id: "region-0", startY: -1600, endY: -636, height: 964, viewportHeightRatio: 1.071 },
        { id: "region-1", startY: -636, endY: 2360, height: 2996, viewportHeightRatio: 3.329 },
      ],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("recorded");
    expect(transform.offsetPx).toBe(1600);
    expect(transform.verified).toBe(true);
    expect(spaceValid).toBe(true);
    expect(claimRegion(geometryOf(evidence, blueprintClaiming("region-0"))).slices).toEqual([{ startY: 0, endY: 964 }]);
  });

  it("selects the recovered offset for negative legacy evidence without captureScrollY", () => {
    const evidence = evidenceOf({
      regions: [
        { id: "region-0", startY: -1600, endY: -636, height: 964, viewportHeightRatio: 1.071 },
        { id: "region-1", startY: -636, endY: 2360, height: 2996, viewportHeightRatio: 3.329 },
      ],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("recovered");
    expect(transform.offsetPx).toBe(1600);
    expect(transform.verified).toBe(true);
    expect(spaceValid).toBe(true);
  });

  it("fails closed when identity and the scroll offset are BOTH consistent with the screenshot", () => {
    // Span 3000..3900 inside a 4000px screenshot: identity leaves 100px
    // slack; a small scroll offset (100px) also lands inside with 0px slack.
    // The evidence cannot decide between them — no numeric target may be
    // invented.
    const evidence = evidenceOf({
      captureScrollY: 100,
      regions: [
        { id: "region-0", startY: 3000, endY: 3820, height: 820, viewportHeightRatio: 0.911 },
        { id: "region-1", startY: 3820, endY: 3900, height: 80, viewportHeightRatio: 0.089 },
      ],
    });
    const { transform, spaceValid, spaceError } = resolveGeometryTransform(evidence);
    expect(spaceValid).toBe(false);
    expect(spaceError).toContain("ambiguous");
    expect(transform.verified).toBe(false);
    const geometry = geometryOf(evidence);
    expect(claimRegion(geometry).status).toBe("AMBIGUOUS");
    expect(claimRegion(geometry).reason).toContain("ambiguous");
    expect(claimRegion(geometry).referenceHeightPx).toBeNull();
  });

  it("fails closed when NO transform is consistent with the screenshot", () => {
    const evidence = evidenceOf({
      captureScrollY: 100,
      regions: [{ id: "region-0", startY: -500, endY: -100, height: 400, viewportHeightRatio: 0.444 }],
    });
    const { spaceValid, spaceError } = resolveGeometryTransform(evidence);
    expect(spaceValid).toBe(false);
    expect(spaceError).toContain("no transform consistent");
    const geometry = geometryOf(evidence, blueprintClaiming("region-0"));
    expect(claimRegion(geometry).status).toBe("AMBIGUOUS");
  });

  it("keeps the documented historical precedence when the screenshot height cannot discriminate", () => {
    // No extraction coverage and no pixelHeight: bounds are unknowable, so
    // the recorded offset keeps winning (pre-#68 behavior) marked unverified.
    const evidence = evidenceOf({
      screenshotMetadata: { likelyCssViewportWidth: 1440 },
      captureScrollY: 1600,
      regions: [{ id: "region-0", startY: 964, endY: 2264, height: 1300, viewportHeightRatio: 1.444 }],
    });
    const { transform, spaceValid } = resolveGeometryTransform(evidence);
    expect(transform.kind).toBe("recorded");
    expect(transform.offsetPx).toBe(1600);
    expect(transform.verified).toBe(false);
    expect(spaceValid).toBe(true);
  });
});

describe("fresh-capture production fixture (Build 436c357a — the #68 regression source)", () => {
  const verbatim = FIXTURE_FRESH_CAPTURE_EVIDENCE as ReferenceEvidence;

  it("carries the exact production shape that used to double-normalize", () => {
    expect(verbatim.captureScrollY).toBe(1600);
    expect(verbatim.coordinateSpace).toBeUndefined();
    const spanStart = Math.min(...verbatim.regions.map((region) => region.startY!));
    const spanEnd = Math.max(...verbatim.regions.map((region) => region.endY!));
    expect(spanStart).toBe(0);
    expect(spanEnd).toBe(7659);
    expect(FIXTURE_FRESH_CAPTURE_BLUEPRINT.screenshotHeight).toBe(7660);
  });

  it("resolves MEASURED through legacy inference — never the false all-region ambiguity", () => {
    const geometry = resolveReferenceGeometry({
      blueprint: { homepageRegions: FIXTURE_FRESH_CAPTURE_BLUEPRINT.homepageRegions },
      evidence: verbatim,
    });
    expect(geometry.transform.kind).toBe("identity");
    expect(geometry.transform.offsetPx).toBe(0);
    expect(geometry.transform.verified).toBe(true);
    expect(geometry.screenshotHeightPx).toBe(7660);
    expect(geometry.status).toBe("MEASURED");
    for (const region of geometry.regions) {
      expect(region.status).toBe("MEASURED");
      expect(region.referenceViewportRatio).not.toBeNull();
    }
    // Spot checks against the frozen production coordinates: the hero band
    // stays exactly where the capture froze it (0..964 — NOT 1600..2564).
    const hero = geometry.regions.find((region) => region.regionId === "region_hero")!;
    expect(hero.slices).toEqual([{ startY: 0, endY: 964 }]);
    expect(hero.referenceViewportRatio).toBeCloseTo(1.071, 2);
    const footer = geometry.regions.find((region) => region.regionId === "region_footer")!;
    expect(footer.slices).toEqual([{ startY: 6938, endY: 7659 }]);
    expect(footer.referenceViewportRatio).toBeCloseTo(721 / VIEWPORT_900, 2);
  });

  it("resolves identically when the explicit PAGE_SPACE declaration is present (new captures)", () => {
    const declared: ReferenceEvidence = { ...verbatim, coordinateSpace: "PAGE_SPACE" };
    const geometry = resolveReferenceGeometry({
      blueprint: { homepageRegions: FIXTURE_FRESH_CAPTURE_BLUEPRINT.homepageRegions },
      evidence: declared,
    });
    expect(geometry.transform.kind).toBe("identity");
    expect(geometry.transform.offsetPx).toBe(0);
    expect(geometry.status).toBe("MEASURED");
    expect(geometry.regions.filter((region) => region.status === "MEASURED")).toHaveLength(10);
    const hero = geometry.regions.find((region) => region.regionId === "region_hero")!;
    expect(hero.slices).toEqual([{ startY: 0, endY: 964 }]);
  });
});

describe("single coordinate space across all capture channels (issue #68 §6)", () => {
  it("the production extractor freezes sections, headline and images in ONE page space", () => {
    // Contract: the single bounds helper adds window.scrollY (sections and
    // headline), and no frozen bounds channel emits a raw viewport-relative y.
    // This pins the mixed-space defect class (pre-#68 the images channel was
    // scroll-corrected while sections/headline were viewport-relative).
    const script = EXTRACT_LAYOUT_SCRIPT;
    expect(script).toContain("y: round(r.y + window.scrollY)");
    expect(script).not.toMatch(/bounds\s*=\s*\{[^}]*y: round\(r\.y\)[^+]/);
    // The image channel keeps its scroll-corrected boundsY.
    expect(script).toContain("boundsY: round(r.y + window.scrollY)");
  });

  it("the freeze declares the capture's coordinate space and records captureScrollY as provenance", async () => {
    const env = providedEnv as unknown as Env;
    const screenshotKey = `references/uploads/ref-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 1200, height: 3000, idatBytes: 77 })));
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Coordinate Space Co", contactEmail: "hello@csc.example" },
        // SCREENSHOT_AND_URL so the URL capture channel runs and freezes the
        // DOM-measured regions this test provides.
        reference: { screenshotR2Key: screenshotKey, url: "https://coordinate-space.example" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const capture: ReferenceCaptureOutput = {
      canonicalScreenshot: {
        content: new Uint8Array(buildPng({ width: 1440, height: 4000, idatBytes: 91 })),
        mimeType: "image/png",
        pixelWidth: 1440,
        pixelHeight: 4000,
        likelyCssViewportWidth: 1440,
      },
      captures: [{ viewportWidth: 1440, viewportHeight: 900, content: new Uint8Array(buildPng({ width: 1440, height: 4000, idatBytes: 92 })), mimeType: "image/png" }],
      // PAGE_SPACE coordinates measured at scrollY=300 (viewport rect + 300).
      regions: [
        { id: "region-0", startY: 300, endY: 1900, height: 1600, viewportHeightRatio: 1.778, boundingBox: { x: 0, y: 300, width: 1440, height: 1600 } },
        { id: "region-1", startY: 1900, endY: 3900, height: 2000, viewportHeightRatio: 2.222, boundingBox: { x: 0, y: 1900, width: 1440, height: 2000 } },
      ],
      coordinateSpace: "PAGE_SPACE",
      captureScrollY: 300,
      measuredElements: [
        {
          selectorHint: "section",
          role: "region",
          boundingBox: { x: 0, y: 300, width: 1440, height: 1600 },
          confidence: "HIGH",
          source: "DOM",
        },
      ],
      responsiveObservations: [],
      motionObservations: [],
      discrepancies: [],
    };
    await runReferenceIntake(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      capture: async () => capture,
    });

    const frozen = await getFrozenReferenceEvidence(env, started.siteGenerationId);
    expect(frozen).not.toBeNull();
    expect(frozen!.evidence.coordinateSpace).toBe("PAGE_SPACE");
    expect(frozen!.evidence.captureScrollY).toBe(300);
    // Every frozen coordinate channel agrees: the freeze did not re-apply
    // the offset (regions stay 300.. and the measuredElement box matches).
    expect(frozen!.evidence.regions.map((region) => region.startY)).toEqual([300, 1900]);
    const sectionBox = frozen!.evidence.measuredElements.find((element) => element.selectorHint === "section")?.boundingBox;
    expect(sectionBox?.y).toBe(300);
  });
});
