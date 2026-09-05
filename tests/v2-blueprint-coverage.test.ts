import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createPipelineScripts } from "./helpers/pipeline-scripts";
import { evaluateBlueprintCoverage } from "../src/domain/visual-blueprint";
import { runReferenceAnalysisStage, createProductionVisionGenerate, buildAnalysisUserPrompt, type ReferenceAnalysis } from "../src/domain/reference-analysis";
import type { VisualBlueprint } from "../src/domain/visual-blueprint";
import type { ReferenceEvidence, AdaptationContract } from "../src/domain/reference-evidence-schema";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

// Issue #42 — multimodal Reference Analysis + Blueprint coverage contract:
// the analyzer interprets the ATTACHED normalized reference image (production
// vision path, glm-5.3-flash policy), and the Blueprint may aggregate the
// reference but may never erase it — a coverage gap is BLUEPRINT_REVIEW_REQUIRED.

const env = providedEnv as unknown as Env;

const ANALYSIS: ReferenceAnalysis = {
  version: "1",
  visualSystemSummary: "Editorial system with alternating surfaces.",
  hierarchy: [{ level: "display", description: "oversized headline", confidence: "HIGH" }],
  signatureTraits: [
    { id: "trait-typography", description: "Oversized display type", identityDefining: true, evidenceRefs: ["r1"] },
    { id: "trait-region-flow", description: "Distinctive silhouette", identityDefining: true, evidenceRefs: ["r2"] },
  ],
  designIntent: [{ hypothesis: "premium authority", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "editorial imagery", imageRoles: ["hero"] },
  responsiveBehavior: [],
  motionBehavior: [],
  identityCarriers: ["trait-typography"],
};

const BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "Editorial clarity.",
  signatureTraits: [
    { id: "bp-typography", description: "display", sourceTraitId: "trait-typography" },
    { id: "bp-flow", description: "flow", sourceTraitId: "trait-region-flow" },
  ],
  fidelityPriorities: ["region order"],
  tokens: {},
  globalGrid: { containerLogic: "max-width 1200px", columnRatios: ["5/7"] },
  spacingRhythm: "generous",
  typographyRoles: [{ role: "display", description: "statements" }],
  colorRoles: [{ role: "ink", description: "text" }],
  surfaceLanguage: "alternating",
  headerNavigation: "minimal",
  homepageFirstViewport: { summary: "hero", regionIds: ["r1"] },
  homepageRegions: [
    { id: "r1", purpose: "hero", sourceEvidenceRegionIds: ["r1"] },
    { id: "r2", purpose: "gallery", sourceEvidenceRegionIds: ["r2"] },
    { id: "r3", purpose: "services", sourceEvidenceRegionIds: ["r3"] },
    { id: "r4", purpose: "footer", sourceEvidenceRegionIds: ["r4"] },
  ],
  imageSystem: { photographyGrammar: "editorial", imageRoles: [{ id: "role-hero", purpose: "hero", priority: "CRITICAL" }] },
  motionGrammar: [],
  responsiveContract: [],
  innerPageVocabulary: ["page-header", "content-section"],
  antiFallbackRules: [],
  accessibilityAdaptations: [],
  declaredLimitations: [],
};

const EVIDENCE_REGIONS = [
  { id: "r1", viewportHeightRatio: 0.8 },
  { id: "r2", viewportHeightRatio: 0.98 },
  { id: "r3", viewportHeightRatio: 0.89 },
  { id: "r4", viewportHeightRatio: 0.71 },
];

describe("blueprint coverage contract (issue #42)", () => {
  it("COVERED when every identity trait and major mass is claimed", () => {
    const coverage = evaluateBlueprintCoverage({
      blueprint: BLUEPRINT,
      analysis: ANALYSIS,
      evidenceRegions: EVIDENCE_REGIONS,
      adaptationContract: null,
    });
    expect(coverage.status).toBe("COVERED");
    expect(coverage.claimedMassRatio).toBe(1);
  });

  it("GAPS when a major measured mass is silently dropped — aggregation must not erase", () => {
    const lossy: VisualBlueprint = {
      ...BLUEPRINT,
      homepageRegions: BLUEPRINT.homepageRegions.filter((region) => region.id !== "r2"),
      homepageFirstViewport: { summary: "hero", regionIds: ["r1"] },
    };
    const coverage = evaluateBlueprintCoverage({
      blueprint: lossy,
      analysis: ANALYSIS,
      evidenceRegions: EVIDENCE_REGIONS,
      adaptationContract: null,
    });
    expect(coverage.status).toBe("GAPS");
    expect(coverage.uncoveredMasses).toEqual([{ regionId: "r2", viewportHeightRatio: 0.98 }]);
    expect(coverage.reasons.join(" ")).toContain("r2");
  });

  it("COVERED when the dropped mass is explicitly declared in the Adaptation Contract", () => {
    const lossy: VisualBlueprint = {
      ...BLUEPRINT,
      homepageRegions: BLUEPRINT.homepageRegions.filter((region) => region.id !== "r2"),
    };
    const contract: AdaptationContract = {
      version: "1",
      unsupportedFeatures: [{ feature: "mass:r2", reason: "carousel band accepted as static substitute" }],
      acceptedApproximations: [{ replaces: "mass:r2", substituteOutcome: "single static band" }],
      qaExceptions: [],
    };
    const coverage = evaluateBlueprintCoverage({
      blueprint: lossy,
      analysis: ANALYSIS,
      evidenceRegions: EVIDENCE_REGIONS,
      adaptationContract: contract,
    });
    expect(coverage.status).toBe("COVERED");
  });

  it("GAPS when an identity-defining analysis trait is erased by the Blueprint", () => {
    const traitless: VisualBlueprint = {
      ...BLUEPRINT,
      signatureTraits: [BLUEPRINT.signatureTraits[0]],
    };
    const coverage = evaluateBlueprintCoverage({
      blueprint: traitless,
      analysis: ANALYSIS,
      evidenceRegions: EVIDENCE_REGIONS,
      adaptationContract: null,
    });
    expect(coverage.status).toBe("GAPS");
    expect(coverage.uncoveredTraits).toEqual(["trait-region-flow"]);
  });

  it("sub-threshold segments stay free: significance-based, not count-based", () => {
    const coverage = evaluateBlueprintCoverage({
      blueprint: BLUEPRINT,
      analysis: ANALYSIS,
      evidenceRegions: [
        { id: "r1", viewportHeightRatio: 0.9 },
        { id: "spacer-a", viewportHeightRatio: 0.05 },
        { id: "spacer-b", viewportHeightRatio: 0.1 },
      ],
      adaptationContract: null,
    });
    expect(coverage.status).toBe("COVERED");
  });

  it("GAPS when an extraction image-mass band lies outside claimed territory", () => {
    const evidence: ReferenceEvidence["extraction"] = {
      version: "rowband-v1",
      extractor: "rowband-v1",
      sourceArtifact: "reference/screenshot.png",
      sourceSha256: "abc",
      coverage: { decoded: true, width: 1024, height: 1560, sampledWidth: 160 },
      bands: [],
      imageMasses: [{ boundingBox: { x: 0, y: 1200, width: 1024, height: 360 }, density: 0.7 }],
      surfaceSequence: [],
      containerWidthRatio: null,
      colourRoles: { background: null, accents: [] },
      imageMassRatio: 0.23,
    };
    // r4 spans y 780-1420 in full-res coordinates: the mass at 1200-1560
    // overlaps r4 (claimed) — covered.
    const evidenceWithGeometry = EVIDENCE_REGIONS.map((region, index) => ({
      ...region,
      startY: index * 350,
      endY: index * 350 + 340,
    }));
    const covered = evaluateBlueprintCoverage({
      blueprint: BLUEPRINT,
      analysis: ANALYSIS,
      evidenceRegions: evidenceWithGeometry,
      extraction: evidence,
      adaptationContract: null,
    });
    expect(covered.status).toBe("COVERED");

    // Shift the mass far below every claimed region — uncovered.
    const shifted: ReferenceEvidence["extraction"] = {
      ...evidence,
      imageMasses: [{ boundingBox: { x: 0, y: 5000, width: 1024, height: 360 }, density: 0.7 }],
    };
    const gap = evaluateBlueprintCoverage({
      blueprint: BLUEPRINT,
      analysis: ANALYSIS,
      evidenceRegions: evidenceWithGeometry,
      extraction: shifted,
      adaptationContract: null,
    });
    expect(gap.status).toBe("GAPS");
    expect(gap.uncoveredImageMasses).toEqual(["y:5000-5360"]);
  });
});

// ── Multimodal analyzer ───────────────────────────────────────────────────────

function measuredEvidence(): ReferenceEvidence {
  return {
    version: "2",
    screenshotId: "reference/screenshot.png",
    screenshotMetadata: { pixelWidth: 1440, pixelHeight: 3600, likelyCssViewportWidth: 1440 },
    captures: [],
    regions: EVIDENCE_REGIONS.map((region) => ({ ...region, height: 900 })),
    measuredElements: [
      { selectorHint: "header", role: "banner", boundingBox: { x: 0, y: 0, width: 1440, height: 800 }, confidence: "HIGH", source: "DOM" },
    ],
    responsiveObservations: [],
    motionObservations: [],
    discrepancies: [],
    visualInputs: [{ kind: "full-page", artifact: "reference/visual/full-page.png", sha256: "deadbeef", width: 1024, height: 2560 }],
  };
}

describe("multimodal Reference Analysis (issue #42)", () => {
  it("routes through the vision seam when visual inputs exist; text seam untouched", async () => {
    const screenshotKey = `references/uploads/mm-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 1440, height: 3200 })));
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "MM Probe Co", contactEmail: "mm@probe.example" },
        reference: { screenshotR2Key: screenshotKey },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    let visionCalled = false;
    let textCalled = false;
    const visionGenerate: RawAiGenerate = async (_system, user) => {
      visionCalled = true;
      expect(user).toContain("VISUAL PACKAGE ATTACHED");
      expect(user).toContain("reference/visual/full-page.png");
      return { content: JSON.stringify(ANALYSIS), provider: "vision-script", model: "glm-5.3-flash" };
    };

    const produced = await runReferenceAnalysisStage(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      evidence: measuredEvidence(),
      evidenceR2Key: "reference/evidence.json",
      visionGenerate,
      generate: async () => {
        textCalled = true;
        throw new Error("text seam must not run when visual inputs exist");
      },
    });
    expect(visionCalled).toBe(true);
    expect(textCalled).toBe(false);
    expect(produced.analysis.signatureTraits.length).toBe(2);

    // Provenance records the visual input artifacts.
    const run = await env.DB.prepare(
      "SELECT input_artifact_ids_json FROM ai_stage_runs WHERE build_id = ? AND prompt_id = 'reference-analyzer' ORDER BY created_at DESC LIMIT 1"
    )
      .bind(created.buildId)
      .first<{ input_artifact_ids_json: string }>();
    const artifacts = JSON.parse(run!.input_artifact_ids_json) as string[];
    expect(artifacts).toContain("reference/visual/full-page.png");
  });

  it("the production vision adapter refuses to run blind when the visual artifact is missing", async () => {
    const adapter = createProductionVisionGenerate(
      env,
      [{ kind: "full-page", artifact: "references/uploads/does-not-exist.png", sha256: "x", width: 10, height: 10 }],
      { buildId: "build-context", buildVersionNumber: 1 }
    );
    await expect(adapter("system", "user", 1)).rejects.toMatchObject({ code: "VISION_INPUT_UNAVAILABLE" });
  });

  it("the analysis prompt declares visual package metadata and evidence authority", () => {
    const prompt = buildAnalysisUserPrompt(measuredEvidence(), measuredEvidence().visualInputs);
    expect(prompt).toContain("VISUAL PACKAGE ATTACHED");
    expect(prompt).toContain('"sha256":"deadbeef"');
    expect(prompt).toContain("the JSON evidence remains the authority for every MEASURED fact");
  });
});

// ── Pipeline enforcement: coverage gap stops generation ──────────────────────

describe("pipeline blueprint coverage enforcement (issue #42)", () => {
  it("a blueprint that drops a major evidence mass routes to HUMAN_REVIEW_REQUIRED without generating", async () => {
    const screenshotKey = `references/uploads/cov-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 1440, height: 3200 })));
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Coverage Gate Co", contactEmail: "cov@gate.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const base = createPipelineScripts();
    const lossyBlueprintGenerate: RawAiGenerate = async (system, user, attempt) => {
      if (user.includes("Produce the binding Visual Blueprint")) {
        const response = await (base.generate!(system, user, attempt) as ReturnType<RawAiGenerate>);
        const blueprint = JSON.parse(response.content) as VisualBlueprint;
        // Drop the canonical region claiming r2 (0.98 viewports — a major mass).
        blueprint.homepageRegions = blueprint.homepageRegions.filter((region) => region.id !== "r2");
        blueprint.homepageFirstViewport = { summary: "hero", regionIds: ["r1"] };
        return { ...response, content: JSON.stringify(blueprint) };
      }
      return base.generate!(system, user, attempt);
    };

    let generateCalledAfterBlueprint = false;
    const scripted: Parameters<typeof runBuildPipeline>[1]["deps"] = {
      ...base,
      generate: async (system, user, attempt) => {
        const result = await lossyBlueprintGenerate(system, user, attempt);
        if (user.includes("Produce the binding Visual Blueprint")) generateCalledAfterBlueprint = true;
        return result;
      },
    };

    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      deps: scripted,
    });
    void generateCalledAfterBlueprint;

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("BLUEPRINT_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("r2");

    // No Implementation Contract was produced from the lossy Blueprint.
    const contract = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'implementation_contract'"
    )
      .bind(created.buildVersionId)
      .first<{ n: number }>();
    expect(contract!.n).toBe(0);

    const event = await env.DB.prepare(
      "SELECT stage, to_state FROM build_workflow_events WHERE build_id = ? AND stage = 'blueprint_coverage'"
    )
      .bind(created.buildId)
      .first<{ stage: string; to_state: string }>();
    expect(event!.to_state).toBe("HUMAN_REVIEW_REQUIRED");
  });
});
