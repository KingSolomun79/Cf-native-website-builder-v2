import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { getEffectiveBusinessFacts } from "../src/domain/revision";
import { recordBenchmarkRun, BENCHMARK_CASES, freezeBenchmarkCases } from "../src/domain/benchmark";
import { evaluateProofGate } from "../src/domain/proof-gate";
import { runReferenceIntake } from "../src/domain/reference-intake";
import {
  runOriginalDesignBlueprintStage,
  lintOriginalDesignForArchetypeDeterminism,
  parseCreativeDirection,
  OriginalDesignError,
} from "../src/domain/original-design";
import { produceImplementationContract } from "../src/domain/implementation-planner";
import { generateCompleteSite, type PageId } from "../src/domain/site-generator";
import { validateBlueprintIdentityPreservation, VisualBlueprintSchema, type VisualBlueprint } from "../src/domain/visual-blueprint";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { ReferenceAnalysis } from "../src/domain/reference-analysis";
import { Value } from "@sinclair/typebox/value";

// Primary-seam tests for ORIGINAL_DESIGN Site Generation (issue #24): the
// proof-gate mode lock, no Reference dependency, Business/creative-derived
// Blueprint, and full reuse of the downstream lifecycle contracts.

const env = providedEnv as unknown as Env;

async function openProofGate(): Promise<void> {
  for (const definition of BENCHMARK_CASES) {
    // Real lifecycle entities so the run rows satisfy foreign keys.
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "OD Gate Co", contactEmail: "od-gate@example.com" },
        reference: { screenshotR2Key: `references/uploads/od-${Math.random().toString(36).slice(2)}.png` },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await recordBenchmarkRun(env, {
      benchmarkCaseId: definition.id,
      siteGenerationId: started.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      releaseReady: true,
      imageSpendUsd: 1.5,
      manualSourceEdits: 0,
    });
  }
  const evaluation = await evaluateProofGate(env);
  expect(evaluation.gateOpen).toBe(true);
}

async function newOriginalDesignGeneration(): Promise<{
  siteGenerationId: string;
  siteId: string;
}> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "ORIGINAL_DESIGN",
      facts: {
        businessName: "Kilimanjaro Cycling Collective",
        contactEmail: "ride@kcc.example",
        businessType: "cycling tour operator",
        businessDescription: "Guided highland cycling tours and bike fitting.",
        city: "Moshi",
        country: "Tanzania",
      },
      // No reference key at all — ORIGINAL_DESIGN needs none.
    },
  });
  return { siteGenerationId: started.siteGenerationId, siteId: started.siteId };
}

const ORIGINAL_BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "Altitude-born clarity: long horizontal motion lines and thin air whites for a highland cycling collective.",
  signatureTraits: [
    { id: "od-motion-lines", description: "Long horizontal motion lines echoing peloton speed" },
    { id: "od-thin-air-white", description: "Expansive thin-air whitespace with altitude gradient accents" },
    { id: "od-route-mapping", description: "Route-line geometry structuring sections and dividers" },
  ],
  fidelityPriorities: ["distinctive brand expression", "conversion clarity"],
  tokens: { "color.peak": "#0b3d2e", "color.air": "#f4f7f5", "space.section": "clamp(5rem, 12vh, 9rem)" },
  globalGrid: { containerLogic: "max-width 1160px with route-line rails", columnRatios: ["7/5"] },
  spacingRhythm: "Expansive altitude sections with tight peloton clusters",
  typographyRoles: [
    { role: "display", description: "condensed athletic display" },
    { role: "body", description: "humanist body" },
  ],
  colorRoles: [
    { role: "peak", description: "deep highland green statements" },
    { role: "air", description: "thin-air whites" },
  ],
  surfaceLanguage: "Flat air surfaces with peak-green route bands",
  headerNavigation: "Slim sticky header with route-line underline hover",
  homepageFirstViewport: { summary: "Full-bleed gradient ascent hero with route line", regionIds: ["ascent-hero"] },
  homepageRegions: [
    { id: "ascent-hero", purpose: "Conversion hero with tour promise", imageRoleId: "od-role-hero" },
    { id: "tour-grid", purpose: "Tour offerings" },
    { id: "fitting-story", purpose: "Bike fitting narrative", imageRoleId: "od-role-detail" },
    { id: "ride-cta", purpose: "Book a ride" },
  ],
  imageSystem: {
    photographyGrammar: "Documentary highland cycling photography, morning light",
    imageRoles: [
      { id: "od-role-hero", purpose: "ascent hero image", priority: "CRITICAL" },
      { id: "od-role-detail", purpose: "fitting detail imagery", priority: "NORMAL" },
    ],
  },
  motionGrammar: ["route-line draw-in on scroll"],
  responsiveContract: ["motion lines collapse to vertical accents below 768px"],
  innerPageVocabulary: ["page-header", "content-section", "tour-list", "cta-band"],
  antiFallbackRules: ["never reduce to a generic centered template on desktop"],
  accessibilityAdaptations: ["route lines meet contrast against air surfaces"],
  declaredLimitations: [],
};

function navLinks(): string {
  return `<header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
}

function shell(title: string, main: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${title} — Kilimanjaro Cycling Collective.">
<link rel="stylesheet" href="site.css">
<script src="site.js" defer></script>
</head>
<body>
${navLinks()}
<main>${main}</main>
<footer><p>${title}</p></footer>
</body>
</html>`;
}

const OD_CSS = `
:root { --peak: #0b3d2e; --air: #f4f7f5; --section: clamp(5rem, 12vh, 9rem); }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--air); color: #14201a; }
.container { max-width: 1160px; margin: 0 auto; padding: 0 1.5rem; }
.hero { display: grid; grid-template-columns: 7fr 5fr; min-height: 86vh; align-items: center; }
.hero h1 { font-size: clamp(2.8rem, 6vw, 5.2rem); line-height: 1.04; }
.route-line { border-top: 2px solid var(--peak); }
.section { padding-block: var(--section); }
.surface-peak { background: var(--peak); color: var(--air); }
/* Issue #47 realization binding: every canonical region carries a real rule
   scoped to its data-region selector. */
[data-region="ascent-hero"] { display: grid; grid-template-columns: 7fr 5fr; min-height: 86vh; align-items: center; }
[data-region="tour-grid"] { padding-block: var(--section); display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; }
[data-region="fitting-story"] { padding-block: var(--section); background: var(--peak); color: var(--air); }
[data-region="ride-cta"] { padding-block: 6rem; text-align: center; }
[data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity .6s ease, transform .6s ease; }
[data-reveal].is-visible { opacity: 1; transform: none; }
@media (max-width: 768px) {
  .hero { grid-template-columns: 1fr; min-height: auto; }
  [data-region="ascent-hero"] { grid-template-columns: 1fr; min-height: auto; }
  [data-region="tour-grid"] { grid-template-columns: 1fr; }
  .route-line { border-top-width: 1px; }
}
@media (prefers-reduced-motion: reduce) { [data-reveal] { transition: none; } }
`;
const OD_JS = "(function(){var n=document.querySelector('nav');if(n){n.addEventListener('click',function(){});}})();";

function odPage(pageId: PageId, siteFormId: string): string {
  if (pageId === "home") {
    return shell(
      "Kilimanjaro Cycling Collective",
      `<section class="hero" data-region="ascent-hero"><h1>Kilimanjaro Cycling Collective</h1><figure><img src="IMG:home-ascent-hero" data-image-id="home-ascent-hero" alt="Highland ascent ride"></figure></section>
<section data-region="tour-grid"><h2>Tours</h2><p>Guided highland cycling tours.</p></section>
<section data-region="fitting-story"><h2>Fitting</h2><figure><img src="IMG:home-fitting-story" data-image-id="home-fitting-story" alt="Bike fitting"></figure></section>
<section data-region="ride-cta"><h2>Ride with us</h2><a href="/contact">Book</a></section>`
    );
  }
  if (pageId === "about") {
    return shell("About", `<section><h1>About</h1><img src="IMG:about-main" data-image-id="about-main" alt="Collective"></section>`);
  }
  if (pageId === "services") {
    return shell("Services", `<section><h1>Services</h1><img src="IMG:services-main" data-image-id="services-main" alt="Tours"></section>`);
  }
  return shell(
    "Contact",
    `<section><h1>Contact</h1>
<form method="post" action="https://forms.wazibiz.example/api/v2/forms/submit">
<input type="hidden" name="siteFormId" value="${siteFormId}">
<label>Name<input name="name" required></label>
<label>Email<input type="email" name="email" required></label>
<label>Message<textarea name="message" required></textarea></label>
<button type="submit">Send</button>
</form></section>`
  );
}

beforeAll(async () => {
  await freezeBenchmarkCases(env);
});

describe("ORIGINAL_DESIGN mode gate", () => {
  it("cannot start a Build unless the REFERENCE_BOUND proof gate is open", async () => {
    // Force the gate shut for a deterministic check.
    for (const definition of BENCHMARK_CASES) {
      const started = await startSiteGeneration(env, {
        payload: {
          buildMode: "REFERENCE_BOUND",
          facts: { businessName: "Lock Probe Co", contactEmail: "lock@example.com" },
          reference: { screenshotR2Key: `references/uploads/lock-${Math.random().toString(36).slice(2)}.png` },
        },
      });
      const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
      await recordBenchmarkRun(env, {
        benchmarkCaseId: definition.id,
        siteGenerationId: started.siteGenerationId,
        buildId: created.buildId,
        buildVersionId: created.buildVersionId,
        releaseReady: false,
        imageSpendUsd: 1,
        manualSourceEdits: 0,
        rootCause: "GENERATOR",
      });
    }
    expect((await evaluateProofGate(env)).gateOpen).toBe(false);

    const generation = await newOriginalDesignGeneration();
    await expect(createInitialBuild(env, { siteGenerationId: generation.siteGenerationId })).rejects.toThrow(
      /ORIGINAL_DESIGN is locked/
    );

    await openProofGate();
    const generationOpen = await newOriginalDesignGeneration();
    await expect(createInitialBuild(env, { siteGenerationId: generationOpen.siteGenerationId })).resolves.toMatchObject({
      buildVersionNumber: 1,
    });
  });
});

describe("ORIGINAL_DESIGN blueprint", () => {
  beforeAll(async () => {
    await openProofGate();
  });

  it("needs no Reference: intake refuses, submission carries none", async () => {
    const generation = await newOriginalDesignGeneration();
    const view = await env.DB.prepare(
      "SELECT payload_json FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(generation.siteGenerationId)
      .first<{ payload_json: string }>();
    expect(JSON.parse(view!.payload_json).reference).toBeUndefined();

    // The reference pipeline explicitly refuses this generation — the
    // ORIGINAL_DESIGN path never depends on it.
    await expect(
      runReferenceIntake(env, {
        siteGenerationId: generation.siteGenerationId,
        buildId: "b-od", buildVersionId: "bv-od", buildVersionNumber: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_REFERENCE_BOUND" });
  });

  it("derives a distinctive Blueprint from Business/creative inputs without archetype determinism", async () => {
    const generation = await newOriginalDesignGeneration();
    const created = await createInitialBuild(env, { siteGenerationId: generation.siteGenerationId });

    const generate: RawAiGenerate = async (_system, user) => {
      expect(user).toContain("Kilimanjaro Cycling Collective");
      expect(user).toContain("altitude-born clarity");
      return { content: JSON.stringify(ORIGINAL_BLUEPRINT), provider: "test", model: "od-model" };
    };

    const produced = await runOriginalDesignBlueprintStage(env, {
      siteGenerationId: generation.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      facts: (await getEffectiveBusinessFacts(env, created.buildId)).facts,
      creativeDirection: parseCreativeDirection({
        direction: "altitude-born clarity with route-line geometry",
        audience: "active travelers 30-55",
        conversionGoal: "tour bookings",
        serviceEnvironment: "highland outdoors",
      })!,
      generate,
    });

    expect(produced.blueprint.signatureTraits).toHaveLength(3);
    // ORIGINAL_DESIGN traits carry no Reference Analysis trace…
    expect(produced.blueprint.signatureTraits.every((trait) => trait.sourceTraitId === undefined)).toBe(true);
    // …while the REFERENCE_BOUND validator still REQUIRES traces.
    const fakeAnalysis = { signatureTraits: [{ id: "trait-x", identityDefining: true }] } as unknown as ReferenceAnalysis;
    expect(validateBlueprintIdentityPreservation(produced.blueprint, fakeAnalysis).valid).toBe(false);

    // The versioned schema cannot carry deterministic archetype selection.
    expect(Value.Check(VisualBlueprintSchema, { ...ORIGINAL_BLUEPRINT, archetype: "industry-preset-7" })).toBe(false);
    expect(() =>
      lintOriginalDesignForArchetypeDeterminism({
        ...ORIGINAL_BLUEPRINT,
        globalGrid: { ...ORIGINAL_BLUEPRINT.globalGrid, containerLogic: "industry preset archetype selection rule for cycling" },
      })
    ).toThrow(OriginalDesignError);

    // Workflow goes straight from intake to BLUEPRINT (no Reference states).
    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(created.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).toEqual(["INTAKE_READY", "BLUEPRINT"]);

    // Provenance: the original-design stage ran through the manifest.
    const runs = await env.DB.prepare(
      "SELECT prompt_id, prompt_version, model FROM ai_stage_runs WHERE stage = 'original-design-blueprint-generator' AND build_id = ?"
    )
      .bind(created.buildId)
      .first<{ prompt_id: string; prompt_version: string; model: string }>();
    expect(runs).toMatchObject({ prompt_id: "original-design-blueprint-generator", prompt_version: "v3", model: "od-model" });
  });

  it("reuses the same downstream contract, generation and validators — not a second architecture", async () => {
    const generation = await newOriginalDesignGeneration();
    const created = await createInitialBuild(env, { siteGenerationId: generation.siteGenerationId });
    const facts = (await getEffectiveBusinessFacts(env, created.buildId)).facts;

    const blueprintProduced = await runOriginalDesignBlueprintStage(env, {
      siteGenerationId: generation.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      facts,
      generate: async () => ({ content: JSON.stringify(ORIGINAL_BLUEPRINT), provider: "test", model: "od-model" }),
    });

    // Same Implementation Contract planner (mirrors topology/traits).
    const contract = await produceImplementationContract(env, {
      siteGenerationId: generation.siteGenerationId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      siteId: generation.siteId,
      blueprint: blueprintProduced.blueprint,
      facts,
    });
    expect(contract.contract.pages.map((page) => page.id)).toEqual(["home", "about", "services", "contact"]);
    expect(contract.contract.blueprintSignatureTraitIds).toEqual(ORIGINAL_BLUEPRINT.signatureTraits.map((trait) => trait.id));

    // Same incremental generator with the same validators and artifact kinds.
    const site = await generateCompleteSite(env, {
      siteGenerationId: generation.siteGenerationId,
      siteId: generation.siteId,
      buildId: created.buildId,
      buildVersionId: created.buildVersionId,
      buildVersionNumber: 1,
      blueprint: blueprintProduced.blueprint,
      blueprintR2Key: blueprintProduced.artifactR2Key,
      contract: contract.contract,
      contractR2Key: contract.artifactR2Key,
      generate: async (_system, user) => {
        if (user.includes("shared stylesheet")) return { content: JSON.stringify({ css: OD_CSS }), provider: "t", model: "m" };
        if (user.includes("minimal shared runtime")) return { content: JSON.stringify({ js: OD_JS }), provider: "t", model: "m" };
        for (const pageId of ["home", "about", "services", "contact"] as PageId[]) {
          if (user.includes(`page id '${pageId}'`)) {
            return { content: JSON.stringify({ html: odPage(pageId, `site:${generation.siteId}`) }), provider: "t", model: "m" };
          }
        }
        throw new Error("unexpected prompt");
      },
    });
    expect(site.validation.passed).toBe(true);
    expect(site.pages.home).toContain('data-region="ascent-hero"');
    // Same artifact vocabulary as REFERENCE_BOUND.
    const kinds = new Set(site.artifacts.map((artifact) => artifact.kind));
    expect(kidsEqual(kinds, new Set(["generated_shared_source", "generated_page", "image_plan"]))).toBe(true);
    const storedBlueprint = await getBuildStageArtifact<VisualBlueprint>(env, created.buildVersionId, "visual_blueprint");
    expect(storedBlueprint!.value.visualThesis).toContain("Altitude-born");

    // Same lifecycle semantics downstream: the identical state machine.
    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(created.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).toEqual([
      "INTAKE_READY", "BLUEPRINT", "IMPLEMENTATION_PLAN", "SITE_GENERATION", "SITE_VALIDATION",
    ]);
  });
});

function kidsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}
