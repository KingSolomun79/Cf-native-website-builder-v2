// Deterministic scripts for the SIMPLE design pipeline (experiment branch).
//
// Schema-valid outputs for the four SIMPLE stages (design blueprint, website
// builder, visual QA, site repair) plus image provider / preview deployer /
// QA capture stubs, mirroring tests/helpers/pipeline-scripts.ts for the
// legacy chain. The blueprint answer is the KNOWN-GOOD Finch-format fixture
// (format/quality reference only — never a runtime business assumption).

import type { Env } from "../../src/env.d";
import type { RawAiGenerate } from "../../src/domain/ai-boundary";
import type { ImageGenerationProvider } from "../../src/domain/image-pipeline";
import type { PreviewDeployer } from "../../src/domain/assembly";
import type { ReferenceCaptureFn } from "../../src/domain/reference-intake";
import type { SimplePipelineDeps } from "../../src/simple-design/pipeline";
import { putObject } from "../../src/lib/assets";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "../_generated-simple-finch";
import { FINCH_V2_KNOWN_GOOD_BLUEPRINT } from "../_generated-simple-finch-v2";
import { buildDecodableSolidPng } from "./png";

export const SIMPLE_SCRIPTS_BUSINESS = "RankForge Kenya";

// Decodable low-ink PNGs (same trick as the legacy `visionReference` scripts):
// the intake's vision-input derivation needs a real decodable surface, so the
// SIMPLE blueprint/builder stages legitimately receive Reference visuals.
export async function persistSimpleScreenshot(env: Env, key: string): Promise<void> {
  await putObject(env, key, await buildDecodableSolidPng(1440, 3200));
}

// design-blueprint/2 known-good fixture (the pipeline's blueprint contract
// since the 2026-09-10 operator GO). The v1 fixture remains available via
// finchV1BlueprintFixture for the retained v1 contract tests.
export function simpleBlueprintFixture(): typeof FINCH_V2_KNOWN_GOOD_BLUEPRINT {
  return JSON.parse(JSON.stringify(FINCH_V2_KNOWN_GOOD_BLUEPRINT));
}

export function finchV1BlueprintFixture(): typeof FINCH_KNOWN_GOOD_BLUEPRINT {
  return JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT));
}

const SIMPLE_CSS = `
:root {
  --ground: #1a1a18; --ink: #f5f2ed; --accent: #d9b380;
  --hairline: rgba(217, 179, 128, 0.3);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--ground); color: var(--ink); font-family: system-ui, sans-serif; }
a { color: inherit; }
.site-header { position: fixed; inset: 0 0 auto 0; display: flex; justify-content: space-between; padding: 1.5rem 2rem; z-index: 10; }
.hero { min-height: 100vh; display: grid; place-items: center; position: relative; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 5.5rem); line-height: 1.05; font-weight: 500; }
.section { padding-block: clamp(4rem, 15vh, 9rem); }
.section-inner { max-width: 1200px; margin-inline: auto; padding-inline: 24px; }
.rows { border-top: 1px solid var(--hairline); }
.row { display: grid; grid-template-columns: 4rem 1fr auto; gap: 2rem; padding: 2rem 0; border-bottom: 1px solid var(--hairline); }
.row .index { color: var(--accent); }
.split { display: grid; grid-template-columns: 3fr 2fr; gap: 3rem; align-items: center; }
.cta { display: inline-block; border: 1px solid var(--accent); color: var(--accent); border-radius: 999px; padding: 0.75rem 2rem; }
.cta:hover { background: var(--accent); color: var(--ground); }
img { max-width: 100%; display: block; }
.site-nav a { margin-left: 1.5rem; }
.site-nav a:hover { color: var(--accent); }
form { display: grid; gap: 1rem; max-width: 480px; }
label { font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.08em; }
input, textarea { background: transparent; border: 1px solid var(--hairline); color: var(--ink); padding: 0.75rem; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.site-footer { border-top: 1px solid var(--hairline); padding: 3rem 2rem; display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; }
@media (max-width: 1023px) { .split { grid-template-columns: 1fr; } }
@media (max-width: 767px) { .row { grid-template-columns: 1fr; } .site-footer { grid-template-columns: 1fr; } .hero { min-height: 70vh; } .site-nav { display: none; } .nav-toggle { display: block; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

const SIMPLE_JS = `
(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) { toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); }); }
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!reduce.matches && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) entry.target.classList.add('revealed'); });
    }, { threshold: 0.2 });
    document.querySelectorAll('.section').forEach(function (section) { observer.observe(section); });
  }
})();
`;

function nav(): string {
  return `<header class="site-header"><a href="/">Home</a><nav class="site-nav" aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav><button class="nav-toggle" aria-label="Menu">Menu</button></header>`;
}

function shell(title: string, main: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} — quiet luxury"><meta property="og:title" content="${title}"><meta property="og:description" content="${title}"><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body>${nav()}<main>${main}</main><footer class="site-footer"><p>© <span id="year">2026</span> ${title}</p></footer></body></html>`;
}

const img = (slotId: string, alt: string) => `<img src="IMG:${slotId}" data-image-id="${slotId}" alt="${alt}">`;

function homeHtml(): string {
  return shell(
    "RankForge Kenya",
    `<section class="hero"><div><img src="IMG:home-hero" data-image-id="home-hero" alt="Dawn savannah"><h1>RankForge Kenya</h1><p>Quiet authority, built for the wild corners of search.</p></div><a class="cta" href="/contact">Enquire</a></section>` +
      `<section class="section"><div class="section-inner"><p class="statement">We build search engines a reason to trust you.</p></div></section>` +
      `<section class="section"><div class="section-inner"><h2>Chapters</h2><div class="rows">` +
      ["Technical SEO", "Content Systems", "Digital PR", "Analytics", "Local Search"]
        .map((row, index) => `<div class="row"><span class="index">0${index + 1}</span><h3>${row}</h3><p>Built for Kenyan businesses.</p></div>`)
        .join("") +
      `</div></div></section>` +
      `<section class="section"><div class="section-inner split"><div>${img("home-location", "Hills at dusk")}</div><div><h2>Where we work</h2><p>From Nairobi to the coast.</p><a href="/contact">Talk to us</a></div></div></section>` +
      `<section class="hero"><div><img src="IMG:home-closing" data-image-id="home-closing" alt="Campfire at dusk"><h2>Your story begins here</h2><a class="cta" href="/contact">Enquire</a></div></section>`
  );
}

function aboutHtml(): string {
  return shell(
    `About — RankForge Kenya`,
    `<section class="hero about-hero"><div><img src="IMG:about-hero" data-image-id="about-hero" alt="Guiding team at first light"><h1>About</h1><p>Quiet authority since the first season.</p></div></section><section class="section"><div class="section-inner split"><div>${img("about-story", "Craft detail")}</div><div><h2>Our story</h2><p>We are an SEO agency in Nairobi.</p><a href="/services">See services</a></div></div></section>`
  );
}

function servicesHtml(): string {
  return shell(
    `Services — RankForge Kenya`,
    `<section class="hero services-hero"><div><img src="IMG:services-hero" data-image-id="services-hero" alt="Guides preparing for a drive"><h1>Services</h1><p>Three disciplines, one standard.</p></div></section><section class="section"><div class="section-inner"><div class="rows">` +
      ["Technical audits", "Content systems", "Digital PR"].map((row, index) => `<div class="row"><span class="index">0${index + 1}</span><h3>${row}</h3><p><a href="/contact">Enquire</a></p></div>`).join("") +
      `</div></div></section>`
  );
}

function contactHtml(endpoint: string, siteFormId: string): string {
  return shell(
    `Contact — RankForge Kenya`,
    `<section class="hero contact-hero"><div><img src="IMG:contact-hero" data-image-id="contact-hero" alt="Evening at the camp fire"><h1>Contact</h1><p>Begin the conversation.</p></div></section><section class="section"><div class="section-inner split"><div><form method="post" action="${endpoint}"><input type="hidden" name="siteFormId" value="${siteFormId}"><label for="name">Name</label><input id="name" name="name" required><label for="email">Email</label><input id="email" name="email" type="email" required><label for="message">Message</label><textarea id="message" name="message" required></textarea><button class="cta" type="submit">Send enquiry</button></form></div><div><h2>Reach us</h2><p>ops@wazibizwebsites.example</p></div></div></section>`
  );
}

export interface SimpleScriptsOptions {
  /** First visual QA fails (overall 70) so the ONE repair path runs. */
  firstVisualQaFails?: boolean;
  /** Every visual QA fails — final HUMAN_REVIEW_REQUIRED scenario. */
  allVisualQaFails?: boolean;
  /** Return a blueprint that passes schema but fails the quality gate. */
  blueprintFailsGate?: boolean;
  /** The builder omits the CRITICAL about-hero on its page call — the
   *  Builder coverage fail-closed path. */
  builderOmitsAboutHero?: boolean;
}

export function createSimpleScripts(options: SimpleScriptsOptions = {}): SimplePipelineDeps {
  let visualQaCalls = 0;
  let repairCalls = 0;
  const aboutPage = () => (options.builderOmitsAboutHero ? aboutHtml().replace(/<img src="IMG:about-hero"[^>]*>/, "") : aboutHtml());

  const generate: RawAiGenerate = async (_system, user) => {
    const respond = (value: unknown) => ({
      content: JSON.stringify(value),
      provider: "simple-script",
      model: "glm-5.3-flash",
    });

    if (user.includes("produce the Design Blueprint for the REPLACEMENT business")) {
      if (options.blueprintFailsGate) {
        const broken = simpleBlueprintFixture();
        broken.designDna = broken.designDna.slice(0, 3); // 5-8 rule violated
        return respond(broken);
      }
      return respond(simpleBlueprintFixture());
    }
    // Builder file-realization calls (file-sized GO): each call returns ONE
    // file as RAW source — never JSON. The routed Builder model is full
    // GLM-5.3 (stage routing provenance).
    const respondRaw = (content: string) => ({ content, provider: "simple-script", model: "@cf/zai-org/glm-5.3" });
    if (user.includes("call 1 of 6")) {
      return respondRaw(SIMPLE_CSS);
    }
    if (user.includes("call 6 of 6")) {
      return respondRaw(SIMPLE_JS);
    }
    const builderPage = /Realize the \"(home|about|services|contact)\" page/.exec(user);
    if (builderPage) {
      const endpoint = /form action:\s*(\S+)/.exec(user)?.[1] ?? "";
      const siteFormId = /value=\"(site:[^"]+)\"/.exec(user)?.[1] ?? "site:unknown";
      const page = builderPage[1];
      return respondRaw(
        page === "home" ? homeHtml()
        : page === "about" ? aboutPage()
        : page === "services" ? servicesHtml()
        : contactHtml(endpoint, siteFormId)
      );
    }
    if (user.includes("Compare the CANDIDATE renders against the REFERENCE screenshots")) {
      visualQaCalls += 1;
      const fail = options.allVisualQaFails || (options.firstVisualQaFails && visualQaCalls === 1);
      if (fail) {
        return respond({
          version: "1",
          scores: {
            macroLayout: 88, typography: 68, spacingRhythm: 90, surfaceColor: 88,
            imageTreatment: 84, components: 90, signatureElements: 86, responsive: 88,
            overall: 70,
          },
          findings: [
            {
              rank: 1,
              title: "Display typography is far too small",
              reference: "Reference hero headline spans ~60% of viewport width",
              candidate: "Candidate hero headline reads at body scale",
              direction: "Apply the blueprint Hero H1 clamp(2.5rem, 6vw, 5.5rem) to .hero h1",
            },
          ],
          summary: "Typography scale collapses the design identity; layout is otherwise faithful.",
        });
      }
      return respond({
        version: "1",
        scores: {
          macroLayout: 94, typography: 93, spacingRhythm: 94, surfaceColor: 93,
          imageTreatment: 91, components: 94, signatureElements: 93, responsive: 92,
          overall: 93,
        },
        findings: [],
        summary: "The candidate clearly reads as the same underlying design.",
      });
    }
    if (user.includes("QA PACKAGE (complete repair brief)")) {
      repairCalls += 1;
      if (repairCalls > 1) {
        throw new Error("SIMPLE repair script invoked twice — the one-repair budget was violated");
      }
      // Changed-files repair (hardening F-repair): the repair returns ONLY the
      // changed file; the deterministic merge must reproduce the full bundle.
      return respond({
        files: [{ path: "index.html", content: homeHtml() }],
        notes: "scripted repair: home file replaced",
      });
    }
    throw new Error(`simple script has no output for prompt: ${user.slice(0, 120)}`);
  };

  const imageProvider: ImageGenerationProvider = {
    createTask: async (task) => ({ taskId: `kie-simple-${task.slotId}`, costUsd: 0.15 }),
    fetchResult: async (taskId) => ({
      status: "complete" as const,
      bytes: new TextEncoder().encode(`WEBP-${taskId}`),
      temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
    }),
  };

  const previewDeployer: PreviewDeployer = async ({ workerName }) => ({
    previewUrl: `https://${workerName}.wazibizwebsites.workers.dev/`,
  });

  const capture: ReferenceCaptureFn = async () => ({
    canonicalScreenshot: {
      content: await buildDecodableSolidPng(1440, 3200),
      mimeType: "image/png",
      pixelWidth: 1440,
      pixelHeight: 3200,
      likelyCssViewportWidth: 1440,
    },
    captures: [
      { viewportWidth: 1440, viewportHeight: 900, content: await buildDecodableSolidPng(1440, 3200), mimeType: "image/png" },
    ],
    regions: [
      { id: "hero", startY: 0, endY: 900, height: 900, viewportHeightRatio: 1 },
      { id: "statement", startY: 900, endY: 1800, height: 900, viewportHeightRatio: 1 },
      { id: "chapters", startY: 1800, endY: 2400, height: 600, viewportHeightRatio: 0.66 },
    ],
    measuredElements: [
      {
        selectorHint: "h1",
        role: "typography",
        computed: { fontFamily: "serif", fontSize: "96px", fontWeight: "500" },
        confidence: "HIGH" as const,
        source: "COMPUTED_STYLE" as const,
      },
    ],
    responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
    motionObservations: [],
    discrepancies: [],
  });

  return {
    generate,
    // The SIMPLE stages are multimodal; the same scripted answers serve both
    // transport shapes (the scripts branch on the user prompt text only).
    visionGenerate: generate,
    imageProvider,
    previewDeployer,
    capture,
    qaCapture: () => async (spec) =>
      spec.map((entry) => ({
        page: entry.page,
        viewportWidth: entry.viewportWidth,
        fullPageScreenshot: new TextEncoder().encode(`PNG-simple-${entry.page}-${entry.viewportWidth}`),
        ...(entry.firstViewport ? { firstViewportScreenshot: new TextEncoder().encode(`PNG-simple-${entry.page}-first`) } : {}),
        geometry: {
          regionOrder: ["hero", "statement", "chapters"],
          firstViewportHeightRatio: 1,
          sectionHeightRatios: [1, 1, 0.66],
          imageMassRatio: 0.35,
          containerWidthRatio: 0.83,
          columnRatios: [0.6],
          dominantAlignment: "asymmetric" as const,
          surfaceSequence: ["photo", "ground", "ground"],
          whitespaceRatio: 0.25,
        },
        runtime: { consoleErrors: [], failedRequests: [] },
      })),
  };
}
