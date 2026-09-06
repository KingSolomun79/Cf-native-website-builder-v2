// Golden-path script builder for benchmark runs (issue #17+).
//
// Produces deterministic, schema-valid outputs for every AI stage of the
// benchmark pipeline from ONE frozen case definition, plus a cost-configured
// image provider, preview deployer and QA capture. The scripts derive from
// the case's frozen evidence (regions, traits, roles) so the same case always
// yields the same inputs — implementation changes, not moving benchmark
// inputs, are what change outcomes.

import type { RawAiGenerate } from "../../src/domain/ai-boundary";
import type { ImageGenerationProvider } from "../../src/domain/image-pipeline";
import type { PreviewDeployer } from "../../src/domain/assembly";
import type { QaCaptureFn } from "../../src/domain/qa-evidence";
import type { BenchmarkCaseDefinition } from "../../src/domain/benchmark";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS } from "../../src/domain/qa-stages";

const FORM_ENDPOINT = "https://forms.wazibiz.example/api/v2/forms/submit";

function caseBlueprintJson(caseDefinition: BenchmarkCaseDefinition): Record<string, unknown> {
  const regions = caseDefinition.evidence.regions;
  const heroRegion = regions[0];
  const detailRegion = regions[1];
  return {
    version: "1",
    visualThesis: `Premium ${caseDefinition.archetype} clarity for ${caseDefinition.brief.businessName}: signature composition over generous whitespace with the Business's own content and imagery.`,
    signatureTraits: [
      { id: "bp-typography", description: "Oversized display type for the Business's own statements", sourceTraitId: "trait-typography" },
      { id: "bp-region-flow", description: `The Reference's ${regions.length}-region silhouette and flow`, sourceTraitId: "trait-region-flow" },
      { id: "bp-surface", description: "Alternating surface treatment across regions", sourceTraitId: "trait-surface" },
    ],
    fidelityPriorities: ["first viewport topology", "region order", "whitespace rhythm"],
    tokens: { "color.ink": "#1a1a1a", "color.paper": "#faf7f2", "space.section": "clamp(4rem, 10vh, 8rem)" },
    globalGrid: { containerLogic: "max-width 1200px, 12-col grid with asymmetric splits", columnRatios: ["5/7"] },
    spacingRhythm: "Generous section padding with tight intra-component spacing",
    typographyRoles: [
      { role: "display", description: "oversized statements" },
      { role: "body", description: "readable body copy" },
    ],
    colorRoles: [
      { role: "ink", description: "near-black text" },
      { role: "paper", description: "warm surfaces" },
    ],
    surfaceLanguage: "Flat surfaces alternating paper and ink",
    headerNavigation: "Minimal sticky header with wordmark and plain links",
    homepageFirstViewport: { summary: "Signature first viewport opening the Reference silhouette", regionIds: [heroRegion.id] },
    homepageRegions: regions.map((region, index) => ({
      id: region.id,
      purpose: `Realize the Reference '${region.id}' region for the Business`,
      sourceEvidenceRegionIds: [region.id],
      ...(index === 0 ? { imageRoleId: "role-hero" } : index === 1 ? { imageRoleId: "role-detail" } : {}),
    })),
    imageSystem: {
      photographyGrammar: "Editorial documentary photography, natural light",
      imageRoles: [
        { id: "role-hero", purpose: "first-viewport editorial hero image", priority: "CRITICAL" },
        { id: "role-detail", purpose: `supporting ${caseDefinition.brief.businessType} detail imagery`, priority: "NORMAL" },
      ],
    },
    motionGrammar: ["subtle fade-up reveals"],
    responsiveContract: ["asymmetric splits stack below 768px", "nav collapses to a button menu at 768px"],
    innerPageVocabulary: ["page-header", "content-section", "fact-list", "cta-band"],
    antiFallbackRules: ["never collapse the asymmetric grid into a centered stack on desktop"],
    accessibilityAdaptations: ["contrast raised to WCAG AA"],
    declaredLimitations: caseDefinition.adaptationContract?.acceptedApproximations.map((entry) => entry.replaces) ?? [],
    // detailRegion is referenced so the role mapping stays exercised
    __detailRegion: detailRegion.id,
  };
}

function caseAnalysisJson(caseDefinition: BenchmarkCaseDefinition): Record<string, unknown> {
  return {
    version: "1",
    visualSystemSummary: `${caseDefinition.archetype} system with signature composition, whitespace rhythm and surface alternation.`,
    hierarchy: [{ level: "display", description: "oversized headline dominates the first viewport", confidence: "HIGH" }],
    signatureTraits: [
      { id: "trait-typography", description: "Oversized display type", identityDefining: true, evidenceRefs: ["h1"] },
      { id: "trait-region-flow", description: "Distinctive region silhouette and order", identityDefining: true, evidenceRefs: [caseDefinition.evidence.regions[0].id] },
      { id: "trait-surface", description: "Surface alternation across bands", identityDefining: false, evidenceRefs: [caseDefinition.evidence.regions[1].id] },
    ],
    designIntent: [{ hypothesis: "premium authority for a local business", confidence: "MEDIUM" }],
    photographicGrammar: { summary: "editorial documentary imagery", imageRoles: ["hero", "detail"] },
    responsiveBehavior: ["two-column collapses to single column below 768px"],
    motionBehavior: caseDefinition.evidence.motionObservations.map((observation) => observation.kind),
    identityCarriers: ["trait-typography", "trait-region-flow"],
  };
}

// Issue #47 realization binding: the canned stylesheet scopes a real rule to
// EVERY canonical region of the case and defines every class its canned pages
// use — exactly what the binding contract demands from the generated CSS.
function sharedCssFor(regions: Array<{ id: string }>): string {
  const regionRules = regions
    .map((region, index) => {
      if (index === 0) {
        return `[data-region="${region.id}"] { display: grid; grid-template-columns: 5fr 7fr; min-height: 88vh; align-items: center; }\n[data-region="${region.id}"] h1 { font-size: clamp(3rem, 7vw, 6rem); line-height: 1.02; }`;
      }
      if (index % 3 === 2) {
        return `[data-region="${region.id}"] { padding-block: var(--section); background: var(--ink); color: var(--paper); }`;
      }
      return `[data-region="${region.id}"] { padding-block: var(--section); }`;
    })
    .join("\n");
  const mobileRegionRules = regions.map((region) => `[data-region="${region.id}"] { grid-template-columns: 1fr; }`).join(" ");
  return `
:root { --ink: #1a1a1a; --paper: #faf7f2; --section: clamp(4rem, 10vh, 8rem); }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--paper); color: var(--ink); }
.container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }
.hero { display: grid; grid-template-columns: 5fr 7fr; min-height: 88vh; align-items: center; }
.hero h1 { font-size: clamp(3rem, 7vw, 6rem); line-height: 1.02; }
.section { padding-block: var(--section); }
.surface-ink { background: var(--ink); color: var(--paper); }
.site-nav { display: flex; align-items: center; justify-content: space-between; padding: 1rem 1.5rem; }
.wordmark { font-size: 1.25rem; text-decoration: none; color: var(--ink); }
.page-header { padding-block: 5rem 2rem; }
.content-section { padding-block: 3rem; }
.fact-list { padding-block: 3rem; }
.cta-band { padding-block: 5rem; background: var(--ink); color: var(--paper); text-align: center; }
[data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity .6s ease, transform .6s ease; }
[data-reveal].is-visible { opacity: 1; transform: none; }
${regionRules}
@media (max-width: 768px) {
  .hero { grid-template-columns: 1fr; min-height: auto; }
  ${mobileRegionRules}
  .nav-links { display: none; }
  .nav-toggle { display: grid; }
}
@media (prefers-reduced-motion: reduce) { [data-reveal] { transition: none; } }
`;
}

const SHARED_JS = `
(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) { toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); }); }
  var reveal = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    reveal.forEach(function (el) { io.observe(el); });
  } else { reveal.forEach(function (el) { el.classList.add('is-visible'); }); }
})();
`;

function navLinks(): string {
  return `<header><nav class="site-nav" aria-label="Primary"><a class="wordmark" href="/">Home</a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links">Menu</button>
  <div class="nav-links" id="nav-links"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></div></nav></header>`;
}

function shell(title: string, description: string, main: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="stylesheet" href="site.css">
<script src="site.js" defer></script>
</head>
<body>
${navLinks()}
<main>
${main}
</main>
<footer><p>${title}</p></footer>
</body>
</html>`;
}

function img(slotId: string, alt: string): string {
  return `<img src="IMG:${slotId}" data-image-id="${slotId}" alt="${alt}">`;
}

export interface GoldenScripts {
  generate: RawAiGenerate;
  imageProvider: ImageGenerationProvider;
  previewDeployer: PreviewDeployer;
  qaCapture: QaCaptureFn;
}

export interface GoldenScriptOptions {
  /** Cost per generated image in USD (default 0.15 keeps 12 slots inside the gate). */
  imageCostUsd?: number;
  /** Extra override applied to the last user prompt per call (test hooks). */
  onUserPrompt?: (user: string) => void;
}

export function createGoldenScripts(caseDefinition: BenchmarkCaseDefinition, options: GoldenScriptOptions = {}): GoldenScripts {
  const regions = caseDefinition.evidence.regions;
  const heroRegion = regions[0];
  const detailRegion = regions[1];
  const business = caseDefinition.brief.businessName;

  const finalHome = shell(
    `${business}`,
    `${business} — ${caseDefinition.brief.businessDescription ?? business}`,
    regions
      .map((region, index) => {
        const heading = index === 0 ? `<h1>${business}</h1>` : `<h2>${region.id.replace(/-/g, " ")}</h2>`;
        const media =
          index === 0
            ? `
  <figure>${img(`home-${heroRegion.id}`, `${business} signature imagery`)}</figure>`
            : index === 1
              ? `
  <figure>${img(`home-${detailRegion.id}`, `${business} detail imagery`)}</figure>`
              : "";
        const sectionClass = index === 0 ? "hero" : `section${index % 3 === 2 ? " surface-ink" : ""}`;
        return `<section class="${sectionClass}" data-region="${region.id}" data-reveal>
  ${heading}<p>${business} content for the ${region.id.replace(/-/g, " ")} region.</p>${media}
</section>`;
      })
      .join("\n")
  );

  const aboutHtml = shell(
    `About — ${business}`,
    `About ${business}`,
    `<section class="page-header" data-region="about-region-1"><h1>About ${business}</h1></section>
<section class="content-section" data-region="about-region-2"><p>${caseDefinition.brief.businessDescription ?? business}</p>
${img("about-main", `${business} main imagery`)}</section>
<section class="fact-list" data-region="about-region-3"><ul><li>${caseDefinition.brief.businessType ?? business}</li><li>${caseDefinition.brief.city ?? ""} ${caseDefinition.brief.country ?? ""}</li></ul>
${img("about-detail", `${business} detail imagery`)}</section>`
  );
  const servicesHtml = shell(
    `Services — ${business}`,
    `Services offered by ${business}`,
    `<section class="page-header" data-region="services-region-1"><h1>Services</h1></section>
<section class="content-section" data-region="services-region-2"><p>Services from ${business}.</p>
${img("services-main", `${business} services imagery`)}</section>
<section class="cta-band" data-region="services-region-3"><a href="/contact">Get in touch</a>
${img("services-detail", `${business} services detail`)}</section>`
  );
  const contactHtml = shell(
    `Contact — ${business}`,
    `Contact ${business}`,
    `<section class="page-header" data-region="contact-region-1"><h1>Contact</h1></section>
<section class="content-section" data-region="contact-region-2">
${img("contact-atmosphere", `${business} atmosphere`)}
<form method="post" action="${FORM_ENDPOINT}">
  <input type="hidden" name="siteFormId" value="site:SITE_ID">
  <label>Name<input type="text" name="name" required></label>
  <label>Email<input type="email" name="email" required></label>
  <label>Message<textarea name="message" required></textarea></label>
  <button type="submit">Send message</button>
</form></section>`
  );

  const generate: RawAiGenerate = async (_system, user) => {
    options.onUserPrompt?.(user);
    const respond = (value: unknown) => ({
      content: JSON.stringify(value),
      provider: "benchmark-script",
      model: "benchmark-golden-model",
    });

    if (user.includes("Interpret the frozen versioned Reference Evidence")) {
      return respond(caseAnalysisJson(caseDefinition));
    }
    if (user.includes("Produce the binding Visual Blueprint")) {
      const blueprint = caseBlueprintJson(caseDefinition);
      delete (blueprint as Record<string, unknown>)["__detailRegion"];
      return respond(blueprint);
    }
    if (user.includes("shared stylesheet")) {
      return respond({ css: sharedCssFor(regions) });
    }
    if (user.includes("minimal shared runtime")) {
      return respond({ js: SHARED_JS });
    }
    if (user.includes("page id 'home'")) {
      return respond({ html: finalHome });
    }
    if (user.includes("page id 'about'")) {
      return respond({ html: aboutHtml });
    }
    if (user.includes("page id 'services'")) {
      return respond({ html: servicesHtml });
    }
    if (user.includes("page id 'contact'")) {
      // The runner's contract pins siteFormId to the real Site identity; the
      // prompt embeds it — extract and inject into the scripted page.
      const siteFormId = /value="(site:[a-f0-9-]+)"/.exec(user)?.[1] ?? "site:unknown";
      return respond({ html: contactHtml.replace("site:SITE_ID", siteFormId) });
    }
    if (user.includes("Generate KIE image prompts")) {
      const slotsBlock = user.slice(user.indexOf("IMAGE SLOTS:"));
      const slotIds = [...slotsBlock.matchAll(/"id":\s*"([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]);
      const records = slotIds.map((slotId) => ({
        slotId,
        promptText: `Editorial documentary photograph for ${business} realizing the '${slotId}' requirement with natural light, balanced composition and generous negative space.`,
        altText: `${business} ${slotId.replace(/-/g, " ")} photograph`,
        shotType: "wide editorial",
        lighting: "natural window light",
        avoidance: "no text overlays, no logos, no watermarks",
      }));
      return respond({ records });
    }
    if (user.includes("hard composition gate")) {
      return respond({
        version: "1",
        visualScore: 94,
        contentScore: 93,
        fabrication: false,
        hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
        findings: [],
      });
    }
    if (user.includes("browser/technical review")) {
      return respond({
        version: "1",
        technicalScore: 95,
        gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
        findings: [],
      });
    }
    throw new Error(`benchmark golden script has no output for prompt: ${user.slice(0, 120)}`);
  };

  const cost = options.imageCostUsd ?? 0.15;
  const imageProvider: ImageGenerationProvider = {
    createTask: async (task) => ({ taskId: `kie-${task.slotId}-${Math.random().toString(36).slice(2, 8)}`, costUsd: cost }),
    fetchResult: async (taskId) => ({
      status: "complete" as const,
      bytes: new TextEncoder().encode(`WEBP-${taskId}`),
      temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
    }),
  };

  const previewDeployer: PreviewDeployer = async ({ workerName }) => ({
    previewUrl: `https://${workerName}.wazibizwebsites.workers.dev/`,
  });

  const qaCapture: QaCaptureFn = async (spec) =>
    spec.map((entry) => ({
      page: entry.page,
      viewportWidth: entry.viewportWidth,
      fullPageScreenshot: new TextEncoder().encode(`PNG-qa-${entry.page}-${entry.viewportWidth}`),
      ...(entry.firstViewport ? { firstViewportScreenshot: new TextEncoder().encode(`PNG-qa-${entry.page}-${entry.viewportWidth}-first`) } : {}),
      geometry: {
        regionOrder: entry.page === "home" ? regions.map((region) => region.id) : [`${entry.page}-header`, `${entry.page}-body`, `${entry.page}-cta`],
        firstViewportHeightRatio: regions[0].viewportHeightRatio,
        sectionHeightRatios: regions.map((region) => region.height / (regions[0].height || 1)),
        imageMassRatio: 0.38,
        containerWidthRatio: 0.83,
        columnRatios: [5 / 7],
        dominantAlignment: "asymmetric" as const,
        surfaceSequence: regions.map((_, index) => (index % 3 === 2 ? "ink" : "paper")),
        whitespaceRatio: 0.22,
      },
      runtime: { consoleErrors: [], failedRequests: [] },
    }));

  return { generate, imageProvider, previewDeployer, qaCapture };
}
