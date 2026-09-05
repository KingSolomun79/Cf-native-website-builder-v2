import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn, type ReferenceCaptureOutput } from "../src/domain/reference-intake";
import {
  runReferenceAnalysisStage,
  validateAnalysisAgainstEvidence,
  type ReferenceAnalysis,
} from "../src/domain/reference-analysis";
import {
  runVisualBlueprintStage,
  validateBlueprintIdentityPreservation,
  validateBlueprintConsistency,
  lintBlueprintForReferenceContent,
  type VisualBlueprint,
} from "../src/domain/visual-blueprint";
import {
  produceImplementationContract,
  validateContractAgainstBlueprint,
  planImplementationContract,
} from "../src/domain/implementation-planner";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { putObject } from "../src/lib/assets";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";
import { buildPng } from "./helpers/png";

// Primary-seam tests for Reference Analysis -> Visual Blueprint ->
// Implementation Contract (issue #8): separation, immutability, identity
// preservation and the blueprint/contract boundaries.

const env = providedEnv as unknown as Env;

function captureOutput(): ReferenceCaptureOutput {
  return {
    canonicalScreenshot: { content: new TextEncoder().encode("PNG-live"), mimeType: "image/png", pixelWidth: 1440, pixelHeight: 4800, likelyCssViewportWidth: 1440 },
    captures: [{ viewportWidth: 1440, viewportHeight: 900, content: new TextEncoder().encode("PNG-live-1440"), mimeType: "image/png" }],
    regions: [
      { id: "region-1", startY: 0, endY: 720, height: 720, viewportHeightRatio: 0.8 },
      { id: "region-2", startY: 720, endY: 1600, height: 880, viewportHeightRatio: 0.98 },
      { id: "region-3", startY: 1600, endY: 2400, height: 800, viewportHeightRatio: 0.89 },
      { id: "region-4", startY: 2400, endY: 3000, height: 600, viewportHeightRatio: 0.67 },
    ],
    measuredElements: [
      { selectorHint: "header nav", role: "navigation", boundingBox: { x: 0, y: 0, width: 1440, height: 80 }, confidence: "HIGH", source: "DOM" },
      { selectorHint: "h1", role: "typography", computed: { fontFamily: "Editorial Serif", fontSize: "72px" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" },
    ],
    responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop"] }],
    motionObservations: [],
    discrepancies: [],
  };
}

function generateReturning(responseFor: (stage: "reference-analyzer" | "visual-blueprint-generator") => string): RawAiGenerate {
  return async (systemPrompt) => ({
    content: responseFor(systemPrompt.includes("01-reference-analyzer") ? "reference-analyzer" : "visual-blueprint-generator"),
    provider: "test",
    model: "test-model-y",
  });
}

const ANALYSIS_JSON: ReferenceAnalysis = {
  version: "1",
  visualSystemSummary: "Editorial asymmetric system with oversized serif display, generous whitespace and dark/light section alternation.",
  hierarchy: [{ level: "display", description: "Oversized serif headline dominates first viewport", confidence: "HIGH" }],
  signatureTraits: [
    { id: "trait-oversized-serif", description: "Oversized serif display type", identityDefining: true, evidenceRefs: ["h1"] },
    { id: "trait-asymmetric-grid", description: "Asymmetric two-column grid", identityDefining: true, evidenceRefs: ["region-1"] },
    { id: "trait-alternating-surfaces", description: "Dark/light surface sequence", identityDefining: false, evidenceRefs: ["region-2"] },
  ],
  designIntent: [{ hypothesis: "Magazine-style authority for a premium local business", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "Full-bleed editorial photography with people at work", imageRoles: ["hero", "craft-detail"] },
  responsiveBehavior: ["two-column collapses to single column at 768px"],
  motionBehavior: ["subtle fade-up reveals"],
  identityCarriers: ["trait-oversized-serif", "trait-asymmetric-grid"],
};

const BLUEPRINT_JSON: VisualBlueprint = {
  version: "1",
  visualThesis: "Premium editorial clarity for a local craft business: oversized serif statements over generous whitespace with asymmetric image/text balance.",
  signatureTraits: [
    { id: "bp-serif", description: "Oversized serif display type for the Business's own headlines", sourceTraitId: "trait-oversized-serif" },
    { id: "bp-asymmetric", description: "Asymmetric two-column composition", sourceTraitId: "trait-asymmetric-grid" },
    { id: "bp-surfaces", description: "Alternating dark/light surfaces", sourceTraitId: "trait-alternating-surfaces" },
  ],
  fidelityPriorities: ["first viewport topology", "region order", "whitespace rhythm"],
  tokens: { "color.ink": "#1a1a1a", "color.paper": "#faf7f2", "font.display": "Public Domain Serif", "space.section": "clamp(4rem, 10vh, 8rem)" },
  globalGrid: { containerLogic: "max-width 1200px with 12-col grid; hero spans 5/7 asymmetric split", columnRatios: ["5/7", "4/8"] },
  spacingRhythm: "Large section padding with tight intra-component spacing",
  typographyRoles: [
    { role: "display", description: "Oversized serif for page thesis statements" },
    { role: "body", description: "Readable humanist sans" },
  ],
  colorRoles: [
    { role: "ink", description: "near-black text" },
    { role: "paper", description: "warm off-white surfaces" },
  ],
  surfaceLanguage: "Flat surfaces alternating warm paper and deep ink sections",
  headerNavigation: "Minimal sticky header, wordmark left, plain links right",
  homepageFirstViewport: { summary: "Asymmetric split: left serif statement over paper, right full-height editorial image", regionIds: ["hero"] },
  homepageRegions: [
    { id: "hero", purpose: "Business thesis statement with editorial image", imageRoleId: "role-hero", sourceEvidenceRegionIds: ["region-1"] },
    { id: "intro", purpose: "Business introduction and supported facts", sourceEvidenceRegionIds: ["region-2"] },
    { id: "services-overview", purpose: "Service teasers", imageRoleId: "role-detail", sourceEvidenceRegionIds: ["region-3"] },
    { id: "contact-cta", purpose: "Call to action into contact page", sourceEvidenceRegionIds: ["region-4"] },
  ],
  imageSystem: {
    photographyGrammar: "Editorial documentary photography, natural light, people at work",
    imageRoles: [
      { id: "role-hero", purpose: "First-viewport editorial hero image", priority: "CRITICAL" },
      { id: "role-detail", purpose: "Supporting craft detail images", priority: "NORMAL" },
    ],
  },
  motionGrammar: ["subtle fade-up on scroll"],
  responsiveContract: ["asymmetric split stacks below 768px", "nav collapses to button menu at 768px"],
  innerPageVocabulary: ["page-header", "content-section", "fact-list", "cta-band"],
  antiFallbackRules: ["never collapse asymmetric grid into centered stack on desktop", "never replace serif display with body sans"],
  accessibilityAdaptations: ["contrast raised to WCAG AA on adapted palette"],
  declaredLimitations: [],
};

const FACTS: BusinessFacts = {
  businessName: "Rift Valley Roasters",
  contactEmail: "hello@rvr.example",
  businessType: "coffee roastery",
};

async function newPipeline(options: { referenceUrl?: string | null } = {}): Promise<{
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
  evidenceR2Key: string;
}> {
  const referenceUrl = options.referenceUrl === undefined ? "https://reference.example.com/" : options.referenceUrl;
  const screenshotKey = `references/uploads/ra-${Math.random().toString(36).slice(2)}.png`;
  await putObject(env, screenshotKey, buildPng());
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: FACTS,
      reference: referenceUrl
        ? { url: referenceUrl, screenshotR2Key: screenshotKey }
        : { screenshotR2Key: screenshotKey },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const capture: ReferenceCaptureFn = async () => captureOutput();
  await runReferenceIntake(env, {
    siteGenerationId: started.siteGenerationId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
    buildVersionNumber: 1,
    capture,
  });
  const frozen = (await getFrozenReferenceEvidence(env, started.siteGenerationId))!;
  return {
    siteGenerationId: started.siteGenerationId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
    evidenceR2Key: frozen.evidenceR2Key,
  };
}

function contextOf(p: { siteGenerationId: string; buildId: string; buildVersionId: string }) {
  return {
    siteGenerationId: p.siteGenerationId,
    buildId: p.buildId,
    buildVersionId: p.buildVersionId,
    buildVersionNumber: 1,
  };
}

async function runAnalysis(p: Awaited<ReturnType<typeof newPipeline>>): Promise<{ analysis: ReferenceAnalysis; r2Key: string }> {
  const frozen = (await getFrozenReferenceEvidence(env, p.siteGenerationId))!;
  const produced = await runReferenceAnalysisStage(env, {
    ...contextOf(p),
    evidence: frozen.evidence,
    evidenceR2Key: p.evidenceR2Key,
    generate: generateReturning(() => JSON.stringify(ANALYSIS_JSON)),
  });
  return { analysis: produced.analysis, r2Key: produced.artifactR2Key };
}

async function evidenceRegionsOf(p: Awaited<ReturnType<typeof newPipeline>>) {
  return (await getFrozenReferenceEvidence(env, p.siteGenerationId))!.evidence.regions;
}

describe("Reference Analysis stage", () => {
  it("interprets frozen evidence, persists a versioned artifact with provenance, and leaves evidence untouched", async () => {
    const pipeline = await newPipeline();
    const evidenceTextBefore = await new Response((await env.SITE_BUCKET.get(pipeline.evidenceR2Key))!.body).text();

    const { analysis, r2Key } = await runAnalysis(pipeline);
    expect(analysis.signatureTraits).toHaveLength(3);

    const stored = await getBuildStageArtifact<ReferenceAnalysis>(env, pipeline.buildVersionId, "reference_analysis");
    expect(stored!.value.signatureTraits[0].id).toBe("trait-oversized-serif");
    expect(stored!.schemaVersion).toBe("reference-analysis/1");
    expect(stored!.provenance?.promptId).toBe("reference-analyzer");
    expect(stored!.provenance?.promptVersion).toBe("v3");
    expect(stored!.provenance?.model).toBe("test-model-y");
    expect(stored!.artifactR2Key).toBe(r2Key);

    // The frozen evidence is not rewritten by interpretation.
    const evidenceTextAfter = await new Response((await env.SITE_BUCKET.get(pipeline.evidenceR2Key))!.body).text();
    expect(evidenceTextAfter).toBe(evidenceTextBefore);

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(pipeline.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((row) => row.to_state)).toContain("REFERENCE_ANALYSIS");
  });

  it("rejects analysis that fabricates observations (dangling evidence anchors)", async () => {
    const pipeline = await newPipeline();
    const fabricated = JSON.parse(JSON.stringify(ANALYSIS_JSON)) as ReferenceAnalysis;
    fabricated.signatureTraits[0].evidenceRefs = ["region-does-not-exist"];

    const evidence = (await getFrozenReferenceEvidence(env, pipeline.siteGenerationId))!.evidence;
    expect(validateAnalysisAgainstEvidence(fabricated, evidence).valid).toBe(false);

    await expect(
      runReferenceAnalysisStage(env, {
        ...contextOf(pipeline),
        evidence,
        evidenceR2Key: pipeline.evidenceR2Key,
        generate: generateReturning(() => JSON.stringify(fabricated)),
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_FABRICATION" });

    // Nothing was persisted for the rejected run.
    expect(await getBuildStageArtifact(env, pipeline.buildVersionId, "reference_analysis")).toBeNull();
  });
});

describe("Visual Blueprint stage", () => {
  it("produces a binding Blueprint from Analysis + Business facts with provenance", async () => {
    const pipeline = await newPipeline();
    const { analysis, r2Key } = await runAnalysis(pipeline);

    const produced = await runVisualBlueprintStage(env, {
      ...contextOf(pipeline),
      analysis,
      analysisR2Key: r2Key,
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions: await evidenceRegionsOf(pipeline),
      generate: generateReturning(() => JSON.stringify(BLUEPRINT_JSON)),
    });
    expect(produced.blueprint.homepageRegions).toHaveLength(4);

    const stored = await getBuildStageArtifact<VisualBlueprint>(env, pipeline.buildVersionId, "visual_blueprint");
    expect(stored!.provenance?.promptId).toBe("visual-blueprint-generator");
    expect(stored!.provenance?.promptVersion).toBe("v4");

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(pipeline.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((row) => row.to_state)).toContain("BLUEPRINT");
  });

  it("rejects Business adaptation that erases identity-defining Reference traits", async () => {
    const pipeline = await newPipeline();
    const { analysis, r2Key } = await runAnalysis(pipeline);

    const erasing = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    // Stay schema-valid (3 traits) but stop preserving the identity-defining
    // 'trait-asymmetric-grid' — Business adaptation cannot erase it.
    erasing.signatureTraits = [
      erasing.signatureTraits[0],
      erasing.signatureTraits[2],
      { id: "bp-secondary", description: "Secondary supporting rhythm", sourceTraitId: "trait-alternating-surfaces" },
    ];
    expect(validateBlueprintIdentityPreservation(erasing, analysis).valid).toBe(false);

    await expect(
      runVisualBlueprintStage(env, {
        ...contextOf(pipeline),
        analysis,
        analysisR2Key: r2Key,
        facts: FACTS,
        adaptationContract: null,
        generate: generateReturning(() => JSON.stringify(erasing)),
      })
    ).rejects.toMatchObject({ code: "IDENTITY_ERASURE" });
  });

  it("repairs an identity-erasing blueprint with ONE informed regeneration carrying the rejection (production retest 2026-09-05)", async () => {
    const pipeline = await newPipeline();
    const { analysis, r2Key } = await runAnalysis(pipeline);

    const erasing = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    erasing.signatureTraits = [
      erasing.signatureTraits[0],
      erasing.signatureTraits[2],
      { id: "bp-secondary", description: "Secondary supporting rhythm", sourceTraitId: "trait-alternating-surfaces" },
    ];
    let repairCalls = 0;
    const produced = await runVisualBlueprintStage(env, {
      ...contextOf(pipeline),
      analysis,
      analysisR2Key: r2Key,
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions: await evidenceRegionsOf(pipeline),
      generate: async (_system, user) => {
        if (user.includes("Blueprint repair directives")) {
          repairCalls += 1;
          expect(user).toContain("IDENTITY_ERASURE");
          expect(user).toContain("trait-asymmetric-grid");
          return { content: JSON.stringify(BLUEPRINT_JSON), provider: "test", model: "test-model-b" };
        }
        return { content: JSON.stringify(erasing), provider: "test", model: "test-model-b" };
      },
    });

    expect(repairCalls).toBe(1);
    expect(produced.blueprint.signatureTraits.map((trait) => trait.sourceTraitId)).toContain("trait-asymmetric-grid");
    const stored = await getBuildStageArtifact<VisualBlueprint>(env, pipeline.buildVersionId, "visual_blueprint");
    expect(stored!.value.signatureTraits.map((trait) => trait.sourceTraitId)).toContain("trait-asymmetric-grid");
  });

  it("rejects Reference content copied into the Blueprint as Business content", async () => {
    const pipeline = await newPipeline({ referenceUrl: "https://editorialhouse.example.com/" });
    const { analysis, r2Key } = await runAnalysis(pipeline);

    const tainted = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    tainted.visualThesis = "Recreate editorialhouse.example.com exactly with their brand voice.";
    expect(lintBlueprintForReferenceContent(tainted, { referenceUrl: "https://editorialhouse.example.com/" }).clean).toBe(false);

    await expect(
      runVisualBlueprintStage(env, {
        ...contextOf(pipeline),
        analysis,
        analysisR2Key: r2Key,
        facts: FACTS,
        adaptationContract: null,
        referenceUrl: "https://editorialhouse.example.com/",
        generate: generateReturning(() => JSON.stringify(tainted)),
      })
    ).rejects.toMatchObject({ code: "REFERENCE_CONTENT_DETECTED" });
  });

  it("surfaces contradictory Blueprint conditions instead of silently simplifying", async () => {
    const contradictory = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    contradictory.homepageFirstViewport = { summary: "x", regionIds: ["intro", "hero"] };
    expect(validateBlueprintConsistency(contradictory).valid).toBe(false);

    const danglingRole = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    danglingRole.homepageRegions[1] = { ...danglingRole.homepageRegions[1], imageRoleId: "role-unknown" };
    const verdict = validateBlueprintConsistency(danglingRole);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.problems[0]).toContain("role-unknown");
  });
});

describe("Implementation Contract planner", () => {
  it("mirrors Blueprint topology, traits, first viewport and image roles verbatim", async () => {
    const contract = planImplementationContract({
      siteGenerationId: "sg",
      buildId: "b",
      buildVersionId: "bv",
      siteId: "site-1",
      blueprint: BLUEPRINT_JSON,
      facts: FACTS,
    });
    expect(contract.pages).toHaveLength(4);
    expect(contract.pages.map((page) => page.id)).toEqual(["home", "about", "services", "contact"]);
    expect(contract.blueprintVisualThesis).toBe(BLUEPRINT_JSON.visualThesis);
    expect(contract.blueprintSignatureTraitIds).toEqual(BLUEPRINT_JSON.signatureTraits.map((trait) => trait.id));
    const home = contract.pages.find((page) => page.id === "home")!;
    expect(home.regions.map((region) => region.id)).toEqual(BLUEPRINT_JSON.homepageRegions.map((region) => region.id));
    expect(contract.imageSlotStrategy).toEqual({ roleIds: ["role-hero", "role-detail"] });
    expect(contract.files).toEqual({
      sharedCss: "site.css",
      sharedJs: "site.js",
      pageFiles: { home: "index.html", about: "about.html", services: "services.html", contact: "contact.html" },
    });
    expect(contract.approvedDependencies).toEqual([]);
    expect(validateContractAgainstBlueprint(contract, BLUEPRINT_JSON).valid).toBe(true);
    // The form contract is platform-controlled; browser sends only identity + visitor fields.
    expect(contract.formContract.fields).toEqual(["name", "email", "message"]);
  });

  it("rejects contract changes to topology, traits, first viewport, image roles or thesis", () => {
    const base = planImplementationContract({ siteGenerationId: "sg", buildId: "b", buildVersionId: "bv", siteId: "site-1", blueprint: BLUEPRINT_JSON, facts: FACTS });

    const reordered = JSON.parse(JSON.stringify(base));
    reordered.pages[0].regions = [...reordered.pages[0].regions].reverse();
    expect(validateContractAgainstBlueprint(reordered, BLUEPRINT_JSON).valid).toBe(false);

    const traitChanged = JSON.parse(JSON.stringify(base));
    traitChanged.blueprintSignatureTraitIds = traitChanged.blueprintSignatureTraitIds.slice(0, 2);
    expect(validateContractAgainstBlueprint(traitChanged, BLUEPRINT_JSON).valid).toBe(false);

    const thesisChanged = JSON.parse(JSON.stringify(base));
    thesisChanged.blueprintVisualThesis = "A cheaper generic template";
    expect(validateContractAgainstBlueprint(thesisChanged, BLUEPRINT_JSON).valid).toBe(false);

    const roleInvented = JSON.parse(JSON.stringify(base));
    roleInvented.imageSlotStrategy = { roleIds: ["role-invented"] };
    expect(validateContractAgainstBlueprint(roleInvented, BLUEPRINT_JSON).valid).toBe(false);
  });

  it("surfaces impossible blueprint conditions as blockers, not silent simplification", () => {
    const impossible = JSON.parse(JSON.stringify(BLUEPRINT_JSON)) as VisualBlueprint;
    impossible.homepageRegions[1] = { ...impossible.homepageRegions[1], imageRoleId: "role-missing" };
    const contract = planImplementationContract({ siteGenerationId: "sg", buildId: "b", buildVersionId: "bv", blueprint: impossible, facts: FACTS });
    expect(contract.blockers).toEqual([
      { kind: "BLUEPRINT_REGION_IMAGE_ROLE_UNKNOWN", regionId: "intro", imageRoleId: "role-missing" },
    ]);
  });

  it("persists the contract immutably per Build Version alongside the other separated artifacts", async () => {
    const pipeline = await newPipeline();
    const { analysis, r2Key } = await runAnalysis(pipeline);
    const blueprintProduced = await runVisualBlueprintStage(env, {
      ...contextOf(pipeline),
      analysis,
      analysisR2Key: r2Key,
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions: await evidenceRegionsOf(pipeline),
      generate: generateReturning(() => JSON.stringify(BLUEPRINT_JSON)),
    });

    const siteId = (
      await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
        .bind(pipeline.siteGenerationId)
        .first<{ site_id: string }>()
    )!.site_id;
    const contractProduced = await produceImplementationContract(env, {
      siteGenerationId: pipeline.siteGenerationId,
      buildId: pipeline.buildId,
      buildVersionId: pipeline.buildVersionId,
      siteId,
      blueprint: blueprintProduced.blueprint,
      facts: FACTS,
    });
    expect(contractProduced.contract.pages).toHaveLength(4);

    // Re-planning the same artifact for the same Build Version is rejected.
    await expect(
      produceImplementationContract(env, {
        siteGenerationId: pipeline.siteGenerationId,
        buildId: pipeline.buildId,
        buildVersionId: pipeline.buildVersionId,
        siteId,
        blueprint: blueprintProduced.blueprint,
        facts: FACTS,
      })
    ).rejects.toMatchObject({ code: "ARTIFACT_ALREADY_EXISTS" });

    // Storage-level immutability for all stage artifacts.
    await expect(
      env.DB.prepare("UPDATE build_stage_artifacts SET schema_version = 'x' WHERE id = ?")
        .bind(contractProduced.artifactId)
        .run()
    ).rejects.toThrow("BUILD_STAGE_ARTIFACT_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM build_stage_artifacts WHERE id = ?").bind(contractProduced.artifactId).run()
    ).rejects.toThrow("BUILD_STAGE_ARTIFACT_IMMUTABLE");

    // Evidence, Analysis, Blueprint and Contract are four distinct immutable
    // artifacts with distinct keys/checksums.
    const analysisArtifact = await getBuildStageArtifact(env, pipeline.buildVersionId, "reference_analysis");
    const blueprintArtifact = await getBuildStageArtifact(env, pipeline.buildVersionId, "visual_blueprint");
    const contractArtifact = await getBuildStageArtifact(env, pipeline.buildVersionId, "implementation_contract");
    const keys = [pipeline.evidenceR2Key, analysisArtifact!.artifactR2Key, blueprintArtifact!.artifactR2Key, contractArtifact!.artifactR2Key];
    expect(new Set(keys).size).toBe(4);
    const checksums = [
      (await getFrozenReferenceEvidence(env, pipeline.siteGenerationId))!.evidence.version,
      analysisArtifact!.checksum,
      blueprintArtifact!.checksum,
      contractArtifact!.checksum,
    ];
    expect(new Set(checksums).size).toBeGreaterThan(1);

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(pipeline.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((row) => row.to_state)).toEqual([
      "INTAKE_READY", "REFERENCE_CHECK", "REFERENCE_EVIDENCE", "REFERENCE_ANALYSIS", "BLUEPRINT", "IMPLEMENTATION_PLAN",
    ]);
  });
});
