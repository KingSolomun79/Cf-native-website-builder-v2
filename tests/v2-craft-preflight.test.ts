import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  cropPngBand,
  runCraftPreflight,
  storeCraftCrops,
  type CraftCapture,
} from "../src/domain/craft-preflight";
import { decodePng, encodePng } from "../src/lib/png-codec";
import { getObject } from "../src/lib/assets";
import type { VisualBlueprint } from "../src/domain/visual-blueprint";
import type { ImplementationContract } from "../src/domain/implementation-planner";
import type { ImageSlot } from "../src/domain/site-generator";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

// Issue #49 — deterministic Design Craft Preflight + region-targeted repair.
//
// The frozen RankForge v3 candidate reached expensive QA with gross
// realization defects a single deterministic capture exposes: a headline
// pushed off-canvas by an unstyled hero image, UA-default type against the
// display token, and a 3.2-viewport services stack against a 0.8-viewport
// measured target. The preflight is NOT a second designer: every check
// measures against the frozen Blueprint, the Contract binding or MEASURED
// Reference evidence — never against "generic" style opinions (mode split).

const BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "Editorial clarity.",
  signatureTraits: [
    { id: "bp-a", description: "Oversized display type" },
    { id: "bp-b", description: "Distinctive silhouette" },
    { id: "bp-c", description: "Surface alternation" },
  ],
  fidelityPriorities: ["first viewport topology"],
  tokens: { "color.ink": "#1a1a1a", "type.display.size": "60px" },
  globalGrid: { containerLogic: "max-width 1200px", columnRatios: ["5/7"] },
  spacingRhythm: "generous",
  typographyRoles: [{ role: "display", description: "oversized statements" }],
  colorRoles: [{ role: "ink", description: "text" }],
  surfaceLanguage: "paper/ink",
  headerNavigation: "minimal",
  homepageFirstViewport: { summary: "full-bleed hero", regionIds: ["hero"] },
  homepageRegions: [
    { id: "hero", purpose: "hero statement", imageRoleId: "role-hero", sourceEvidenceRegionIds: ["region-1"] },
    { id: "services", purpose: "service matrix", sourceEvidenceRegionIds: ["region-2"] },
    { id: "cta", purpose: "closing", sourceEvidenceRegionIds: ["region-3"] },
  ],
  imageSystem: {
    photographyGrammar: "editorial",
    imageRoles: [
      { id: "role-hero", purpose: "full-bleed hero image", priority: "CRITICAL" },
      { id: "role-detail", purpose: "supporting detail", priority: "NORMAL" },
    ],
  },
  motionGrammar: ["fade-up"],
  responsiveContract: ["stack below 768px"],
  innerPageVocabulary: ["page-header"],
  antiFallbackRules: ["never center"],
  accessibilityAdaptations: [],
  declaredLimitations: [],
};

function contractFixture(): ImplementationContract {
  return {
    version: "1",
    blueprintVisualThesis: BLUEPRINT.visualThesis,
    blueprintSignatureTraitIds: BLUEPRINT.signatureTraits.map((trait) => trait.id),
    blueprintFirstViewportRegionIds: ["hero"],
    realization: {
      regionStyleBinding: [
        { regionId: "hero", cssSelector: '[data-region="hero"]' },
        { regionId: "services", cssSelector: '[data-region="services"]' },
        { regionId: "cta", cssSelector: '[data-region="cta"]' },
      ],
      classVocabularyPolicy: "css-defined-classes-only",
      contentCapacityPolicy: "copy-fits-measured-regions",
    },
    pages: [
      { id: "home", path: "/", regions: BLUEPRINT.homepageRegions.map((region) => ({ id: region.id, realization: "section" })) },
      { id: "about", path: "/about", regions: [] },
      { id: "services", path: "/services", regions: [] },
      { id: "contact", path: "/contact", regions: [] },
    ],
    files: { sharedCss: "site.css", sharedJs: "site.js", pageFiles: { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" } },
    tokens: BLUEPRINT.tokens,
    components: [],
    responsiveStrategy: {},
    imageSlotStrategy: { roleIds: ["role-hero"] },
    formContract: {
      formServiceEndpoint: "https://forms.wazibiz.example/api/v2/forms/submit",
      siteFormId: "site:test-site",
      fields: ["name", "email", "message"],
      turnstile: false,
    },
    approvedDependencies: [],
    blockers: [],
  };
}

const env = providedEnv as unknown as Env;

const SLOTS: ImageSlot[] = [
  { id: "home-hero", page: "home", regionId: "hero", semanticRole: "full-bleed hero", blueprintRole: "role-hero", priority: "CRITICAL", orientation: "landscape", negativeSpaceForText: true },
];

// The frozen fixture defect: a 2:3 PORTRAIT role whose accepted asset is a
// 1344x768 landscape collage.
const PORTRAIT_SLOTS: ImageSlot[] = [
  { id: "home-hero", page: "home", regionId: "hero", semanticRole: "portrait split imagery", blueprintRole: "role-hero", priority: "CRITICAL", orientation: "portrait", negativeSpaceForText: false },
];

interface SectionSpec {
  regionId: string;
  y: number;
  height: number;
  width?: number;
}

function capture(spec: {
  sections: SectionSpec[];
  headline?: { x: number; width: number; fontSize?: string } | null;
  images?: Array<{ regionId: string; imageId: string; displayedWidth: number; displayedHeight: number; naturalWidth: number; naturalHeight: number }>;
  viewportWidth?: number;
  viewportHeight?: number;
  screenshot?: Uint8Array;
}): CraftCapture {
  const viewportWidth = spec.viewportWidth ?? 1440;
  const viewportHeight = spec.viewportHeight ?? 900;
  return {
    layout: {
      finalUrl: "https://preview.example/",
      title: "t",
      lang: "en",
      description: "d",
      viewportMeta: "width=device-width, initial-scale=1",
      sections: spec.sections.map((section, index) => ({
        order: index,
        tag: "section",
        role: null,
        heading: null,
        text: null,
        bounds: { x: 0, y: section.y, width: section.width ?? viewportWidth, height: section.height },
        evidenceId: null,
        dataRegion: section.regionId,
      })),
      typography: [],
      colors: { background: "rgb(255,255,255)", text: "rgb(0,0,0)", accents: [] },
      nav: [],
      images: (spec.images ?? []).map((image) => ({
        src: `assets/images/${image.imageId}.webp`,
        alt: image.imageId,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayedWidth: image.displayedWidth,
        inMain: true,
        evidenceId: null,
        displayedHeight: image.displayedHeight,
        boundsY: 0,
        regionId: image.regionId,
        imageId: image.imageId,
      })),
      spacing: null,
      contrastSamples: [],
      consentDetected: false,
      ...(spec.headline === undefined
        ? {}
        : {
            headline: spec.headline
              ? { text: "H", fontFamily: "system-ui", fontSize: spec.headline.fontSize ?? "60px", bounds: { x: spec.headline.x, y: 100, width: spec.headline.width, height: 120 } }
              : null,
          }),
      viewportHeight,
      viewportWidth,
    },
    fullPageScreenshot: spec.screenshot ?? new TextEncoder().encode("not-a-png"),
    viewportWidth,
    viewportHeight,
  };
}

const TARGETS = [
  { regionId: "hero", viewportHeightRatio: 1.05 },
  { regionId: "services", viewportHeightRatio: 0.8 },
];

describe("craft preflight deterministic checks (issue #49)", () => {
  it("the frozen v3 failure shape fails with exact canonical regions and measured deltas", async () => {
    // Hero 1.11 viewports (target 1.05 — fine), services as a 3.2-viewport
    // single-column stack (target 0.8 — gross), the H1 pushed off-canvas by
    // the unstyled hero image, UA-default 32px type against the 60px display
    // token, and the hero image a small contained landscape strip.
    const verdict = await runCraftPreflight(
      {
        capture: capture({
          sections: [
            { regionId: "hero", y: 0, height: 997 },
            { regionId: "services", y: 997, height: 2888 },
            { regionId: "cta", y: 3885, height: 380 },
          ],
          headline: { x: 1040, width: 800, fontSize: "32px" },
          images: [
            { regionId: "hero", imageId: "home-hero", displayedWidth: 400, displayedHeight: 100, naturalWidth: 1344, naturalHeight: 768 },
          ],
        }),
        blueprint: BLUEPRINT,
        contract: contractFixture(),
        slots: PORTRAIT_SLOTS,
        compositionTargets: TARGETS,
        referenceImageMassRatio: null,
        reference: null,
      },
      1
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.pageRepairable).toBe(true);
    const checkIds = verdict.findings.map((finding) => finding.checkId);
    expect(checkIds).toContain("HEADLINE_CLIPPING");
    expect(checkIds).toContain("DISPLAY_TYPE_SCALE");
    expect(checkIds).toContain("REGION_HEIGHT_DEVIATION");
    expect(checkIds).toContain("IMAGE_ROLE_REALIZATION");
    expect(checkIds).toContain("IMAGE_ORIENTATION_MISMATCH");
    const services = verdict.findings.find((finding) => finding.regionId === "services" && finding.checkId === "REGION_HEIGHT_DEVIATION");
    expect(services?.measured).toContain("3.209");
    expect(services?.target).toContain("0.800");
    // The repair directive text carries exact regions, measurements, targets.
    expect(verdict.directiveText).toContain("region 'services'");
    expect(verdict.directiveText).toContain("3.209 viewport-heights");
  });

  it("a Reference-matching candidate passes without repair", async () => {
    const verdict = await runCraftPreflight(
      {
        capture: capture({
          sections: [
            { regionId: "hero", y: 0, height: 945 },
            { regionId: "services", y: 945, height: 720 },
            { regionId: "cta", y: 1665, height: 380 },
          ],
          headline: { x: 60, width: 900, fontSize: "60px" },
          images: [
            { regionId: "hero", imageId: "home-hero", displayedWidth: 1344, displayedHeight: 800, naturalWidth: 1344, naturalHeight: 768 },
          ],
        }),
        blueprint: BLUEPRINT,
        contract: contractFixture(),
        slots: SLOTS,
        compositionTargets: TARGETS,
        referenceImageMassRatio: null,
        reference: null,
      },
      1
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.findings).toEqual([]);
    expect(verdict.directiveText).toBe("");
  });

  it("image-mass deviation fires only on a MEASURED image-dominant reference", async () => {
    const emptyHero = capture({
      sections: [
        { regionId: "hero", y: 0, height: 945 },
        { regionId: "services", y: 945, height: 720 },
        { regionId: "cta", y: 1665, height: 380 },
      ],
      headline: null,
    });
    const base = {
      capture: emptyHero,
      blueprint: BLUEPRINT,
      contract: contractFixture(),
      slots: SLOTS,
      compositionTargets: TARGETS,
    };
    const measured = await runCraftPreflight({ ...base, referenceImageMassRatio: 0.4, reference: null }, 1);
    expect(measured.findings.map((finding) => finding.checkId)).toContain("IMAGE_MASS_GROSS_DEVIATION");
    const unmeasured = await runCraftPreflight({ ...base, referenceImageMassRatio: null, reference: null }, 1);
    expect(unmeasured.findings.map((finding) => finding.checkId)).not.toContain("IMAGE_MASS_GROSS_DEVIATION");
  });

  it("region crops are deterministic, pixel-true and provenance-bound", async () => {
    // Candidate screenshot: white page with a red hero band (rows 100..200).
    const candidateWidth = 200;
    const candidateHeight = 900;
    const candidateRgb = new Uint8Array(candidateWidth * candidateHeight * 3).fill(255);
    for (let y = 100; y < 200; y++) {
      for (let x = 0; x < candidateWidth; x++) {
        const at = (y * candidateWidth + x) * 3;
        candidateRgb[at] = 255;
        candidateRgb[at + 1] = 0;
        candidateRgb[at + 2] = 0;
      }
    }
    const candidatePng = await encodePng({ width: candidateWidth, height: candidateHeight, rgb: candidateRgb });

    // Reference screenshot at HALF the CSS viewport (scale 0.5), all blue.
    const refWidth = 100;
    const refHeight = 600;
    const refRgb = new Uint8Array(refWidth * refHeight * 3);
    for (let index = 0; index < refRgb.length; index += 3) {
      refRgb[index + 2] = 255;
    }
    const referencePng = await encodePng({ width: refWidth, height: refHeight, rgb: refRgb });

    const verdict = await runCraftPreflight(
      {
        capture: capture({
          sections: [
            { regionId: "hero", y: 0, height: 300 },
            { regionId: "services", y: 300, height: 600 },
          ],
          headline: null,
          screenshot: candidatePng,
          viewportWidth: candidateWidth,
          viewportHeight: 900,
        }),
        blueprint: BLUEPRINT,
        contract: contractFixture(),
        slots: SLOTS,
        compositionTargets: [{ regionId: "hero", viewportHeightRatio: 1.05 }],
        referenceImageMassRatio: null,
        reference: {
          screenshot: referencePng,
          cssViewportWidth: 200,
          // Issue #65: reference regions arrive as normalized page-space
          // slices resolved by the canonical mapping authority.
          regions: [{ id: "hero", slices: [{ startY: 0, endY: 600 }] }],
        },
      },
      1
    );
    // hero renders 0.33 viewports against the 1.05 measured target.
    const pair = verdict.crops.find((crop) => crop.regionId === "hero");
    expect(pair).toBeDefined();
    expect(pair!.candidate).not.toBeNull();
    expect(pair!.candidate!.cropSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pair!.candidate!.yStart).toBe(0);
    expect(pair!.candidate!.yEnd).toBe(300);

    // Candidate crop pixels: 300 rows; the red band rides inside it.
    const candidateCrop = await decodePng(pair!.candidateBytes!);
    expect(candidateCrop.ok).toBe(true);
    if (candidateCrop.ok) {
      expect(candidateCrop.png.height).toBe(300);
      const redPixel = Array.from(candidateCrop.png.rgb.slice(100 * candidateWidth * 3, 100 * candidateWidth * 3 + 3));
      expect(redPixel).toEqual([255, 0, 0]);
    }

    // Reference crop: scale 0.5 shrinks the CSS band to 300 blue rows.
    if (pair!.reference) {
      expect(pair!.reference.scale).toBeCloseTo(0.5, 5);
      const referenceCrop = await decodePng(pair!.referenceSliceBytes![0]);
      expect(referenceCrop.ok).toBe(true);
      if (referenceCrop.ok) {
        expect(referenceCrop.png.height).toBe(300);
        const bluePixel = Array.from(referenceCrop.png.rgb.slice(0, 3));
        expect(bluePixel).toEqual([0, 0, 255]);
      }
    }

    // storeCraftCrops binds the crops to deterministic artifact keys.
    await storeCraftCrops(env, {
      buildId: "b-craft",
      buildVersionNumber: 1,
      attempt: 1,
      crops: verdict.crops,
    });
    if (pair!.candidate) {
      const body = await getObject(env, pair!.candidate.artifactR2Key);
      expect(body).not.toBeNull();
    }
  });
});

// ── Pipeline integration: preflight -> one informed repair -> QA ────────────

describe("craft preflight pipeline integration (issue #49)", () => {
  it("runs the preflight, repairs once from measured findings, and never consumes the QA repair budget", async () => {
    const screenshotKey = `references/uploads/craft-${Math.random().toString(36).slice(2)}.png`;
    await persistPipelineScreenshot(env, screenshotKey, { decodable: true });
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const base = createPipelineScripts({ visionReference: true });
    let craftCalls = 0;
    const failingCapture: CraftCapture = {
      layout: {
        finalUrl: "https://preview.example/",
        title: PIPELINE_SCRIPTS_BUSINESS,
        lang: "en",
        description: PIPELINE_SCRIPTS_BUSINESS,
        viewportMeta: "width=device-width, initial-scale=1",
        sections: [
          { order: 0, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 0, width: 1440, height: 180 }, evidenceId: null, dataRegion: "r1" },
          { order: 1, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 180, width: 1440, height: 880 }, evidenceId: null, dataRegion: "r2" },
          { order: 2, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1060, width: 1440, height: 800 }, evidenceId: null, dataRegion: "r3" },
          { order: 3, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1860, width: 1440, height: 640 }, evidenceId: null, dataRegion: "r4" },
        ],
        typography: [],
        colors: { background: "rgb(250,247,242)", text: "rgb(26,26,26)", accents: [] },
        nav: [],
        images: [],
        spacing: null,
        contrastSamples: [],
        consentDetected: false,
        headline: { text: PIPELINE_SCRIPTS_BUSINESS, fontFamily: "system-ui", fontSize: "32px", bounds: { x: 1100, y: 20, width: 700, height: 90 } },
        viewportHeight: 900,
        viewportWidth: 1440,
      },
      fullPageScreenshot: new TextEncoder().encode("not-a-png-attempt-1"),
      viewportWidth: 1440,
      viewportHeight: 900,
    };
    const scripted: BuildPipelineDeps = {
      ...base,
      // The informed repair path attaches crops through the vision seam; the
      // scripted generator answers the regeneration prompt (it matches the
      // same "page id" markers).
      visionGenerate: base.generate,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCapture : base.craftCapture();
      },
    };

    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      deps: scripted,
    });

    expect(outcome.terminal).toBe("RELEASE_READY");
    // Exactly two craft captures: the failed attempt and the post-repair one.
    expect(craftCalls).toBe(2);
    // The informed repair ran ONCE under its own immutable subkey.
    const repairArtifact = await env.DB.prepare(
      "SELECT id FROM build_stage_artifacts WHERE build_id = ? AND kind = 'generated_page' AND subkey = 'home.realization-repair-1'"
    )
      .bind(outcome.buildId)
      .first();
    expect(repairArtifact).not.toBeNull();
    // Both craft attempts are recorded, findings name the exact region.
    const attempts = await env.DB.prepare(
      "SELECT subkey FROM build_stage_artifacts WHERE build_id = ? AND kind = 'craft_preflight' ORDER BY subkey"
    )
      .bind(outcome.buildId)
      .all<{ subkey: string }>();
    expect((attempts.results ?? []).map((row) => row.subkey).sort()).toEqual(["attempt-1", "attempt-2"]);
    const { getBuildStageArtifact } = await import("../src/domain/stage-artifacts");
    const attempt1Record = await getBuildStageArtifact<{ passed: boolean; findings: Array<{ regionId: string | null; checkId: string }> }>(
      env,
      outcome.buildId ? (await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1").bind(outcome.buildId).first<{ id: string }>())!.id : "",
      "craft_preflight",
      "attempt-1"
    );
    expect(attempt1Record).not.toBeNull();
    expect(attempt1Record!.value.passed).toBe(false);
    expect(attempt1Record!.value.findings.some((finding) => finding.regionId === "r1")).toBe(true);
    // The QA repair budget was never touched by the preflight repair.
    const batches = await env.DB.prepare("SELECT COUNT(*) AS n FROM repair_batches WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(batches!.n).toBe(0);
  });

  it("a preflight-clean candidate goes straight to QA with a single craft attempt", async () => {
    const screenshotKey = `references/uploads/craft-clean-${Math.random().toString(36).slice(2)}.png`;
    await persistPipelineScreenshot(env, screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    let craftCalls = 0;
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      deps: {
        ...createPipelineScripts(),
        craftCapture: async () => {
          craftCalls += 1;
          return createPipelineScripts().craftCapture();
        },
      },
    });

    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(craftCalls).toBe(1);
    const repairArtifacts = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_id = ? AND subkey LIKE '%realization-repair%'"
    )
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(repairArtifacts!.n).toBe(0);
  });
});
