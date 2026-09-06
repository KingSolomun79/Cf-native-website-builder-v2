import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runReferenceIntake, getFrozenReferenceEvidence, type ReferenceCaptureFn, type ReferenceCaptureOutput } from "../src/domain/reference-intake";
import { runReferenceAnalysisStage, type ReferenceAnalysis } from "../src/domain/reference-analysis";
import { runVisualBlueprintStage, type VisualBlueprint } from "../src/domain/visual-blueprint";
import { produceImplementationContract, type ImplementationContract } from "../src/domain/implementation-planner";
import {
  generateCompleteSite,
  deriveImagePlan,
  validateAssembledSite,
  SiteGenerationValidationError,
  type AssembledSiteSource,
} from "../src/domain/site-generator";
import { putObject } from "../src/lib/assets";
import { storeBuildStageArtifact } from "../src/domain/stage-artifacts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { BusinessFacts } from "../src/domain/lifecycle-schema";
import { buildPng } from "./helpers/png";

// Primary-seam tests for incremental four-page REFERENCE_BOUND generation
// (issue #9).

const env = providedEnv as unknown as Env;

const FACTS: BusinessFacts = {
  businessName: "Rift Valley Roasters",
  contactEmail: "hello@rvr.example",
  businessType: "coffee roastery",
  businessDescription: "Small-batch coffee roasting for cafes and homes.",
  city: "Nakuru",
  country: "Kenya",
};

const ANALYSIS: ReferenceAnalysis = {
  version: "1",
  visualSystemSummary: "Editorial asymmetric system.",
  hierarchy: [{ level: "display", description: "Oversized serif headline", confidence: "HIGH" }],
  signatureTraits: [
    { id: "trait-oversized-serif", description: "Oversized serif display type", identityDefining: true, evidenceRefs: ["h1"] },
    { id: "trait-asymmetric-grid", description: "Asymmetric two-column grid", identityDefining: true, evidenceRefs: ["region-1"] },
    { id: "trait-alternating-surfaces", description: "Dark/light alternation", identityDefining: false, evidenceRefs: ["region-2"] },
  ],
  designIntent: [{ hypothesis: "Magazine authority", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "Editorial documentary", imageRoles: ["hero", "detail"] },
  responsiveBehavior: ["stacks below 768px"],
  motionBehavior: ["fade-up reveals"],
  identityCarriers: ["trait-oversized-serif", "trait-asymmetric-grid"],
};

const BLUEPRINT: VisualBlueprint = {
  version: "1",
  visualThesis: "Premium editorial clarity for a local craft business.",
  signatureTraits: [
    { id: "bp-serif", description: "Oversized serif display", sourceTraitId: "trait-oversized-serif" },
    { id: "bp-asymmetric", description: "Asymmetric composition", sourceTraitId: "trait-asymmetric-grid" },
    { id: "bp-surfaces", description: "Alternating surfaces", sourceTraitId: "trait-alternating-surfaces" },
  ],
  fidelityPriorities: ["first viewport topology"],
  tokens: { "color.ink": "#1a1a1a", "color.paper": "#faf7f2", "space.section": "8rem" },
  globalGrid: { containerLogic: "12-col, hero 5/7 split", columnRatios: ["5/7"] },
  spacingRhythm: "generous sections",
  typographyRoles: [{ role: "display", description: "serif" }],
  colorRoles: [{ role: "ink", description: "text" }],
  surfaceLanguage: "paper/ink alternation",
  headerNavigation: "minimal sticky header",
  homepageFirstViewport: { summary: "asymmetric split hero", regionIds: ["hero"] },
  homepageRegions: [
    { id: "hero", purpose: "thesis + editorial image", imageRoleId: "role-hero", sourceEvidenceRegionIds: ["region-1"] },
    { id: "intro", purpose: "introduction", sourceEvidenceRegionIds: ["region-2"] },
    { id: "services-overview", purpose: "service teasers", imageRoleId: "role-detail", sourceEvidenceRegionIds: ["region-3"] },
    { id: "contact-cta", purpose: "CTA", sourceEvidenceRegionIds: ["region-4"] },
  ],
  imageSystem: {
    photographyGrammar: "editorial documentary",
    imageRoles: [
      { id: "role-hero", purpose: "first-viewport hero", priority: "CRITICAL" },
      { id: "role-detail", purpose: "craft details", priority: "NORMAL" },
    ],
  },
  motionGrammar: ["fade-up reveals"],
  responsiveContract: ["stacks below 768px"],
  innerPageVocabulary: ["page-header", "content-section", "fact-list", "cta-band"],
  antiFallbackRules: ["never center the asymmetric grid on desktop"],
  accessibilityAdaptations: [],
  declaredLimitations: [],
};

const SHARED_CSS = `
:root { --color-ink: #1a1a1a; --color-paper: #faf7f2; --space-section: 8rem; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--color-paper); color: var(--color-ink); }
.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
.hero { display: grid; grid-template-columns: 5fr 7fr; min-height: 88vh; align-items: center; }
.hero h1 { font-family: 'Playfair Display', serif; font-size: clamp(3rem, 7vw, 6rem); line-height: 1.02; }
.section { padding-block: var(--space-section); }
.surface-ink { background: var(--color-ink); color: var(--color-paper); }
.site-nav { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; }
.wordmark { font-family: 'Playfair Display', serif; font-size: 1.25rem; text-decoration: none; color: var(--color-ink); }
.page-header { padding-block: 5rem 2rem; }
.content-section { padding-block: 3rem; }
.fact-list { padding-block: 3rem; background: var(--color-paper); }
.fact-list ul { list-style: none; display: grid; gap: 0.75rem; }
.cta-band { padding-block: 5rem; background: var(--color-ink); color: var(--color-paper); text-align: center; }
/* Issue #47 realization binding: every canonical Blueprint region carries a
   real rule scoped to its data-region selector. */
[data-region="hero"] { display: grid; grid-template-columns: 5fr 7fr; min-height: 88vh; align-items: center; }
[data-region="hero"] h1 { font-family: 'Playfair Display', serif; font-size: clamp(3rem, 7vw, 6rem); line-height: 1.02; }
[data-region="intro"] { padding-block: var(--space-section); }
[data-region="services-overview"] { padding-block: var(--space-section); background: var(--color-ink); color: var(--color-paper); display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; }
[data-region="contact-cta"] { padding-block: 5rem; text-align: center; }
[data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity .6s ease, transform .6s ease; }
[data-reveal].is-visible { opacity: 1; transform: none; }
@media (max-width: 768px) {
  .hero { grid-template-columns: 1fr; min-height: auto; }
  [data-region="hero"] { grid-template-columns: 1fr; min-height: auto; }
  [data-region="services-overview"] { grid-template-columns: 1fr; }
  .nav-links { display: none; }
  .nav-toggle { display: grid; }
}
@media (prefers-reduced-motion: reduce) { [data-reveal] { transition: none; } }
`;

const SHARED_JS = `
(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      document.body.classList.toggle('nav-open');
    });
  }
  var reveal = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); io.unobserve(entry.target); } });
    }, { threshold: 0.15 });
    reveal.forEach(function (el) { io.observe(el); });
  } else {
    reveal.forEach(function (el) { el.classList.add('is-visible'); });
  }
})();
`;

function navLinks(): string {
  return `<header><nav class="site-nav" aria-label="Primary"><a class="wordmark" href="/">Rift Valley Roasters</a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links">Menu</button>
  <div class="nav-links" id="nav-links"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></div></nav></header>`;
}

function shell(title: string, main: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="site.css">
<script src="site.js" defer></script>
</head>
<body>
${navLinks()}
<main>
${main}
</main>
<footer><p>Rift Valley Roasters &middot; Nakuru, Kenya</p></footer>
</body>
</html>`;
}

const HOME_HTML = shell(
  "Rift Valley Roasters — Small-batch coffee roasting",
  `<section class="hero" data-region="hero">
  <div><h1>Small-batch roasting for cafes and homes</h1><p>Coffee roasted in Nakuru, Kenya.</p></div>
  <figure><img src="IMG:home-hero" data-image-id="home-hero" alt="Roaster at work in the roastery"></figure>
</section>
<section class="section" data-region="intro">
  <h2>The roastery</h2><p>A coffee roastery focused on small batches.</p>
</section>
<section class="section surface-ink" data-region="services-overview">
  <h2>What we do</h2><img src="IMG:home-services-overview" data-image-id="home-services-overview" alt="Roasted beans detail">
</section>
<section class="section" data-region="contact-cta">
  <h2>Talk to us</h2><a href="/contact">Get in touch</a>
</section>`
);

const ABOUT_HTML = shell(
  "About — Rift Valley Roasters",
  `<section class="page-header" data-region="about-region-1"><h1>About the roastery</h1></section>
<section class="content-section" data-region="about-region-2"><p>Small-batch coffee roasting for cafes and homes.</p>
<img src="IMG:about-main" data-image-id="about-main" alt="Roastery interior"></section>
<section class="fact-list" data-region="about-region-3"><ul><li>Coffee roastery</li><li>Nakuru, Kenya</li></ul>
<img src="IMG:about-detail" data-image-id="about-detail" alt="Beans cooling"></section>`
);

const SERVICES_HTML = shell(
  "Services — Rift Valley Roasters",
  `<section class="page-header" data-region="services-region-1"><h1>Services</h1></section>
<section class="content-section" data-region="services-region-2"><p>Roasting services for cafes and home enthusiasts.</p>
<img src="IMG:services-main" data-image-id="services-main" alt="Cafe served coffee"></section>
<section class="cta-band" data-region="services-region-3"><a href="/contact">Request a quote</a>
<img src="IMG:services-detail" data-image-id="services-detail" alt="Packaging detail"></section>`
);

const CONTACT_HTML = shell(
  "Contact — Rift Valley Roasters",
  `<section class="page-header" data-region="contact-region-1"><h1>Contact</h1></section>
<section class="content-section" data-region="contact-region-2">
<img src="IMG:contact-atmosphere" data-image-id="contact-atmosphere" alt="Roastery atmosphere">
<form method="post" action="https://forms.wazibiz.example/api/v2/forms/submit">
  <input type="hidden" name="siteFormId" value="site:test-site">
  <label>Name<input type="text" name="name" required></label>
  <label>Email<input type="email" name="email" required></label>
  <label>Message<textarea name="message" required></textarea></label>
  <button type="submit">Send message</button>
</form></section>`
);

function generateForSite(options: { homeHtml?: string } = {}): { generate: RawAiGenerate; calls: string[] } {
  const calls: string[] = [];
  const generate: RawAiGenerate = async (_system, user) => {
    calls.push(user.slice(0, 60));
    if (user.includes("shared stylesheet")) return { content: JSON.stringify({ css: SHARED_CSS }), provider: "test", model: "test-model-g" };
    if (user.includes("minimal shared runtime")) return { content: JSON.stringify({ js: SHARED_JS }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'home'")) return { content: JSON.stringify({ html: options.homeHtml ?? HOME_HTML }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'about'")) return { content: JSON.stringify({ html: ABOUT_HTML }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'services'")) return { content: JSON.stringify({ html: SERVICES_HTML }), provider: "test", model: "test-model-g" };
    return { content: JSON.stringify({ html: CONTACT_HTML }), provider: "test", model: "test-model-g" };
  };
  return { generate, calls };
}

async function preparedContext(): Promise<{
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  buildVersionId: string;
  contract: ImplementationContract;
  blueprintR2Key: string;
  contractR2Key: string;
}> {
  const screenshotKey = `references/uploads/sg-${Math.random().toString(36).slice(2)}.png`;
  await putObject(env, screenshotKey, buildPng());
  const started = await startSiteGeneration(env, {
    payload: { buildMode: "REFERENCE_BOUND", facts: FACTS, reference: { url: "https://reference.example.com/", screenshotR2Key: screenshotKey } },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const capture: ReferenceCaptureFn = async () => ({
    canonicalScreenshot: { content: new TextEncoder().encode("P"), mimeType: "image/png", pixelWidth: 1440, likelyCssViewportWidth: 1440 },
    captures: [{ viewportWidth: 1440, content: new TextEncoder().encode("P"), mimeType: "image/png" }],
    regions: [
      { id: "region-1", startY: 0, endY: 700, height: 700, viewportHeightRatio: 0.78 },
      { id: "region-2", startY: 700, endY: 1500, height: 800, viewportHeightRatio: 0.89 },
      { id: "region-3", startY: 1500, endY: 2300, height: 800, viewportHeightRatio: 0.89 },
      { id: "region-4", startY: 2300, endY: 2900, height: 600, viewportHeightRatio: 0.67 },
    ],
    measuredElements: [{ selectorHint: "h1", role: "typography", computed: { fontSize: "72px" }, confidence: "MEDIUM", source: "COMPUTED_STYLE" }],
    responsiveObservations: [], motionObservations: [], discrepancies: [],
  } satisfies ReferenceCaptureOutput);
  await runReferenceIntake(env, {
    siteGenerationId: started.siteGenerationId, buildId: created.buildId,
    buildVersionId: created.buildVersionId, buildVersionNumber: 1, capture,
  });
  const frozen = (await getFrozenReferenceEvidence(env, started.siteGenerationId))!;
  const analysis = await runReferenceAnalysisStage(env, {
    siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId,
    buildVersionNumber: 1, evidence: frozen.evidence, evidenceR2Key: frozen.evidenceR2Key,
    generate: async () => ({ content: JSON.stringify(ANALYSIS), provider: "test", model: "test-model-a" }),
  });
  const blueprint = await runVisualBlueprintStage(env, {
    siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId,
    buildVersionNumber: 1, analysis: analysis.analysis, analysisR2Key: analysis.artifactR2Key,
    facts: FACTS, adaptationContract: null, referenceUrl: "https://reference.example.com/",
    evidenceRegions: frozen.evidence.regions,
    generate: async () => ({ content: JSON.stringify(BLUEPRINT), provider: "test", model: "test-model-b" }),
  });
  const siteId = (await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
    .bind(started.siteGenerationId).first<{ site_id: string }>())!.site_id;
  const contract = await produceImplementationContract(env, {
    siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId,
    siteId, blueprint: blueprint.blueprint, facts: FACTS,
  });
  return {
    siteGenerationId: started.siteGenerationId,
    siteId,
    buildId: created.buildId,
    buildVersionId: created.buildVersionId,
    contract: contract.contract,
    blueprintR2Key: blueprint.artifactR2Key,
    contractR2Key: contract.artifactR2Key,
  };
}

describe("incremental four-page generation", () => {
  it("repairs a deterministic assembly-validation failure with ONE informed page regeneration (production retest 2026-09-05)", async () => {
    const context = await preparedContext();
    // The production defect shape: the footer region is rendered as a
    // <section class="footer-zone"> — footer CONTENT without the semantic
    // <footer> element the assembly validator mechanically requires.
    const footerlessHome = HOME_HTML.replace(/<footer>/i, '<section class="footer-zone">').replace(/<\/footer>/i, "</section>");
    expect(footerlessHome.toLowerCase()).not.toContain("<footer");
    const prompts: string[] = [];
    let repairCalls = 0;
    const generate: RawAiGenerate = async (_system, user) => {
      prompts.push(user);
      if (user.includes("Assembly repair directives")) {
        repairCalls += 1;
        expect(user).toContain("missing semantic <footer>");
        return { content: JSON.stringify({ html: HOME_HTML }), provider: "test", model: "test-model-g" };
      }
      if (user.includes("shared stylesheet")) return { content: JSON.stringify({ css: SHARED_CSS }), provider: "test", model: "test-model-g" };
      if (user.includes("minimal shared runtime")) return { content: JSON.stringify({ js: SHARED_JS }), provider: "test", model: "test-model-g" };
      if (user.includes("page id 'home'")) return { content: JSON.stringify({ html: footerlessHome }), provider: "test", model: "test-model-g" };
      if (user.includes("page id 'about'")) return { content: JSON.stringify({ html: ABOUT_HTML }), provider: "test", model: "test-model-g" };
      if (user.includes("page id 'services'")) return { content: JSON.stringify({ html: SERVICES_HTML }), provider: "test", model: "test-model-g" };
      return { content: JSON.stringify({ html: CONTACT_HTML }), provider: "test", model: "test-model-g" };
    };

    const site = await generateCompleteSite(env, {
      siteGenerationId: context.siteGenerationId,
      siteId: context.siteId,
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      blueprint: BLUEPRINT,
      blueprintR2Key: context.blueprintR2Key,
      contract: context.contract,
      contractR2Key: context.contractR2Key,
      generate,
    });

    expect(repairCalls, `findings: ${JSON.stringify(site.validation.findings)}`).toBe(1);
    expect(site.validation.passed, `findings: ${JSON.stringify(site.validation.findings)}`).toBe(true);
    expect(site.pages.home.toLowerCase()).toContain("<footer");
    const repairArtifact = await env.DB.prepare(
      "SELECT id FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home.assembly-repair-1'"
    ).bind(context.buildVersionId).first();
    expect(repairArtifact).not.toBeNull();
  });

  it("passes canonical measured composition targets to the home prompt when provided", async () => {
    const context = await preparedContext();
    const fullPrompts: string[] = [];
    const { generate } = generateForSite();
    const capturingGenerate: RawAiGenerate = async (system, user) => {
      fullPrompts.push(user);
      return generate(system, user);
    };

    const withTargets = await generateCompleteSite(env, {
      siteGenerationId: context.siteGenerationId,
      siteId: context.siteId,
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      blueprint: BLUEPRINT,
      blueprintR2Key: context.blueprintR2Key,
      contract: context.contract,
      contractR2Key: context.contractR2Key,
      generate: capturingGenerate,
      compositionTargets: [
        { regionId: "hero", viewportHeightRatio: 0.78, evidenceSegmentCount: 1 },
        { regionId: "intro", viewportHeightRatio: 1.56, evidenceSegmentCount: 2 },
      ],
    });
    expect(withTargets.validation.passed).toBe(true);
    const homePrompt = fullPrompts.find((prompt) => prompt.includes("page id 'home'"))!;
    expect(homePrompt).toContain("MEASURED COMPOSITION TARGETS");
    expect(homePrompt).toContain("hero ≈ 0.78 viewport-heights (aggregated from 1 measured evidence segment)");
    expect(homePrompt).toContain("intro ≈ 1.56 viewport-heights (aggregated from 2 measured evidence segments)");
    // The Blueprint stays the only binding topology: canonical sections, not
    // a raw-segment count.
    expect(homePrompt).toContain("ONE top-level <section data-region>");
    expect(homePrompt).toContain("never split one canonical region into several top-level data-region sections");

    // Without targets the prompt stays unchanged (no targets block) — a
    // fresh Build Version so nothing is reused from the first generation.
    const context2 = await preparedContext();
    fullPrompts.length = 0;
    await generateCompleteSite(env, {
      siteGenerationId: context2.siteGenerationId,
      siteId: context2.siteId,
      buildId: context2.buildId,
      buildVersionId: context2.buildVersionId,
      buildVersionNumber: 1,
      blueprint: BLUEPRINT,
      blueprintR2Key: context2.blueprintR2Key,
      contract: context2.contract,
      contractR2Key: context2.contractR2Key,
      generate: capturingGenerate,
    });
    const plainHomePrompt = fullPrompts.find((prompt) => prompt.includes("page id 'home'"))!;
    expect(plainHomePrompt).not.toContain("MEASURED COMPOSITION TARGETS");
  });

  it("generates all four pages plus shared source from one Blueprint + one Implementation Contract, incrementally", async () => {
    const context = await preparedContext();
    const { generate, calls } = generateForSite();

    const site = await generateCompleteSite(env, {
      siteGenerationId: context.siteGenerationId,
      siteId: context.siteId,
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      blueprint: BLUEPRINT,
      blueprintR2Key: context.blueprintR2Key,
      contract: context.contract,
      contractR2Key: context.contractR2Key,
      generate,
    });

    // Incremental: six distinct model calls (css, js, home, about, services, contact).
    expect(calls).toHaveLength(6);
    expect(calls.some((call) => call.includes("shared stylesheet"))).toBe(true);

    // All four pages from the same contract file plan.
    expect(site.pages.home).toContain('data-region="hero"');
    expect(site.pages.about).toContain("<h1>About");
    expect(site.pages.services).toContain("<h1>Services");
    expect(site.pages.contact).toContain("<h1>Contact");
    expect(site.validation.passed).toBe(true);
    expect(site.validation.findings).toEqual([]);

    // Reference-specific topology survives (no universal template): home is
    // region-structured per the Blueprint, inner pages differ from home.
    expect(site.pages.home).not.toBe(site.pages.about);
    expect(site.pages.home.includes('data-region="hero"')).toBe(true);
    expect(site.pages.about.includes('data-region="hero"')).toBe(false);

    // Shared CSS/JS reused by every page.
    for (const html of Object.values(site.pages)) {
      expect(html).toContain('href="site.css"');
      expect(html).toContain('src="site.js"');
    }
    expect(site.sharedCss).toContain("@media");
    expect(site.sharedJs).toContain("nav-toggle");

    // Deterministic image plan with stable slot identity.
    const slotIds = site.imagePlan.slots.map((slot) => slot.id);
    expect(slotIds).toContain("home-hero");
    expect(slotIds).toContain("home-services-overview");
    expect(slotIds).toContain("about-main");
    expect(slotIds).toContain("contact-atmosphere");
    const hero = site.imagePlan.slots.find((slot) => slot.id === "home-hero")!;
    expect(hero.priority).toBe("CRITICAL");
    expect(hero.blueprintRole).toBe("role-hero");

    // Artifacts persisted immutably per page + shared + plan.
    expect(site.artifacts.filter((artifact) => artifact.kind === "generated_page")).toHaveLength(4);
    expect(site.artifacts.find((artifact) => artifact.kind === "image_plan")).toBeTruthy();

    // The canonical builds/{id}/v{n}/source/* freeze happens at assembly
    // with image placeholders resolved (issue #12); generation persists the
    // immutable stage artifacts above only.
    const pageArtifact = site.artifacts.find((artifact) => artifact.kind === "generated_page" && artifact.subkey === "home");
    expect(pageArtifact).toBeTruthy();

    // Build advanced through generation + deterministic validation.
    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(context.buildId).all<{ to_state: string }>();
    expect((events.results ?? []).map((row) => row.to_state)).toEqual([
      "INTAKE_READY", "REFERENCE_CHECK", "REFERENCE_EVIDENCE", "REFERENCE_ANALYSIS", "BLUEPRINT",
      "IMPLEMENTATION_PLAN", "SITE_GENERATION", "SITE_VALIDATION",
    ]);
  });

  it("rejects fabricated Business Facts during deterministic assembly validation", async () => {
    const context = await preparedContext();
    const fabricatedHome = HOME_HTML.replace(
      "<h1>Small-batch roasting for cafes and homes</h1>",
      "<h1>Small-batch roasting for cafes and homes</h1><p>Award-winning roastery with 500 clients since 1998.</p>"
    );
    const { generate } = generateForSite({ homeHtml: fabricatedHome });

    await expect(
      generateCompleteSite(env, {
        siteGenerationId: context.siteGenerationId, siteId: context.siteId,
        buildId: context.buildId, buildVersionId: context.buildVersionId, buildVersionNumber: 1,
        blueprint: BLUEPRINT, blueprintR2Key: context.blueprintR2Key,
        contract: context.contract, contractR2Key: context.contractR2Key, generate,
      })
    ).rejects.toBeInstanceOf(SiteGenerationValidationError);

    // Validation findings name the fabrication.
    const source: AssembledSiteSource = {
      pages: { home: fabricatedHome, about: ABOUT_HTML, services: SERVICES_HTML, contact: CONTACT_HTML },
      sharedCss: SHARED_CSS,
      sharedJs: SHARED_JS,
    };
    const verdict = validateAssembledSite(source, {
      contract: context.contract,
      slots: deriveImagePlan(BLUEPRINT).slots,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining(["FABRICATED_AWARD", "FABRICATED_SOCIAL_PROOF", "FABRICATED_YEAR"])
    );
  });
});

describe("deterministic assembly validation", () => {
  const goodSource: AssembledSiteSource = {
    pages: { home: HOME_HTML, about: ABOUT_HTML, services: SERVICES_HTML, contact: CONTACT_HTML },
    sharedCss: SHARED_CSS,
    sharedJs: SHARED_JS,
  };

  function planImplementationFixture(): ImplementationContract {
    return {
      version: "1",
      blueprintVisualThesis: BLUEPRINT.visualThesis,
      blueprintSignatureTraitIds: BLUEPRINT.signatureTraits.map((trait) => trait.id),
      blueprintFirstViewportRegionIds: ["hero"],
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
      imageSlotStrategy: { roleIds: ["role-hero", "role-detail"] },
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

  const slots = deriveImagePlan(BLUEPRINT).slots;

  it("passes a complete, contract-consistent, responsive, factually-provenant source", () => {
    const verdict = validateAssembledSite(goodSource, { contract: planImplementationFixture(), slots });
    expect(verdict.findings).toEqual([]);
    expect(verdict.passed).toBe(true);
  });

  it("fails on missing pages, broken navigation, missing regions and non-responsive CSS", () => {
    const missing = { ...goodSource, pages: { ...goodSource.pages, about: "" } };
    expect(validateAssembledSite(missing, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("MISSING_PAGE");

    const brokenNav = { ...goodSource, pages: { ...goodSource.pages, home: goodSource.pages.home.replace('href="/about"', 'href="/portfolio"') } };
    expect(validateAssembledSite(brokenNav, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("BROKEN_NAV_LINK");

    const missingRegion = { ...goodSource, pages: { ...goodSource.pages, home: goodSource.pages.home.replace('data-region="contact-cta"', 'data-region="renamed"') } };
    expect(validateAssembledSite(missingRegion, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("MISSING_REGION");

    const flatCss = { ...goodSource, sharedCss: goodSource.sharedCss.replace(/@media/g, "media-at") };
    expect(validateAssembledSite(flatCss, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("NON_RESPONSIVE_CSS");

    const noViewport = { ...goodSource, pages: { ...goodSource.pages, home: goodSource.pages.home.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', "") } };
    expect(validateAssembledSite(noViewport, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("MISSING_VIEWPORT_META");
  });

  it("fails image placeholders that bypass slot identity and forms that control delivery", () => {
    const directImage = { ...goodSource, pages: { ...goodSource.pages, about: goodSource.pages.about.replace('src="IMG:about-detail"', 'src="https://stock.example.com/img.jpg"') } };
    expect(validateAssembledSite(directImage, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("IMG_NOT_SLOT_PLACEHOLDER");

    const unknownSlot = { ...goodSource, pages: { ...goodSource.pages, about: goodSource.pages.about.replace("IMG:about-detail", "IMG:about-mystery").replace('data-image-id="about-detail"', 'data-image-id="about-mystery"') } };
    expect(validateAssembledSite(unknownSlot, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("UNKNOWN_IMG_SLOT");

    const controllingForm = { ...goodSource, pages: { ...goodSource.pages, contact: goodSource.pages.contact.replace('<input type="hidden" name="siteFormId"', '<input type="hidden" name="recipient" value="owner@example.com"\n  <input type="hidden" name="siteFormId"') } };
    expect(validateAssembledSite(controllingForm, { contract: planImplementationFixture(), slots }).findings.map((f) => f.id)).toContain("FORM_CONTRACT_VIOLATION");
  });

  it("derives a stable image plan where attempts/crops never change slot identity", () => {
    const first = deriveImagePlan(BLUEPRINT);
    const second = deriveImagePlan(BLUEPRINT);
    expect(first).toEqual(second);
    expect(first.version).toBe("1");
    expect(first.slots.filter((slot) => slot.page === "home").length).toBeGreaterThanOrEqual(2);
    expect(new Set(first.slots.map((slot) => slot.id)).size).toBe(first.slots.length);
  });
});

// ── Issue #52: the informed assembly repair is immutable AND idempotent ─────
//
// Production (build bbba52df, 2026-09-06): the workflow engine retried the
// generate-site stage and each retry re-ran the repair model call, then died
// on ARTIFACT_ALREADY_EXISTS for the same {pageId}.assembly-repair-1 subkey —
// ~22 wasted LLM calls, no convergence. The repair must follow the same
// reuse-before-generate discipline as every other immutable stage, with
// reuse bound to the exact deterministic repair request.

type RepairSeamOptions = { homeHtml?: string; repairHtml?: string; failFirstRepairCall?: boolean };

function repairSeam(options: RepairSeamOptions = {}) {
  const state = { totalCalls: 0, repairCalls: 0, successfulRepairCalls: 0 };
  const generate: RawAiGenerate = async (_system, user) => {
    state.totalCalls += 1;
    if (user.includes("Assembly repair directives")) {
      state.repairCalls += 1;
      if (options.failFirstRepairCall && state.successfulRepairCalls === 0) {
        throw new Error("simulated provider failure during repair generation");
      }
      state.successfulRepairCalls += 1;
      return { content: JSON.stringify({ html: options.repairHtml ?? HOME_HTML }), provider: "test", model: "test-model-g" };
    }
    if (user.includes("shared stylesheet")) return { content: JSON.stringify({ css: SHARED_CSS }), provider: "test", model: "test-model-g" };
    if (user.includes("minimal shared runtime")) return { content: JSON.stringify({ js: SHARED_JS }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'home'")) return { content: JSON.stringify({ html: options.homeHtml ?? HOME_HTML }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'about'")) return { content: JSON.stringify({ html: ABOUT_HTML }), provider: "test", model: "test-model-g" };
    if (user.includes("page id 'services'")) return { content: JSON.stringify({ html: SERVICES_HTML }), provider: "test", model: "test-model-g" };
    return { content: JSON.stringify({ html: CONTACT_HTML }), provider: "test", model: "test-model-g" };
  };
  return { generate, state };
}

const runGeneration = (context: Awaited<ReturnType<typeof preparedContext>>, generate: RawAiGenerate) =>
  generateCompleteSite(env, {
    siteGenerationId: context.siteGenerationId,
    siteId: context.siteId,
    buildId: context.buildId,
    buildVersionId: context.buildVersionId,
    buildVersionNumber: 1,
    blueprint: BLUEPRINT,
    blueprintR2Key: context.blueprintR2Key,
    contract: context.contract,
    contractR2Key: context.contractR2Key,
    generate,
  });

describe("informed assembly repair is idempotent under engine retries (issue #52)", () => {
  const footerlessHome = () =>
    HOME_HTML.replace(/<footer>/i, '<section class="footer-zone">').replace(/<\/footer>/i, "</section>");

  it("stores the repair exactly once, provenance-bound to the deterministic repair request", async () => {
    const context = await preparedContext();
    const { generate, state } = repairSeam({ homeHtml: footerlessHome() });

    const site = await runGeneration(context, generate);

    expect(site.validation.passed).toBe(true);
    expect(state.successfulRepairCalls).toBe(1);
    const row = await env.DB.prepare(
      "SELECT id, provenance_json FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home.assembly-repair-1'"
    ).bind(context.buildVersionId).first<{ id: string; provenance_json: string }>();
    expect(row).not.toBeNull();
    const provenance = JSON.parse(row!.provenance_json);
    expect(provenance.repairRequestFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("engine re-entry reuses the stored repair with ZERO additional model calls and an identical result", async () => {
    const context = await preparedContext();
    const first = repairSeam({ homeHtml: footerlessHome() });
    const site1 = await runGeneration(context, first.generate);
    expect(first.state.successfulRepairCalls).toBe(1);

    const before = await env.DB.prepare(
      "SELECT id, checksum, created_at FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home.assembly-repair-1'"
    ).bind(context.buildVersionId).first<{ id: string; checksum: string; created_at: string }>();

    // Simulated engine re-entry of the same stage against the same D1/R2
    // truth: ANY provider call during re-entry is the production wedge
    // regression — the frozen artifacts must carry the whole replay.
    const loudGenerate: RawAiGenerate = async () => {
      throw new Error("engine retry called the model — stored repair reuse was required (issue #52)");
    };
    const site2 = await runGeneration(context, loudGenerate);

    expect(site2.validation.passed).toBe(true);
    expect(site2.pages.home).toBe(site1.pages.home);
    expect(site2.artifacts.map((a) => a.r2Key).sort()).toEqual(site1.artifacts.map((a) => a.r2Key).sort());
    const after = await env.DB.prepare(
      "SELECT id, checksum, created_at FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home.assembly-repair-1'"
    ).bind(context.buildVersionId).first<{ id: string; checksum: string; created_at: string }>();
    expect(after).toEqual(before);
  });

  it("a stored repair with mismatched provenance fails terminally — never reused, never regenerated", async () => {
    const context = await preparedContext();
    // Corrupt state: a repair artifact already exists but its provenance does
    // not belong to the deterministic repair request this stage will compute.
    await storeBuildStageArtifact(env, {
      buildId: context.buildId, buildVersionId: context.buildVersionId, siteGenerationId: context.siteGenerationId,
      kind: "generated_page", subkey: "home.assembly-repair-1", schemaVersion: "generated-source/page-home/1",
      value: { html: HOME_HTML },
      provenance: {
        promptId: "website-generator", promptVersion: "test", promptDomainContractVersion: "test",
        model: "test-model-g", schemaVersion: "generated-source/page-home/1", attempt: 1, inputArtifactIds: [],
        repairRequestFingerprint: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    });

    const { generate, state } = repairSeam({ homeHtml: footerlessHome() });
    await expect(runGeneration(context, generate)).rejects.toThrowError(/REPAIR_ARTIFACT_MISMATCH/);
    expect(state.repairCalls).toBe(0);
  });

  it("a failed repair generation stores nothing, and the retry converges without escalating the attempt or consuming repair budget", async () => {
    const context = await preparedContext();
    const first = repairSeam({ homeHtml: footerlessHome(), repairHtml: HOME_HTML, failFirstRepairCall: true });
    await expect(runGeneration(context, first.generate)).rejects.toThrowError(/simulated provider failure/);
    expect(first.state.repairCalls).toBe(1);

    const second = repairSeam({ homeHtml: footerlessHome(), repairHtml: HOME_HTML });
    const site = await runGeneration(context, second.generate);
    expect(site.validation.passed).toBe(true);
    // The retry generated exactly once and stored once — generate-exactly-
    // once per durable attempt, no attempt-number escalation.
    expect(second.state.successfulRepairCalls).toBe(1);

    const attempts = await env.DB.prepare(
      "SELECT subkey FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey LIKE '%assembly-repair%'"
    ).bind(context.buildVersionId).all<{ subkey: string }>();
    expect(attempts.results.map((r) => r.subkey)).toEqual(["home.assembly-repair-1"]);
    // The generation-stage assembly repair never touches the bounded QA
    // repair budget (repair_batches belongs to Fix Coordinator batches).
    const batches = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM repair_batches WHERE build_id = ?"
    ).bind(context.buildId).first<{ n: number }>();
    expect(batches!.n).toBe(0);
  });
});

describe("the truth contract rides every generation and repair prompt (issue #53)", () => {
  it("page generation prompts carry the trust-context truth rule", async () => {
    const context = await preparedContext();
    const prompts: string[] = [];
    const base = repairSeam({});
    const generate: RawAiGenerate = async (system, user) => {
      prompts.push(user);
      return base.generate(system, user);
    };
    const site = await runGeneration(context, generate);
    expect(site.validation.passed).toBe(true);
    const homePrompt = prompts.find((p) => p.includes("page id 'home'"))!;
    expect(homePrompt).toContain("TRUST-CONTEXT TRUTH RULE (binding, issue #48/#53)");
    expect(homePrompt).toContain("Working with Rift Valley Roasters");
    expect(homePrompt).toContain("NEVER invent clients, partners, companies, awards");
  });

  it("the informed assembly repair prompt inherits the binding business-truth clause", async () => {
    const context = await preparedContext();
    const footerless = () =>
      HOME_HTML.replace(/<footer>/i, '<section class="footer-zone">').replace(/<\/footer>/i, "</section>");
    const prompts: string[] = [];
    const base = repairSeam({ homeHtml: footerless() });
    const generate: RawAiGenerate = async (system, user) => {
      prompts.push(user);
      return base.generate(system, user);
    };
    const site = await runGeneration(context, generate);
    expect(site.validation.passed).toBe(true);
    const repairPrompt = prompts.find((p) => p.includes("Assembly repair directives"))!;
    expect(repairPrompt).toContain("BUSINESS TRUTH (binding, issue #48/#53");
    expect(repairPrompt).toContain("No invented clients, partners, companies, awards");
    expect(repairPrompt).toContain("fact-safe substitutes");
  });
});
