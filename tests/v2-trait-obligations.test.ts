import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { ReferenceAnalysisSchema, runReferenceAnalysisStage, type ReferenceAnalysis } from "../src/domain/reference-analysis";
import {
  VisualBlueprintSchema,
  validateBlueprintIdentityPreservation,
  evaluateBlueprintCoverage,
  evaluateTraitObligations,
  buildBlueprintUserPrompt,
  runVisualBlueprintStage,
  type TraitObligation,
  type VisualBlueprint,
} from "../src/domain/visual-blueprint";
import type { AdaptationContract } from "../src/domain/reference-evidence-schema";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { putObject } from "../src/lib/assets";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";
import { buildPng } from "./helpers/png";
import { FROZEN_RANKFORGE_ANALYSIS, FROZEN_RANKFORGE_EVIDENCE } from "./_generated-rankforge-frozen";

// Issue #59 — Reference Analysis / Blueprint Trait Obligation Contract.
// Regression ground: the 2026-09-06 RankForge production run where the frozen
// analysis carried 10 signature traits (9 identity-defining) against a
// Blueprint schema capped at 8, making the identity gate unsatisfiable.

const env = providedEnv as unknown as Env;

// Verbatim frozen production analysis: 10 traits, 9 identity-defining.
const FROZEN = FROZEN_RANKFORGE_ANALYSIS as unknown as ReferenceAnalysis;

const CONTRACT: AdaptationContract = {
  version: "1",
  unsupportedFeatures: [{ feature: "heavy_parallax", reason: "scroll-linked choreography outside static-light dependencies" }],
  acceptedApproximations: [{ replaces: "heavy_parallax", substituteOutcome: "static composition with reduced-motion-safe reveals" }],
  qaExceptions: [],
};

const ANALYSIS: ReferenceAnalysis = {
  version: "1",
  visualSystemSummary: "Violet capsule control system over photographic hero masses with parallax motion.",
  hierarchy: [{ level: "display", description: "Oversized headline dominates the first viewport", confidence: "HIGH" }],
  signatureTraits: [
    { id: "trait-violet-pill-system", description: "Systemic rounded-pill violet buttons for every CTA (capsule geometry)", identityDefining: true, evidenceRefs: ["region-1"] },
    { id: "trait-photo-hero", description: "Full-bleed photographic hero mass", identityDefining: true, evidenceRefs: ["region-1"] },
    { id: "trait-parallax-motion", description: "Scroll-linked parallax choreography across hero media", identityDefining: true, evidenceRefs: ["region-2"] },
  ],
  designIntent: [{ hypothesis: "playful tech authority", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "documentary workspace imagery", imageRoles: ["hero"] },
  responsiveBehavior: [],
  motionBehavior: ["parallax"],
  identityCarriers: ["trait-violet-pill-system", "trait-photo-hero", "trait-parallax-motion"],
};

function obligationsFixture(): TraitObligation[] {
  return [
    { sourceTraitId: "trait-violet-pill-system", disposition: "PRESERVED", realizedByRegionIds: ["hero", "faq"] },
    { sourceTraitId: "trait-photo-hero", disposition: "PRESERVED", realizedByRegionIds: ["hero"] },
    { sourceTraitId: "trait-parallax-motion", disposition: "ADAPTED", realizedByRegionIds: ["hero"], adaptationClauseId: "heavy_parallax" },
  ];
}

function stripClause(obligation: TraitObligation): TraitObligation {
  const { adaptationClauseId: _drop, ...rest } = obligation;
  void _drop;
  return rest;
}

function blueprintWith(traitObligations?: TraitObligation[]): VisualBlueprint {
  return {
    version: "1",
    visualThesis: "Capsule control language over photographic hero masses for the Business.",
    signatureTraits: [
      // Deliberately NOT named after the analysis trait ids: identity must not
      // depend on repeating magic names (issue #59 §10).
      { id: "bp-cta-voice", description: "Capsule accent buttons carry every call to action", sourceTraitId: "trait-violet-pill-system" },
      { id: "bp-opening-mass", description: "Full-bleed photographic opening", sourceTraitId: "trait-photo-hero" },
      { id: "bp-depth-cues", description: "Scroll depth cues within reduced-motion limits", sourceTraitId: "trait-parallax-motion" },
    ],
    ...(traitObligations ? { traitObligations } : {}),
    fidelityPriorities: ["1. first viewport mass — identity defining", "2. capsule control geometry — repeated component language"],
    tokens: { "color.accent": "#8E2DE2", "radius.pill": "999px" },
    globalGrid: { containerLogic: "max-width 1200px, asymmetric hero split", columnRatios: ["5/7"] },
    spacingRhythm: "Generous section padding",
    typographyRoles: [{ role: "display", description: "oversized statements" }],
    colorRoles: [{ role: "accent", description: "violet capsule family" }],
    surfaceLanguage: "Flat alternating surfaces",
    headerNavigation: "Minimal sticky header",
    homepageFirstViewport: { summary: "Photographic hero opening", regionIds: ["hero"] },
    homepageRegions: [
      { id: "hero", purpose: "Business thesis over photographic mass", sourceEvidenceRegionIds: ["region-1"] },
      { id: "services", purpose: "Service teasers", sourceEvidenceRegionIds: ["region-2"] },
      { id: "faq", purpose: "Pill accordion support", sourceEvidenceRegionIds: ["region-3"] },
    ],
    imageSystem: {
      photographyGrammar: "documentary workspace imagery",
      imageRoles: [{ id: "role-hero", purpose: "hero photograph", priority: "CRITICAL" }],
    },
    motionGrammar: ["reduced-motion-safe reveals"],
    responsiveContract: ["regions stack below 768px"],
    innerPageVocabulary: ["page-header", "content-section"],
    antiFallbackRules: ["never replace capsule controls with square default buttons"],
    accessibilityAdaptations: ["focus rings on capsule controls"],
    declaredLimitations: [],
  };
}

const FACTS: BusinessFacts = { businessName: "Fixture Business", contactEmail: "hi@fixture.example", businessType: "studio" };

async function newBuild(): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const screenshotKey = `references/uploads/to-${Math.random().toString(36).slice(2)}.png`;
  await putObject(env, screenshotKey, buildPng());
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: FACTS,
      reference: { url: "https://reference.example.com/", screenshotR2Key: screenshotKey },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

describe("Reference Analysis trait contract (issue #59)", () => {
  it("the frozen production analysis (10 traits, 9 identity-defining) is schema-invalid at the analysis boundary", () => {
    expect(FROZEN.signatureTraits).toHaveLength(10);
    expect(FROZEN.signatureTraits.filter((trait) => trait.identityDefining)).toHaveLength(9);
    expect(Value.Check(ReferenceAnalysisSchema, FROZEN)).toBe(false);
  });

  it("rejects >8 traits and <3 traits; accepts 3-8", () => {
    const over = (arr: unknown[]) => ({
      version: "1",
      visualSystemSummary: "s",
      hierarchy: [{ level: "l", description: "d", confidence: "HIGH" as const }],
      signatureTraits: arr,
      designIntent: [{ hypothesis: "h", confidence: "MEDIUM" as const }],
      photographicGrammar: { summary: "s", imageRoles: [] },
      responsiveBehavior: [],
      motionBehavior: [],
      identityCarriers: ["x"],
    });
    const trait = (i: number) => ({ id: `t${i}`, description: "d", identityDefining: i % 2 === 0, evidenceRefs: ["region-1"] });
    expect(Value.Check(ReferenceAnalysisSchema, over(Array.from({ length: 9 }, (_, i) => trait(i))))).toBe(false);
    expect(Value.Check(ReferenceAnalysisSchema, over(Array.from({ length: 8 }, (_, i) => trait(i))))).toBe(true);
    expect(Value.Check(ReferenceAnalysisSchema, over([trait(1), trait(2)]))).toBe(false);
    expect(Value.Check(ReferenceAnalysisSchema, ANALYSIS)).toBe(true);
  });

  it("derives a compliant <=8-trait analysis through the boundary's targeted schema repair, never by silent truncation", async () => {
    const build = await newBuild();
    // Modeled compliant repair: a ranked 3-8 subset returned by the model on
    // the boundary's schema-repair attempt. The non-identity logos strip and
    // the header pill CTA (already carried inside the violet system and hero
    // trait descriptions) rank out; every kept trait keeps valid anchors.
    const repaired = {
      ...FROZEN,
      signatureTraits: FROZEN.signatureTraits.filter(
        (trait) => trait.id !== "trusted-logos-strip" && trait.id !== "floating-pill-nav-cta"
      ),
    };
    expect(repaired.signatureTraits).toHaveLength(8);
    let sawFrozenAttempt = false;
    const generate: RawAiGenerate = async (_system, _user, attempt) => {
      if (attempt === 1) {
        sawFrozenAttempt = true;
        return { content: JSON.stringify(FROZEN), provider: "test", model: "frozen-replay" };
      }
      return { content: JSON.stringify(repaired), provider: "test", model: "frozen-repair" };
    };

    const produced = await runReferenceAnalysisStage(env, {
      ...build,
      buildVersionNumber: 1,
      evidence: FROZEN_RANKFORGE_EVIDENCE,
      evidenceR2Key: "builds/fixture/v1/evidence/reference/evidence.json",
      // The frozen evidence carries visual inputs (production vision path);
      // the visionGenerate test seam carries the scripted repair conversation.
      visionGenerate: generate,
      generate,
    });
    expect(sawFrozenAttempt).toBe(true);
    expect(produced.analysis.signatureTraits).toHaveLength(8);

    const stored = await getBuildStageArtifact<ReferenceAnalysis>(env, build.buildVersionId, "reference_analysis");
    expect(stored!.schemaVersion).toBe("reference-analysis/2");
    expect(stored!.value.signatureTraits.length).toBeLessThanOrEqual(8);
  });
});

describe("Trait obligation ledger (issue #59)", () => {
  it("accepts a blueprint whose ledger disposes of every binding trait exactly once", () => {
    expect(validateBlueprintIdentityPreservation(blueprintWith(obligationsFixture()), ANALYSIS, CONTRACT).valid).toBe(true);
  });

  it("rejects a missing ledger, a missing obligation (erasure), duplicates and unknown sources", () => {
    const none = validateBlueprintIdentityPreservation(blueprintWith(), ANALYSIS, CONTRACT);
    expect(none.valid).toBe(false);
    if (!none.valid) expect(none.problems.join("; ")).toContain("no traitObligations ledger");

    const partial = blueprintWith(obligationsFixture().slice(0, 2));
    const erased = validateBlueprintIdentityPreservation(partial, ANALYSIS, CONTRACT);
    expect(erased.valid).toBe(false);
    if (!erased.valid) expect(erased.problems.join("; ")).toContain("trait-parallax-motion");

    const duplicated = validateBlueprintIdentityPreservation(
      blueprintWith([...obligationsFixture(), obligationsFixture()[0]]),
      ANALYSIS,
      CONTRACT
    );
    expect(duplicated.valid).toBe(false);
    if (!duplicated.valid) expect(duplicated.problems.join("; ")).toContain("duplicate disposition");

    const unknown = validateBlueprintIdentityPreservation(
      blueprintWith([...obligationsFixture(), { sourceTraitId: "trait-never-analyzed", disposition: "PRESERVED", realizedByRegionIds: ["hero"] }]),
      ANALYSIS,
      CONTRACT
    );
    expect(unknown.valid).toBe(false);
    if (!unknown.valid) expect(unknown.problems.join("; ")).toContain("unknown analysis trait");

    const nonCarrier = validateBlueprintIdentityPreservation(
      blueprintWith([
        ...obligationsFixture(),
        { sourceTraitId: "trait-noncarrier", disposition: "PRESERVED", realizedByRegionIds: ["hero"] },
      ]),
      { ...ANALYSIS, signatureTraits: [...ANALYSIS.signatureTraits, { id: "trait-noncarrier", description: "minor", identityDefining: false, evidenceRefs: ["region-2"] }] },
      CONTRACT
    );
    expect(nonCarrier.valid).toBe(false);
    if (!nonCarrier.valid) expect(nonCarrier.problems.join("; ")).toContain("not identity-defining");
  });

  it("rejects PRESERVED obligations that point at nonexistent canonical regions or cite a clause", () => {
    const dangling = blueprintWith(obligationsFixture().map((o, i) => (i === 0 ? { ...o, realizedByRegionIds: ["region-never-declared"] } : o)));
    const verdict = validateBlueprintIdentityPreservation(dangling, ANALYSIS, CONTRACT);
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.problems.join("; ")).toContain("nonexistent canonical region");

    const contradictory = blueprintWith(
      obligationsFixture().map((o, i) => (i === 0 ? { ...o, adaptationClauseId: "heavy_parallax" } : o))
    );
    const contradictoryVerdict = validateBlueprintIdentityPreservation(contradictory, ANALYSIS, CONTRACT);
    expect(contradictoryVerdict.valid).toBe(false);
    if (!contradictoryVerdict.valid) expect(contradictoryVerdict.problems.join("; ")).toContain("PRESERVED but also cites");
  });

  it("requires an existing, related Adaptation Contract clause for ADAPTED (FDR #110 authority)", () => {
    // schema: realizedByRegionIds minItems 1 — an empty claim cannot even validate.
    const emptyClaim = Value.Check(VisualBlueprintSchema, {
      ...blueprintWith(),
      traitObligations: [{ sourceTraitId: "trait-violet-pill-system", disposition: "PRESERVED", realizedByRegionIds: [] }],
    });
    expect(emptyClaim).toBe(false);

    // ADAPTED without any clause id.
    const noClause = blueprintWith(obligationsFixture().map((o) => stripClause(o)));
    expect(validateBlueprintIdentityPreservation(noClause, ANALYSIS, CONTRACT).valid).toBe(false);

    // ADAPTED with no contract at all.
    const noContract = blueprintWith(obligationsFixture());
    expect(validateBlueprintIdentityPreservation(noContract, ANALYSIS, null).valid).toBe(false);

    // ADAPTED citing a clause the contract does not contain.
    const unknownClause = blueprintWith(
      obligationsFixture().map((o) => (o.disposition === "ADAPTED" ? { ...o, adaptationClauseId: "cargo_motion" } : o))
    );
    const unknownVerdict = validateBlueprintIdentityPreservation(unknownClause, ANALYSIS, CONTRACT);
    expect(unknownVerdict.valid).toBe(false);
    if (!unknownVerdict.valid) expect(unknownVerdict.problems.join("; ")).toContain("unknown adaptation clause");

    // ADAPTED citing an existing but unrelated clause (violet trait under parallax).
    const unrelated = blueprintWith(
      obligationsFixture().map((o, i) => (i === 0 ? { ...o, disposition: "ADAPTED" as const, adaptationClauseId: "heavy_parallax" } : o))
    );
    const unrelatedVerdict = validateBlueprintIdentityPreservation(unrelated, ANALYSIS, CONTRACT);
    expect(unrelatedVerdict.valid).toBe(false);
    if (!unrelatedVerdict.valid) expect(unrelatedVerdict.problems.join("; ")).toContain("unrelated clause");
  });

  it("does not depend on magic trait names: identity passes through unrelated internal naming", () => {
    const bp = blueprintWith(obligationsFixture());
    // bp-cta-voice carries the violet pill system without repeating its name.
    expect(bp.signatureTraits.some((trait) => /violet|pill/.test(trait.id))).toBe(false);
    expect(validateBlueprintIdentityPreservation(bp, ANALYSIS, CONTRACT).valid).toBe(true);
  });

  it("rejects genuine erasure: a removed capsule system cannot be smuggled past the ledger", () => {
    const bp = blueprintWith(obligationsFixture());
    const removing = bp.traitObligations!.filter((o) => o.sourceTraitId !== "trait-violet-pill-system");
    const verdict = validateBlueprintIdentityPreservation(
      { ...bp, traitObligations: removing, signatureTraits: bp.signatureTraits.filter((t) => t.id !== "bp-cta-voice") },
      ANALYSIS,
      CONTRACT
    );
    expect(verdict.valid).toBe(false);
    if (!verdict.valid) expect(verdict.problems.join("; ")).toContain("trait-violet-pill-system");
  });

  it("the ledger satisfies the #42 coverage contract", () => {
    const covered = evaluateBlueprintCoverage({
      blueprint: blueprintWith(obligationsFixture()),
      analysis: ANALYSIS,
      evidenceRegions: [],
      adaptationContract: CONTRACT,
    });
    expect(covered.status).toBe("COVERED");

    const gapped = evaluateBlueprintCoverage({
      blueprint: blueprintWith(obligationsFixture().slice(0, 2)),
      analysis: ANALYSIS,
      evidenceRegions: [],
      adaptationContract: CONTRACT,
    });
    expect(gapped.status).toBe("GAPS");
    expect(gapped.uncoveredTraits).toEqual(["trait-parallax-motion"]);
  });

  it("exposes per-obligation verdicts for repair preservation sets", () => {
    const ledger = obligationsFixture();
    const broken = [...ledger];
    broken[1] = { ...broken[1], realizedByRegionIds: ["region-ghost"] };
    const evaluation = evaluateTraitObligations(blueprintWith(broken), ANALYSIS, CONTRACT);
    expect(evaluation.satisfiedObligations.map((o) => o.sourceTraitId)).toEqual(["trait-violet-pill-system", "trait-parallax-motion"]);
    expect(evaluation.rejectedObligations).toHaveLength(1);
    expect(evaluation.rejectedObligations[0].problem).toContain("nonexistent canonical region");
    expect(evaluation.missingCarrierIds).toEqual([]);
  });

  it("the runtime prompt states the binding ledger, the fidelityPriorities string format and the schema agrees", () => {
    const prompt = buildBlueprintUserPrompt({ analysis: ANALYSIS, facts: FACTS, adaptationContract: CONTRACT, evidenceRegions: [] });
    expect(prompt).toContain("exactly one traitObligations entry");
    expect(prompt).toContain(JSON.stringify(["trait-violet-pill-system", "trait-photo-hero", "trait-parallax-motion"]));
    expect(prompt).toContain("N. dimension — reason");
    expect(
      Value.Check(VisualBlueprintSchema, { ...blueprintWith(obligationsFixture()), fidelityPriorities: ["1. first viewport mass — identity defining"] })
    ).toBe(true);
  });
});

describe("Boundary empty-string normalization (issue #59)", () => {
  it("strips empty-string optionals (production imageRoleId:\"\" failures) before schema validation", async () => {
    const build = await newBuild();
    const withEmptyRole = {
      ...blueprintWith(obligationsFixture()),
      homepageRegions: [
        { id: "hero", purpose: "Business thesis over photographic mass", imageRoleId: "role-hero", sourceEvidenceRegionIds: ["region-1"] },
        // A text-only region rendered by the model with an empty-string role.
        { id: "services", purpose: "Service teasers", imageRoleId: "", sourceEvidenceRegionIds: ["region-2"] },
        { id: "faq", purpose: "Pill accordion support", imageRoleId: "", sourceEvidenceRegionIds: ["region-3"] },
      ],
    };
    // The raw model output is schema-invalid; the boundary normalizes it.
    expect(Value.Check(VisualBlueprintSchema, JSON.parse(JSON.stringify(withEmptyRole)))).toBe(false);

    const produced = await runVisualBlueprintStage(env, {
      ...build,
      buildVersionNumber: 1,
      analysis: ANALYSIS,
      analysisR2Key: "builds/fixture/v1/reference_analysis.json",
      facts: FACTS,
      adaptationContract: CONTRACT,
      evidenceRegions: [],
      generate: async () => ({ content: JSON.stringify(withEmptyRole), provider: "test", model: "normalize-model" }),
    });
    expect(produced.blueprint.homepageRegions.find((region) => region.id === "services")!.imageRoleId).toBeUndefined();
    expect(produced.blueprint.homepageRegions.find((region) => region.id === "faq")!.imageRoleId).toBeUndefined();
    expect(produced.blueprint.homepageRegions.find((region) => region.id === "hero")!.imageRoleId).toBe("role-hero");
  });
});
