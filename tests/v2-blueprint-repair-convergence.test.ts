import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createPipelineScripts } from "./helpers/pipeline-scripts";
import { runVisualBlueprintStage, validateBlueprintIdentityPreservation, type TraitObligation, type VisualBlueprint } from "../src/domain/visual-blueprint";
import type { ReferenceAnalysis } from "../src/domain/reference-analysis";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { putObject } from "../src/lib/assets";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";
import { buildPng } from "./helpers/png";
import { FROZEN_RANKFORGE_ANALYSIS, FROZEN_RANKFORGE_CANDIDATES, FROZEN_RANKFORGE_EVIDENCE } from "./_generated-rankforge-frozen";

// Issue #60 — Blueprint Repair Convergence.
//
// 2026-09-06 production evidence: the repair regenerated the COMPLETE
// blueprint while ordering "do not drop or rename any required id" under an
// unsatisfiable cap, so each repair rotated which identity carrier was lost
// (violet-pill x4, footer x2, testimonials x1 across the seven candidates).
// The repair is now informed AND constrained (rejected blueprint + findings +
// preservation set), spends at most ONE semantic repair, and a second
// deterministic rejection escalates BLUEPRINT_REVIEW_REQUIRED instead of
// burning the step-retry budget on identical re-prompts.

const env = providedEnv as unknown as Env;
const FACTS: BusinessFacts = { businessName: "Convergence Fixture Co", contactEmail: "fix@convergence.example", businessType: "studio" };

async function newBuild(): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const screenshotKey = `references/uploads/rc-${Math.random().toString(36).slice(2)}.png`;
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

// ── §28 whack-a-mole fixture: 8 binding traits, repair must not rotate ───────

const EIGHT_CARRIERS = Array.from({ length: 8 }, (_, i) => `trait-carrier-${i + 1}`);

const WIDE_ANALYSIS: ReferenceAnalysis = {
  version: "1",
  visualSystemSummary: "Eight identity carriers spanning the reference composition.",
  hierarchy: [{ level: "display", description: "oversized headline", confidence: "HIGH" }],
  signatureTraits: [
    ...EIGHT_CARRIERS.map((id, i) => ({ id, description: `Identity carrier ${i + 1}`, identityDefining: true, evidenceRefs: ["region-1"] })),
    { id: "trait-minor", description: "Minor non-identity trait", identityDefining: false, evidenceRefs: ["region-2"] },
  ],
  designIntent: [{ hypothesis: "dense editorial authority", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "documentary imagery", imageRoles: ["hero"] },
  responsiveBehavior: [],
  motionBehavior: [],
  identityCarriers: EIGHT_CARRIERS,
};

function obligationsFor(carriers: string[]): TraitObligation[] {
  return carriers.map((sourceTraitId) => ({ sourceTraitId, disposition: "PRESERVED" as const, realizedByRegionIds: ["hero"] }));
}

function wideBlueprint(obligations: TraitObligation[]): VisualBlueprint {
  return {
    version: "1",
    visualThesis: "All eight carriers disposed.",
    signatureTraits: EIGHT_CARRIERS.slice(0, 3).map((sourceTraitId, i) => ({
      id: `bp-trait-${i + 1}`,
      description: `Realizes ${sourceTraitId}`,
      sourceTraitId,
    })),
    traitObligations: obligations,
    fidelityPriorities: ["1. region order — binding topology"],
    tokens: {},
    globalGrid: { containerLogic: "single column", columnRatios: ["1"] },
    spacingRhythm: "even",
    typographyRoles: [{ role: "display", description: "oversized" }],
    colorRoles: [{ role: "ink", description: "text" }],
    surfaceLanguage: "flat",
    headerNavigation: "minimal",
    homepageFirstViewport: { summary: "hero", regionIds: ["hero"] },
    homepageRegions: [
      { id: "hero", purpose: "all carriers realized here" },
      { id: "support", purpose: "supporting closing band" },
    ],
    imageSystem: { photographyGrammar: "documentary", imageRoles: [{ id: "role-hero", purpose: "hero", priority: "CRITICAL" }] },
    motionGrammar: ["none"],
    responsiveContract: ["stacks below 768px"],
    innerPageVocabulary: ["page-header"],
    antiFallbackRules: ["never flatten the identity carriers into a generic template"],
    accessibilityAdaptations: [],
    declaredLimitations: [],
  };
}

describe("whack-a-mole regression (issue #60 §28)", () => {
  it("a repair that fixes one obligation while dropping another is terminal — no rotation chase", async () => {
    const build = await newBuild();
    const carriers = EIGHT_CARRIERS;
    const initial = wideBlueprint(obligationsFor(carriers.slice(0, 7))); // carrier-8 missing
    // The repair "fixes" carrier-8 but simultaneously drops carrier-3 — the
    // exact production rotation pattern.
    const repaired = wideBlueprint(obligationsFor(carriers.filter((id) => id !== "trait-carrier-3")));

    const prompts: string[] = [];
    await expect(
      runVisualBlueprintStage(env, {
        ...build,
        buildVersionNumber: 1,
        analysis: WIDE_ANALYSIS,
        analysisR2Key: "builds/fixture/v1/reference_analysis.json",
        facts: FACTS,
        adaptationContract: null,
        evidenceRegions: [],
        generate: async (_system, user) => {
          prompts.push(user);
          if (user.includes("Blueprint repair directives")) {
            return { content: JSON.stringify(repaired), provider: "test", model: "rotator" };
          }
          return { content: JSON.stringify(initial), provider: "test", model: "rotator" };
        },
      })
    ).rejects.toMatchObject({ code: "IDENTITY_ERASURE", message: expect.stringContaining("trait-carrier-3") });

    // Exactly ONE semantic repair followed the initial generation.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Blueprint repair directives");
    // Nothing was persisted.
    expect(await getBuildStageArtifact(env, build.buildVersionId, "visual_blueprint")).toBeNull();
  });

  it("the preservation set is binding in the repair prompt", async () => {
    const build = await newBuild();
    const initial = wideBlueprint(obligationsFor(EIGHT_CARRIERS.slice(0, 7)));
    let repairPrompt = "";
    const repaired = wideBlueprint(obligationsFor(EIGHT_CARRIERS));
    await runVisualBlueprintStage(env, {
      ...build,
      buildVersionNumber: 1,
      analysis: WIDE_ANALYSIS,
      analysisR2Key: "builds/fixture/v1/reference_analysis.json",
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions: [],
      generate: async (_system, user) => {
        if (user.includes("Blueprint repair directives")) {
          repairPrompt = user;
          return { content: JSON.stringify(repaired), provider: "test", model: "converger" };
        }
        return { content: JSON.stringify(initial), provider: "test", model: "converger" };
      },
    });
    expect(repairPrompt).toContain("REJECTED BLUEPRINT (verbatim)");
    expect(repairPrompt).toContain("PRESERVATION SET");
    expect(repairPrompt).toContain("REPAIR SCOPE");
    expect(repairPrompt).toContain('"sourceTraitId":"trait-carrier-1"');
    // The infeasible production directive is gone.
    expect(repairPrompt).not.toContain("Do not drop or rename any required id");
  });
});

// ── Pipeline escalation: second rejection -> BLUEPRINT_REVIEW_REQUIRED ──────

describe("blueprint terminal escalation (issue #60 §25)", () => {
  it("routes a twice-rejected blueprint to HUMAN_REVIEW_REQUIRED after exactly 2 generate calls", async () => {
    const screenshotKey = `references/uploads/esc-${Math.random().toString(36).slice(2)}.png`;
    await putObject(env, screenshotKey, new Uint8Array(buildPng({ width: 1440, height: 3200 })));
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Escalation Probe Co", contactEmail: "esc@probe.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://escalation-probe.example.com/" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    const base = createPipelineScripts();
    let blueprintCalls = 0;
    const alwaysMissingObligation: RawAiGenerate = async (system, user, attempt) => {
      const response = await base.generate!(system, user, attempt);
      if (user.includes("Produce the binding Visual Blueprint")) {
        blueprintCalls += 1;
        const blueprint = JSON.parse(response.content) as VisualBlueprint;
        // Deterministic identity failure on EVERY attempt (initial + repair).
        blueprint.traitObligations = (blueprint.traitObligations ?? []).filter(
          (o) => o.sourceTraitId !== "trait-region-flow"
        );
        return { ...response, content: JSON.stringify(blueprint) };
      }
      return response;
    };

    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      deps: { ...base, generate: alwaysMissingObligation },
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("BLUEPRINT_REVIEW_REQUIRED");
    expect(outcome.reasons.join(" ")).toContain("IDENTITY_ERASURE");
    // Initial + ONE informed repair — no engine retry storm (production
    // 2026-09-06 burned 12 calls across 8 step attempts).
    expect(blueprintCalls).toBe(2);

    const event = await env.DB.prepare(
      "SELECT stage, to_state, detail FROM build_workflow_events WHERE build_id = ? AND stage = 'blueprint' ORDER BY created_at DESC LIMIT 1"
    )
      .bind(created.buildId)
      .first<{ stage: string; to_state: string; detail: string }>();
    expect(event!.to_state).toBe("HUMAN_REVIEW_REQUIRED");
    expect(event!.detail).toContain("BLUEPRINT_REVIEW_REQUIRED");

    const contract = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'implementation_contract'"
    )
      .bind(created.buildVersionId)
      .first<{ n: number }>();
    expect(contract!.n).toBe(0);
  });
});

// ── §27 seven-candidate production replay ────────────────────────────────────

const EVIDENCE_REGION_IDS = FROZEN_RANKFORGE_EVIDENCE.regions.map((region: { id: string }) => region.id);
const CARRIERS = [
  "dark-violet-photo-hero",
  "floating-pill-nav-cta",
  "about-split-portrait",
  "very-tall-card-collection",
  "narrative-split-with-stat-chips",
  "accordion-faq-light-band",
  "photo-backed-testimonials",
  "compact-newsletter-dark-contact-footer",
  "violet-pill-button-system",
];
const CARRIER_REGION_HINTS: Record<string, RegExp> = {
  "dark-violet-photo-hero": /hero/,
  "floating-pill-nav-cta": /header|nav/,
  "about-split-portrait": /about/,
  "very-tall-card-collection": /service|collection|card/,
  "narrative-split-with-stat-chips": /narrative|story|split|chip/,
  "accordion-faq-light-band": /faq/,
  "photo-backed-testimonials": /testimonial|review|proof/,
  "compact-newsletter-dark-contact-footer": /newsletter|footer|contact/,
  "violet-pill-button-system": /faq|service|cta|hero/,
};

function ledgerForCandidate(blueprint: VisualBlueprint): TraitObligation[] {
  const regionIds = blueprint.homepageRegions.map((region) => region.id);
  return CARRIERS.map((sourceTraitId) => {
    const hint = CARRIER_REGION_HINTS[sourceTraitId] ?? /./;
    const matches = regionIds.filter((id) => hint.test(id));
    return {
      sourceTraitId,
      disposition: "PRESERVED" as const,
      realizedByRegionIds: matches.length > 0 ? matches : [regionIds[0]],
    };
  });
}

describe("frozen seven-candidate replay (issue #60 §27)", () => {
  it("every schema-valid production candidate can pass the identity gate under the ledger", () => {
    expect(FROZEN_RANKFORGE_CANDIDATES).toHaveLength(7);
    for (const candidate of FROZEN_RANKFORGE_CANDIDATES) {
      const blueprint = candidate.artifact.value as VisualBlueprint;
      const verdict = validateBlueprintIdentityPreservation(
        { ...blueprint, traitObligations: ledgerForCandidate(blueprint) },
        FROZEN_RANKFORGE_ANALYSIS,
        null
      );
      expect(verdict.valid, candidate.runId).toBe(true);
    }
  });

  it("the two production consistency defects still reject; the other five converge", async () => {
    const expectedInconsistent = new Set([
      "1ae3fc13-9ca8-44a9-a1fa-c36a23f4b768", // firstViewport not an ordered prefix
      "cc062fa6-aded-47b4-8549-8405a7caffaf", // unknown image role img_faq_montage
    ]);
    const evidenceRegions = FROZEN_RANKFORGE_EVIDENCE.regions.map((region: { id: string; viewportHeightRatio?: number }) => ({
      id: region.id,
      ...(typeof region.viewportHeightRatio === "number" ? { viewportHeightRatio: region.viewportHeightRatio } : {}),
    }));

    for (const candidate of FROZEN_RANKFORGE_CANDIDATES) {
      const build = await newBuild();
      const blueprint = candidate.artifact.value as VisualBlueprint;
      const withLedger = { ...blueprint, traitObligations: ledgerForCandidate(blueprint) };
      const produced = await runVisualBlueprintStage(env, {
        ...build,
        buildVersionNumber: 1,
        analysis: FROZEN_RANKFORGE_ANALYSIS,
        analysisR2Key: "builds/fixture/v1/reference_analysis.json",
        facts: FACTS,
        adaptationContract: null,
        evidenceRegions,
        referenceUrl: FROZEN_RANKFORGE_EVIDENCE.referenceUrl,
        generate: async () => ({ content: JSON.stringify(withLedger), provider: "test", model: "replay" }),
      }).then(
        (result) => ({ ok: true as const, runId: candidate.runId, result }),
        (error: { code?: string }) => ({ ok: false as const, runId: candidate.runId, code: error.code })
      );

      if (expectedInconsistent.has(candidate.runId)) {
        expect(produced.ok, candidate.runId).toBe(false);
        if (!produced.ok) expect(produced.code).toBe("BLUEPRINT_INCONSISTENT");
      } else {
        expect(produced.ok, candidate.runId).toBe(true);
        if (produced.ok) {
          const stored = await getBuildStageArtifact<VisualBlueprint>(env, build.buildVersionId, "visual_blueprint");
          expect(stored, candidate.runId).not.toBeNull();
        }
      }
    }
  });
});

// ── §29 RankForge convergence: <=2 semantic Blueprint calls ─────────────────

const COMPLIANT_ANALYSIS: ReferenceAnalysis = {
  ...FROZEN_RANKFORGE_ANALYSIS,
  signatureTraits: FROZEN_RANKFORGE_ANALYSIS.signatureTraits.filter(
    (trait) => trait.id !== "trusted-logos-strip" && trait.id !== "floating-pill-nav-cta"
  ),
};

function rankforgeConvergenceBlueprint(): VisualBlueprint {
  // Ten canonical regions claiming the ten measured segments region-2..11
  // (region-0/1 are sub-threshold), provenance-valid against frozen evidence.
  const regionClaims: Array<[string, string, string]> = [
    ["hero", "region-2", "Business thesis over the photographic hero mass"],
    ["about_split", "region-3", "Portrait-masked about split"],
    ["logo_strip", "region-4", "Client logo band"],
    ["services_collection", "region-5", "Asymmetric service card collection"],
    ["narrative_one", "region-6", "Narrative split with stat chips"],
    ["narrative_two", "region-7", "Second narrative split"],
    ["faq", "region-8", "Pill accordion FAQ"],
    ["testimonials", "region-9", "Photo-backed testimonials"],
    ["newsletter", "region-10", "Compact newsletter band"],
    ["footer", "region-11", "Dark contact footer"],
  ];
  const obligations: TraitObligation[] = [
    { sourceTraitId: "dark-violet-photo-hero", disposition: "PRESERVED", realizedByRegionIds: ["hero"] },
    { sourceTraitId: "about-split-portrait", disposition: "PRESERVED", realizedByRegionIds: ["about_split"] },
    { sourceTraitId: "very-tall-card-collection", disposition: "PRESERVED", realizedByRegionIds: ["services_collection"] },
    { sourceTraitId: "narrative-split-with-stat-chips", disposition: "PRESERVED", realizedByRegionIds: ["narrative_one", "narrative_two"] },
    { sourceTraitId: "accordion-faq-light-band", disposition: "PRESERVED", realizedByRegionIds: ["faq"] },
    { sourceTraitId: "photo-backed-testimonials", disposition: "PRESERVED", realizedByRegionIds: ["testimonials"] },
    { sourceTraitId: "compact-newsletter-dark-contact-footer", disposition: "PRESERVED", realizedByRegionIds: ["newsletter", "footer"] },
    { sourceTraitId: "violet-pill-button-system", disposition: "PRESERVED", realizedByRegionIds: ["hero", "services_collection", "faq", "newsletter"] },
  ];
  return {
    version: "1",
    visualThesis: "RankForge convergence fixture: every binding carrier disposed.",
    signatureTraits: [
      { id: "bp-hero", description: "Violet-washed photographic hero", sourceTraitId: "dark-violet-photo-hero" },
      { id: "bp-about", description: "Masked portrait split", sourceTraitId: "about-split-portrait" },
      { id: "bp-cards", description: "Asymmetric card collection", sourceTraitId: "very-tall-card-collection" },
      { id: "bp-narrative", description: "Narrative splits with chips", sourceTraitId: "narrative-split-with-stat-chips" },
      { id: "bp-faq", description: "Pill accordion FAQ", sourceTraitId: "accordion-faq-light-band" },
      { id: "bp-proof", description: "Photo-backed testimonials", sourceTraitId: "photo-backed-testimonials" },
      { id: "bp-close", description: "Newsletter into dark footer", sourceTraitId: "compact-newsletter-dark-contact-footer" },
      { id: "bp-capsule", description: "Capsule control system", sourceTraitId: "violet-pill-button-system" },
    ],
    traitObligations: obligations,
    fidelityPriorities: ["1. region topology — binding composition", "2. capsule control geometry — repeated component language"],
    tokens: { "color.accent": "#8E2DE2", "radius.pill": "999px" },
    globalGrid: { containerLogic: "max-width 1200px", columnRatios: ["5/7"] },
    spacingRhythm: "generous sections",
    typographyRoles: [{ role: "display", description: "oversized" }],
    colorRoles: [{ role: "accent", description: "violet family" }],
    surfaceLanguage: "alternating light/dark bands",
    headerNavigation: "floating pill nav",
    homepageFirstViewport: { summary: "hero", regionIds: ["hero"] },
    homepageRegions: regionClaims.map(([id, evidenceId, purpose]) => ({ id, purpose, sourceEvidenceRegionIds: [evidenceId] })),
    imageSystem: {
      photographyGrammar: "documentary workspace imagery",
      imageRoles: [{ id: "role-hero", purpose: "hero photograph", priority: "CRITICAL" }],
    },
    motionGrammar: ["reduced-motion-safe reveals"],
    responsiveContract: ["regions stack below 768px"],
    innerPageVocabulary: ["page-header", "content-section"],
    antiFallbackRules: ["never replace capsule controls with square defaults"],
    accessibilityAdaptations: ["focus rings"],
    declaredLimitations: [],
  };
}

describe("RankForge convergence fixture (issue #60 §29)", () => {
  const evidenceRegions = FROZEN_RANKFORGE_EVIDENCE.regions.map((region: { id: string; viewportHeightRatio?: number }) => ({
    id: region.id,
    ...(typeof region.viewportHeightRatio === "number" ? { viewportHeightRatio: region.viewportHeightRatio } : {}),
  }));

  it("converges on the FIRST call when the initial blueprint disposes every carrier", async () => {
    const build = await newBuild();
    let calls = 0;
    const produced = await runVisualBlueprintStage(env, {
      ...build,
      buildVersionNumber: 1,
      analysis: COMPLIANT_ANALYSIS,
      analysisR2Key: "builds/fixture/v1/reference_analysis.json",
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions,
      referenceUrl: FROZEN_RANKFORGE_EVIDENCE.referenceUrl,
      generate: async () => {
        calls += 1;
        return { content: JSON.stringify(rankforgeConvergenceBlueprint()), provider: "test", model: "converger" };
      },
    });
    expect(calls).toBe(1);
    expect(produced.blueprint.traitObligations).toHaveLength(8);
    // Provenance is total across the claimed evidence segments.
    expect(produced.blueprint.homepageRegions.every((region) => region.sourceEvidenceRegionIds!.every((id) => EVIDENCE_REGION_IDS.includes(id)))).toBe(true);
  });

  it("converges within ONE targeted repair for a narrow obligation failure", async () => {
    const build = await newBuild();
    const complete = rankforgeConvergenceBlueprint();
    const narrowFailure = {
      ...complete,
      traitObligations: complete.traitObligations!.filter((o) => o.sourceTraitId !== "violet-pill-button-system"),
    };
    let calls = 0;
    const produced = await runVisualBlueprintStage(env, {
      ...build,
      buildVersionNumber: 1,
      analysis: COMPLIANT_ANALYSIS,
      analysisR2Key: "builds/fixture/v1/reference_analysis.json",
      facts: FACTS,
      adaptationContract: null,
      evidenceRegions,
      referenceUrl: FROZEN_RANKFORGE_EVIDENCE.referenceUrl,
      generate: async (_system, user) => {
        calls += 1;
        if (user.includes("Blueprint repair directives")) {
          return { content: JSON.stringify(complete), provider: "test", model: "converger" };
        }
        return { content: JSON.stringify(narrowFailure), provider: "test", model: "converger" };
      },
    });
    // Hard requirement: <=2 semantic Blueprint generation calls.
    expect(calls).toBe(2);
    expect(produced.blueprint.traitObligations!.map((o) => o.sourceTraitId)).toContain("violet-pill-button-system");
    // The repair carried the previously satisfied obligations forward.
    for (const satisfied of narrowFailure.traitObligations!) {
      expect(produced.blueprint.traitObligations).toContainEqual(satisfied);
    }
  });
});
