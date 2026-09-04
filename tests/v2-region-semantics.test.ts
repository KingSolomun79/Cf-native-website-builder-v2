import { describe, expect, it } from "vitest";
import {
  canonicalRegionComposition,
  parseVisualBlueprint,
  validateBlueprintRegionProvenance,
  VisualBlueprintSchema,
  type VisualBlueprint,
} from "../src/domain/visual-blueprint";
import { compareGeometry, geometryFromRegions } from "../src/domain/qa-evidence";
import { regionsFromLayout } from "../src/domain/qa-capture";
import type { RawLayout, RawSection } from "../src/lib/browser-adapter";
import { Value } from "@sinclair/typebox/value";

// Canonical region segmentation semantics (issue #37, blocking #30).
//
// Reference Evidence segmentation is observational; the Visual Blueprint's
// ordered canonical region list is the binding topology for generation AND
// QA hard composition gates, while raw evidence stays the authority for
// measured fidelity. The fixture below is the assignment matrix: 9 raw
// evidence segments aggregated into 4 canonical Blueprint regions, generated
// output implementing exactly those 4 regions.

const EVIDENCE_SEGMENTS = [
  { id: "seg-header", startY: 0, endY: 90, height: 90, viewportHeightRatio: 0.1 },
  { id: "seg-nav", startY: 90, endY: 180, height: 90, viewportHeightRatio: 0.1 },
  { id: "seg-hero-image", startY: 180, endY: 1080, height: 900, viewportHeightRatio: 1.0 },
  { id: "seg-hero-copy", startY: 180, endY: 630, height: 450, viewportHeightRatio: 0.5 },
  { id: "seg-hero-cta", startY: 630, endY: 720, height: 90, viewportHeightRatio: 0.1 },
  { id: "seg-gallery", startY: 1080, endY: 1980, height: 900, viewportHeightRatio: 1.0 },
  { id: "seg-services", startY: 1980, endY: 2700, height: 720, viewportHeightRatio: 0.8 },
  { id: "seg-testimonial", startY: 2700, endY: 3330, height: 630, viewportHeightRatio: 0.7 },
  { id: "seg-footer", startY: 3330, endY: 3780, height: 450, viewportHeightRatio: 0.5 },
];

const BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "Immersive hospitality narrative: full-bleed hero, editorial gallery, service story, closing CTA.",
  signatureTraits: [
    { id: "bp-fullbleed", description: "Full-bleed imagery bands", sourceTraitId: "trait-a" },
    { id: "bp-flow", description: "Four-band vertical flow", sourceTraitId: "trait-b" },
    { id: "bp-serif", description: "Serif display statements", sourceTraitId: "trait-c" },
  ],
  fidelityPriorities: ["first viewport topology", "region order"],
  tokens: { "color.ink": "#101418", "color.paper": "#fbf9f4" },
  globalGrid: { containerLogic: "full-bleed bands, 1200px inner container", columnRatios: ["5/7"] },
  spacingRhythm: "Large band padding",
  typographyRoles: [{ role: "display", description: "serif statements" }],
  colorRoles: [{ role: "ink", description: "text" }],
  surfaceLanguage: "alternating paper/ink bands",
  headerNavigation: "transparent header over hero",
  homepageFirstViewport: { summary: "Full-viewport hero opening", regionIds: ["hero"] },
  homepageRegions: [
    {
      id: "hero",
      purpose: "hero composition: header, nav and hero image as one unit",
      // The disjoint measured landmarks; seg-hero-copy/seg-hero-cta overlap
      // seg-hero-image (nested content) and stay unclaimed observational
      // evidence — aggregation never double-counts overlapping segments.
      sourceEvidenceRegionIds: ["seg-header", "seg-nav", "seg-hero-image"],
    },
    { id: "gallery", purpose: "editorial gallery band", sourceEvidenceRegionIds: ["seg-gallery"] },
    { id: "services", purpose: "services + social proof story", sourceEvidenceRegionIds: ["seg-services", "seg-testimonial"] },
    { id: "footer-cta", purpose: "closing contact band", sourceEvidenceRegionIds: ["seg-footer"] },
  ],
  imageSystem: {
    photographyGrammar: "documentary natural light",
    imageRoles: [{ id: "role-hero", purpose: "hero imagery", priority: "CRITICAL" }],
  },
  motionGrammar: ["fade-up reveals"],
  responsiveContract: ["bands stack below 768px"],
  innerPageVocabulary: ["page-header", "content-section"],
  antiFallbackRules: ["never center the hero"],
  accessibilityAdaptations: [],
  declaredLimitations: [],
};

function section(overrides: Partial<RawSection> & { order: number; bounds: RawSection["bounds"] }): RawSection {
  return {
    tag: "section",
    role: null,
    heading: null,
    text: null,
    evidenceId: null,
    dataRegion: null,
    ...overrides,
  };
}

// A generated home page: the 4 canonical regions as top-level data-region
// sections, PLUS harmless internal segmentation (nested landmark wrappers
// inside canonical regions and a bare <main>) that must NOT fabricate extra
// canonical regions.
function generatedLayout(order: string[] = ["hero", "gallery", "services", "footer-cta"], heroHeight = 1080): RawLayout {
  const heights: Record<string, number> = { hero: heroHeight, gallery: 900, services: 1350, "footer-cta": 450 };
  const sections: RawSection[] = [section({ order: 0, tag: "main", bounds: { x: 0, y: 0, width: 1440, height: 3780 } })];
  order.forEach((regionId, index) => {
    sections.push(
      section({
        order: sections.length,
        dataRegion: regionId,
        bounds: { x: 0, y: 0, width: 1440, height: heights[regionId] ?? 600 },
      })
    );
    if (regionId === "hero") {
      // Internal wrappers: nested header/nav landmarks inside the hero region.
      sections.push(section({ order: sections.length, tag: "header", dataRegion: regionId, bounds: { x: 0, y: 0, width: 1440, height: 180 } }));
      sections.push(section({ order: sections.length, tag: "nav", bounds: { x: 0, y: 0, width: 1440, height: 90 } }));
    }
    if (regionId === "gallery") {
      sections.push(section({ order: sections.length, bounds: { x: 0, y: 900, width: 1440, height: 300 } }));
    }
    void index;
  });
  sections.push(section({ order: sections.length, tag: "footer", bounds: { x: 0, y: 3330, width: 1440, height: 450 } }));
  return {
    finalUrl: "https://preview.example.test/",
    title: "t",
    lang: "en",
    description: null,
    viewportMeta: null,
    sections,
    typography: [],
    colors: { background: null, text: null, accents: [] },
    nav: [],
    images: [],
    spacing: null,
    contrastSamples: [],
    consentDetected: false,
  };
}

function canonicalReferenceProfile() {
  const composition = canonicalRegionComposition(BLUEPRINT, EVIDENCE_SEGMENTS);
  return geometryFromRegions(
    composition.map((region) => ({
      id: region.regionId,
      height: region.heightPx ?? 0,
      viewportHeightRatio: region.viewportHeightRatio ?? 0,
    })),
    0.38
  );
}

describe("canonical region aggregation provenance (issue #37)", () => {
  it("aggregates measured evidence per canonical region, preserving order and provenance", () => {
    const evidenceBefore = JSON.parse(JSON.stringify(EVIDENCE_SEGMENTS));
    const composition = canonicalRegionComposition(BLUEPRINT, EVIDENCE_SEGMENTS);

    expect(composition.map((region) => region.regionId)).toEqual(["hero", "gallery", "services", "footer-cta"]);
    expect(composition.map((region) => region.order)).toEqual([1, 2, 3, 4]);
    // hero = header+nav+image (disjoint landmarks); services =
    // services+testimonial. Nested/overlapping segments stay unclaimed.
    expect(composition[0].viewportHeightRatio).toBeCloseTo(1.2, 3);
    expect(composition[0].heightPx).toBe(1080);
    expect(composition[0].sourceEvidenceRegionIds).toEqual(["seg-header", "seg-nav", "seg-hero-image"]);
    expect(composition[2].viewportHeightRatio).toBeCloseTo(1.5, 3);
    expect(composition[2].sourceEvidenceRegionIds).toEqual(["seg-services", "seg-testimonial"]);

    // Raw Reference Evidence is immutable observational input — never
    // rewritten by interpretation or aggregation.
    expect(EVIDENCE_SEGMENTS).toEqual(evidenceBefore);
  });

  it("keeps the provenance field optional in the stored schema (legacy blueprints stay valid)", () => {
    const legacy = JSON.parse(JSON.stringify(BLUEPRINT));
    for (const region of legacy.homepageRegions) delete region.sourceEvidenceRegionIds;
    expect(Value.Check(VisualBlueprintSchema, legacy)).toBe(true);
    expect(parseVisualBlueprint(legacy)).not.toBeNull();
  });

  it("rejects fabricated provenance, uncovered regions and double-claimed segments", () => {
    const fabricated = JSON.parse(JSON.stringify(BLUEPRINT)) as VisualBlueprint;
    fabricated.homepageRegions[1] = {
      ...fabricated.homepageRegions[1],
      sourceEvidenceRegionIds: ["seg-does-not-exist"],
    };
    expect(validateBlueprintRegionProvenance(fabricated, EVIDENCE_SEGMENTS).valid).toBe(false);

    const uncovered = JSON.parse(JSON.stringify(BLUEPRINT)) as VisualBlueprint;
    delete (uncovered.homepageRegions[2] as { sourceEvidenceRegionIds?: string[] }).sourceEvidenceRegionIds;
    const uncoveredVerdict = validateBlueprintRegionProvenance(uncovered, EVIDENCE_SEGMENTS);
    expect(uncoveredVerdict.valid).toBe(false);
    if (!uncoveredVerdict.valid) {
      expect(uncoveredVerdict.problems.join(" ")).toContain("'services' has no sourceEvidenceRegionIds");
    }

    const doubleClaimed = JSON.parse(JSON.stringify(BLUEPRINT)) as VisualBlueprint;
    doubleClaimed.homepageRegions[1] = {
      ...doubleClaimed.homepageRegions[1],
      sourceEvidenceRegionIds: ["seg-gallery", "seg-services"],
    };
    expect(validateBlueprintRegionProvenance(doubleClaimed, EVIDENCE_SEGMENTS).valid).toBe(false);

    // No evidence segmentation (degenerate/legacy) — nothing to validate.
    expect(validateBlueprintRegionProvenance(BLUEPRINT, []).valid).toBe(true);
  });
});

describe("QA region topology judges the Blueprint, not the raw segmentation", () => {
  it("passes the 4-canonical-region generated page against the 9-segment evidence", () => {
    const reference = canonicalReferenceProfile();
    const candidate = geometryFromRegions(regionsFromLayout(generatedLayout(), 900), 0.38);

    // The candidate exposes 4 canonical regions — NOT the 9 raw segments —
    // and this is exactly what the comparator must reward.
    expect(candidate.regionOrder).toEqual(["hero", "gallery", "services", "footer-cta"]);
    const comparison = compareGeometry(reference, candidate);
    const byId = new Map(comparison.metrics.map((metric) => [metric.id, metric]));
    expect(byId.get("region_order")!.withinTolerance).toBe(true);
    expect(byId.get("region_count")!.withinTolerance).toBe(true);
    expect(byId.get("first_viewport_height_ratio")!.withinTolerance).toBe(true);
  });

  it("collapses harmless internal segmentation instead of fabricating canonical regions", () => {
    const regions = regionsFromLayout(generatedLayout(), 900);
    // main + nested header/nav/article landmarks never become extra regions.
    expect(regions.map((region) => region.id)).toEqual(["hero", "gallery", "services", "footer-cta"]);
    // Nested/overlapping landmarks collapse to the containing region's height.
    expect(regions[0].viewportHeightRatio).toBeCloseTo(Number((1080 / 900).toFixed(3)), 3);
  });

  it("fails when canonical region order differs", () => {
    const reference = canonicalReferenceProfile();
    const candidate = geometryFromRegions(regionsFromLayout(generatedLayout(["hero", "services", "gallery", "footer-cta"]), 900), 0.38);
    const comparison = compareGeometry(reference, candidate);
    const regionOrder = comparison.metrics.find((metric) => metric.id === "region_order")!;
    expect(regionOrder.withinTolerance).toBe(false);
  });

  it("fails when a canonical region is missing", () => {
    const reference = canonicalReferenceProfile();
    const candidate = geometryFromRegions(regionsFromLayout(generatedLayout(["hero", "gallery", "footer-cta"]), 900), 0.38);
    const comparison = compareGeometry(reference, candidate);
    const regionOrder = comparison.metrics.find((metric) => metric.id === "region_order")!;
    expect(regionOrder.withinTolerance).toBe(false);
    expect(regionOrder.candidateValue).toBe("hero>gallery>footer-cta");
  });

  it("still fails measured-fidelity gates for correct order with wrong proportions (no relaxation)", () => {
    const reference = canonicalReferenceProfile();
    // Correct canonical order/topology, but the hero renders at a third of
    // its measured height: the measured gate MUST still fail.
    const candidate = geometryFromRegions(regionsFromLayout(generatedLayout(["hero", "gallery", "services", "footer-cta"], 270), 900), 0.38);
    const comparison = compareGeometry(reference, candidate);
    const firstViewport = comparison.metrics.find((metric) => metric.id === "first_viewport_height_ratio")!;
    expect(firstViewport.withinTolerance).toBe(false);
    expect(firstViewport.candidateValue).toBeCloseTo(0.3, 1);
  });

  it("keeps positional landmark mapping for pages without canonical data-region attributes", () => {
    const legacy = generatedLayout();
    legacy.sections = legacy.sections.filter((section) => !section.dataRegion).map((section, index) => ({ ...section, order: index }));
    const regions = regionsFromLayout(legacy, 900);
    // main + nav + gallery inner section + footer landmarks, positional 1-based.
    expect(regions.map((region) => region.id)).toEqual(["region-1", "region-2", "region-3", "region-4"]);
  });
});
