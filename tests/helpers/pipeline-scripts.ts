// Shared deterministic scripts for the production build pipeline (issue #30).
//
// Schema-valid outputs for every AI stage of runBuildPipeline plus image
// provider / preview deployer / QA capture stubs and a screenshot-only
// generation starter. Used by tests/v2-build-pipeline.test.ts (primary) and
// tests/v2-lifecycle.test.ts (workflow-boundary smoke).

import type { Env } from "../../src/env.d";
import type { BuildPipelineDeps } from "../../src/domain/build-pipeline";
import type { RawAiGenerate } from "../../src/domain/ai-boundary";
import type { ImageGenerationProvider } from "../../src/domain/image-pipeline";
import type { PreviewDeployer } from "../../src/domain/assembly";
import type { ReferenceCaptureFn } from "../../src/domain/reference-intake";
import { putObject } from "../../src/lib/assets";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport } from "../../src/domain/qa-stages";
import { buildPng } from "./png";

export const PIPELINE_SCRIPTS_BUSINESS = "Pipeline Wiring Smoke Business";
const BUSINESS = PIPELINE_SCRIPTS_BUSINESS;

/** Persists a valid screenshot-only Reference PNG for a pipeline smoke. */
export async function persistPipelineScreenshot(env: Env, key: string): Promise<void> {
  await putObject(env, key, buildPng({ width: 1440, height: 3200 }));
}

const REGIONS = [
  { id: "r1", height: 720, viewportHeightRatio: 0.8 },
  { id: "r2", height: 880, viewportHeightRatio: 0.98 },
  { id: "r3", height: 800, viewportHeightRatio: 0.89 },
  { id: "r4", height: 640, viewportHeightRatio: 0.71 },
];

const analysisJson = {
  version: "1",
  visualSystemSummary: "Editorial system with signature composition and surface alternation.",
  hierarchy: [{ level: "display", description: "oversized headline dominates the first viewport", confidence: "HIGH" }],
  signatureTraits: [
    { id: "trait-typography", description: "Oversized display type", identityDefining: true, evidenceRefs: ["screenshot"] },
    { id: "trait-region-flow", description: "Distinctive region silhouette and order", identityDefining: true, evidenceRefs: ["screenshot"] },
  ],
  designIntent: [{ hypothesis: "premium authority for a local business", confidence: "MEDIUM" }],
  photographicGrammar: { summary: "editorial documentary imagery", imageRoles: ["hero", "detail"] },
  responsiveBehavior: ["two-column collapses to single column below 768px"],
  motionBehavior: [],
  identityCarriers: ["trait-typography", "trait-region-flow"],
};

const blueprintJson = {
  version: "1",
  visualThesis: "Premium editorial clarity with signature composition over generous whitespace.",
  signatureTraits: [
    { id: "bp-typography", description: "Oversized display type for statements", sourceTraitId: "trait-typography" },
    { id: "bp-region-flow", description: "The Reference's 4-region silhouette and flow", sourceTraitId: "trait-region-flow" },
    { id: "bp-surface", description: "Alternating surface treatment across regions", sourceTraitId: "trait-typography" },
  ],
  fidelityPriorities: ["first viewport topology", "region order", "whitespace rhythm"],
  tokens: { "color.ink": "#1a1a1a", "color.paper": "#faf7f2" },
  globalGrid: { containerLogic: "max-width 1200px, asymmetric splits", columnRatios: ["5/7"] },
  spacingRhythm: "Generous section padding",
  typographyRoles: [{ role: "display", description: "oversized statements" }, { role: "body", description: "body copy" }],
  colorRoles: [{ role: "ink", description: "near-black text" }, { role: "paper", description: "warm surfaces" }],
  surfaceLanguage: "Flat surfaces alternating paper and ink",
  headerNavigation: "Minimal sticky header",
  homepageFirstViewport: { summary: "Signature first viewport", regionIds: ["r1"] },
  homepageRegions: REGIONS.map((region, index) => ({
    id: region.id,
    purpose: `Realize the '${region.id}' region`,
    sourceEvidenceRegionIds: [region.id],
    ...(index === 0 ? { imageRoleId: "role-hero" } : index === 1 ? { imageRoleId: "role-detail" } : {}),
  })),
  imageSystem: {
    photographyGrammar: "Editorial documentary photography",
    imageRoles: [
      { id: "role-hero", purpose: "first-viewport editorial hero image", priority: "CRITICAL" },
      { id: "role-detail", purpose: "supporting detail imagery", priority: "NORMAL" },
    ],
  },
  motionGrammar: ["subtle fade-up reveals"],
  responsiveContract: ["asymmetric splits stack below 768px"],
  innerPageVocabulary: ["page-header", "content-section", "fact-list", "cta-band"],
  antiFallbackRules: ["never collapse the asymmetric grid into a centered stack on desktop"],
  accessibilityAdaptations: ["contrast raised to WCAG AA"],
  declaredLimitations: [],
};

const SHARED_CSS = `
:root { --ink: #1a1a1a; --paper: #faf7f2; }
body { margin: 0; font-family: system-ui, sans-serif; background: var(--paper); color: var(--ink); }
.hero { display: grid; grid-template-columns: 5fr 7fr; min-height: 88vh; align-items: center; }
.section { padding-block: clamp(4rem, 10vh, 8rem); }
.surface-ink { background: var(--ink); color: var(--paper); }
/* Issue #47 realization binding: every canonical region carries a real rule
   scoped to its data-region selector. */
[data-region="r1"] { min-height: 92vh; display: grid; grid-template-columns: 5fr 7fr; align-items: center; }
[data-region="r2"] { padding-block: var(--section-pad, 6rem); background: var(--paper); }
[data-region="r3"] { padding-block: clamp(4rem, 10vh, 8rem); background: var(--ink); color: var(--paper); display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; }
[data-region="r4"] { padding-block: 6rem; text-align: center; }
@media (max-width: 768px) { .hero { grid-template-columns: 1fr; } [data-region="r1"] { grid-template-columns: 1fr; } [data-region="r3"] { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { * { transition: none; } }
`;

const SHARED_JS = `
(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) { toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); }); }
})();
`;

function nav(): string {
  return `<header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
}

function shell(title: string, main: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} — ${BUSINESS}"><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head><body>${nav()}<main>${main}</main><footer><p>${title}</p></footer></body></html>`;
}

const img = (slotId: string, alt: string) => `<img src="IMG:${slotId}" data-image-id="${slotId}" alt="${alt}">`;

const homeHtml = shell(
  BUSINESS,
  REGIONS.map((region, index) => {
    const heading = index === 0 ? `<h1>${BUSINESS}</h1>` : `<h2>${region.id}</h2>`;
    const media = index === 0 ? img("home-r1", "signature") : index === 1 ? img("home-r2", "detail") : "";
    return `<section data-region="${region.id}">${heading}<p>Content.</p>${media}</section>`;
  }).join("")
);

const aboutHtml = shell(`About — ${BUSINESS}`, `<section><h1>About</h1><p>Description.</p>${img("about-main", "about")}</section><section><ul><li>Detail</li></ul>${img("about-detail", "about detail")}</section>`);
const servicesHtml = shell(`Services — ${BUSINESS}`, `<section><h1>Services</h1><p>Services.</p>${img("services-main", "services")}</section><section><a href="/contact">Get in touch</a>${img("services-detail", "services detail")}</section>`);

const passingQaA: QaAReport = {
  version: "1", visualScore: 94, contentScore: 93, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};
const failingQaA: QaAReport = {
  version: "1", visualScore: 86, contentScore: 93, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [{ severity: "P1", domain: "visual-fidelity", description: "hero heading contrast too weak in first viewport", evidenceRef: "qa/home-1440-first.png" }],
};
// Confirmation-seam variant (issue #38): the same still-present defect must
// be reported with the explicit ACTIVE status.
const failingConfirmationQaA = {
  version: "1", visualScore: 86, contentScore: 93, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [{ severity: "P1", domain: "visual-fidelity", description: "hero heading contrast too weak in first viewport", evidenceRef: "qa/home-1440-first.png", status: "ACTIVE" as const }],
};
const passingQaB: QaBReport = {
  version: "1", technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })), findings: [],
};

// Issue #38 production defect shape: the confirmation reviewer re-reports a
// PREVIOUSLY IDENTIFIED blocker as fixed, keeping its original severity.
// The structured `status: "RESOLVED"` field is the confirmation seam's
// explicit resolution state (the variable indirection keeps the object
// assignable to the fresh-QaA finding type before the fix lands too).
const resolvedFirstViewportNoteA = {
  severity: "P1" as const,
  domain: "FIRST_VIEWPORT",
  description:
    "Previously identified first-viewport height ratio defect is resolved on the new Build Version. Hero region now completes within one viewport at ratio ~0.93 (reference 0.9, tolerance 0.15).",
  evidenceRef: "qa/home-1440-first.png",
  status: "RESOLVED" as const,
};
const resolvedFirstViewportNoteB = {
  severity: "P1" as const,
  domain: "FIRST_VIEWPORT",
  description:
    "Previously identified P1 re-verified after repair: hero now completes within one viewport at ratio ~0.93.",
  evidenceRef: "qa/home-390.png",
  status: "RESOLVED" as const,
};
const resolvedNoteConfirmationQaA: QaAReport = {
  version: "1", visualScore: 93, contentScore: 92, fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [resolvedFirstViewportNoteA],
};
const resolvedNoteConfirmationQaB: QaBReport = {
  version: "1", technicalScore: 93,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [resolvedFirstViewportNoteB],
};

function contactHtml(endpoint: string, siteFormId: string): string {
  return shell(
    `Contact — ${BUSINESS}`,
    `<section><h1>Contact</h1>${img("contact-atmosphere", "atmosphere")}
<form method="post" action="${endpoint}"><input type="hidden" name="siteFormId" value="${siteFormId}">
<label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label><label>Message<textarea name="message" required></textarea></label><button type="submit">Send</button></form></section>`
  );
}

export function createPipelineScripts(
  options: {
    /** Only the FIRST full QA-A evaluation fails (then always passes). */
    firstQaAFails?: boolean;
    /** Every full QA-A evaluation fails (repair-resistance scenarios). */
    allQaAFails?: boolean;
    /** Post-repair confirmation QA-A fails (second-batch scenarios). */
    confirmationQaAFails?: boolean;
    /** Post-repair confirmation re-emits the prior P1 as a RESOLVED note
     *  with its original severity (issue #38 regression scenario). */
    confirmationQaEmitsResolvedNote?: boolean;
    /** Fix Coordinator plan trips the text-boundary heuristic once (then the
     *  re-worded plan complies) or always (violator scenarios). */
    fixCoordinatorPlanTrips?: "once" | "always";
  } = {}
): BuildPipelineDeps {
  let qaACalls = 0;
  let fixCoordinatorCalls = 0;
  const generate: RawAiGenerate = async (_system, user) => {
    const respond = (value: unknown) => ({
      content: JSON.stringify(value),
      provider: "pipeline-script",
      model: "glm-5.3-flash",
    });

    if (user.includes("Interpret the frozen versioned Reference Evidence")) return respond(analysisJson);
    if (user.includes("Produce the binding Visual Blueprint")) return respond(blueprintJson);
    if (user.includes("shared stylesheet")) return respond({ css: SHARED_CSS });
    if (user.includes("minimal shared runtime")) return respond({ js: SHARED_JS });
    if (user.includes("page id 'home'")) return respond({ html: homeHtml });
    if (user.includes("page id 'about'")) return respond({ html: aboutHtml });
    if (user.includes("page id 'services'")) return respond({ html: servicesHtml });
    if (user.includes("page id 'contact'")) {
      const endpoint = /action="(https:\/\/[^"]+\/api\/v2\/forms\/submit)"/.exec(user)?.[1] ?? "";
      const siteFormId = /value="(site:[a-f0-9-]+)"/.exec(user)?.[1] ?? "site:unknown";
      return respond({ html: contactHtml(endpoint, siteFormId) });
    }
    if (user.includes("Generate KIE image prompts")) {
      const slotIds = [...user.slice(user.indexOf("IMAGE SLOTS:")).matchAll(/"id":\s*"([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]);
      return respond({
        records: slotIds.map((slotId) => ({
          slotId,
          promptText: `Editorial photograph realizing '${slotId}' with natural light and negative space.`,
          altText: `${slotId} photograph`,
          shotType: "wide editorial",
          lighting: "natural window light",
          avoidance: "no text overlays",
        })),
      });
    }
    if (user.includes("hard composition gate")) {
      qaACalls += 1;
      const fail = options.allQaAFails || (options.firstQaAFails && qaACalls === 1);
      return respond(fail ? failingQaA : passingQaA);
    }
    if (user.includes("browser/technical review")) return respond(passingQaB);
    if (user.includes("Plan ONE coordinated main Automated Repair batch")) {
      fixCoordinatorCalls += 1;
      const trips =
        options.fixCoordinatorPlanTrips === "always" ||
        (options.fixCoordinatorPlanTrips === "once" && !user.includes("YOUR PREVIOUS PLAN WAS REJECTED"));
      if (trips) {
        // Schema-valid realization plan whose wording trips the deterministic
        // mutation-pattern scan (mentions the Blueprint as a reference point
        // next to an update verb).
        return respond({
          version: "1",
          rootCauses: [{ findingRef: "qa/home-1440-first.png", domain: "visual-fidelity", rootCause: "hero heading rendered below token contrast" }],
          repairs: [{ target: "implementation", strategy: "html_structure", description: "Update the hero section markup so it reflects the blueprint's first-viewport silhouette." }],
          blueprintReviewRequired: false,
        });
      }
      return respond({
        version: "1",
        rootCauses: [{ findingRef: "qa/home-1440-first.png", domain: "visual-fidelity", rootCause: "hero heading rendered below token contrast" }],
        repairs: [{ target: "implementation", strategy: "css_geometry_crop", description: "Tighten hero heading color to the ink token within existing styles." }],
        blueprintReviewRequired: false,
      });
    }
    if (user.includes("QA-A Confirmation")) {
      if (options.confirmationQaEmitsResolvedNote) return respond(resolvedNoteConfirmationQaA);
      return respond(options.confirmationQaAFails ? failingConfirmationQaA : passingQaA);
    }
    if (user.includes("QA-B Confirmation")) {
      if (options.confirmationQaEmitsResolvedNote) return respond(resolvedNoteConfirmationQaB);
      return respond(passingQaB);
    }
    if (user.includes("Plan at most ONE narrow final Automated Repair batch")) {
      return respond({
        version: "1",
        rootCauses: [{ findingRef: "qa/home-1440-first.png", domain: "visual-fidelity", rootCause: "residual contrast gap" }],
        repairs: [{ target: "implementation", strategy: "css_geometry_crop", description: "Raise hero heading weight one step." }],
        blueprintReviewRequired: false,
      });
    }
    throw new Error(`pipeline script has no output for prompt: ${user.slice(0, 120)}`);
  };

  const imageProvider: ImageGenerationProvider = {
    createTask: async (task) => ({ taskId: `kie-${task.slotId}-${Math.random().toString(36).slice(2, 8)}`, costUsd: 0.15 }),
    fetchResult: async (taskId) => ({
      status: "complete" as const,
      bytes: new TextEncoder().encode(`WEBP-${taskId}`),
      temporaryUrl: `https://tmp.kie.example/${taskId}.webp`,
    }),
  };

  const previewDeployer: PreviewDeployer = async ({ workerName }) => ({
    previewUrl: `https://${workerName}.wazibizwebsites.workers.dev/`,
  });

  // Reference URL capture with measured design-structure evidence (issue #39):
  // dimensions-only evidence is INSUFFICIENT by design, so pipeline fixtures
  // model the valid screenshot+URL mode with a real measured capture.
  const capture: ReferenceCaptureFn = async () => ({
    canonicalScreenshot: {
      content: buildPng({ width: 1440, height: 3200 }),
      mimeType: "image/png",
      pixelWidth: 1440,
      pixelHeight: 3200,
      likelyCssViewportWidth: 1440,
    },
    captures: [
      { viewportWidth: 1440, viewportHeight: 900, content: buildPng({ width: 1440, height: 900 }), mimeType: "image/png" },
    ],
    regions: REGIONS.map((region, index) => ({
      id: region.id,
      startY: index * 800,
      endY: index * 800 + region.height,
      height: region.height,
      viewportHeightRatio: region.viewportHeightRatio,
    })),
    measuredElements: [
      {
        selectorHint: "header nav",
        role: "navigation",
        boundingBox: { x: 0, y: 0, width: 1440, height: 88 },
        confidence: "HIGH" as const,
        source: "DOM" as const,
      },
      {
        selectorHint: "h1",
        role: "typography",
        computed: { fontFamily: "'Editorial Serif'", fontSize: "72px", fontWeight: "700" },
        confidence: "MEDIUM" as const,
        source: "COMPUTED_STYLE" as const,
      },
    ],
    responsiveObservations: [{ kind: "viewport_matrix", viewports: ["desktop", "mobile"] }],
    motionObservations: [],
    discrepancies: [],
  });

  return {
    generate,
    imageProvider,
    previewDeployer,
    capture,
    qaCapture: () => async (spec) =>
      spec.map((entry) => ({
        page: entry.page,
        viewportWidth: entry.viewportWidth,
        fullPageScreenshot: new TextEncoder().encode(`PNG-qa-${entry.page}-${entry.viewportWidth}`),
        ...(entry.firstViewport ? { firstViewportScreenshot: new TextEncoder().encode(`PNG-qa-${entry.page}-1440-first`) } : {}),
        geometry: {
          regionOrder: REGIONS.map((region) => region.id),
          firstViewportHeightRatio: REGIONS[0].viewportHeightRatio,
          sectionHeightRatios: REGIONS.map((region) => region.height / REGIONS[0].height),
          imageMassRatio: 0.38,
          containerWidthRatio: 0.83,
          columnRatios: [5 / 7],
          dominantAlignment: "asymmetric" as const,
          surfaceSequence: REGIONS.map((_, index) => (index % 3 === 2 ? "ink" : "paper")),
          whitespaceRatio: 0.22,
        },
        runtime: { consoleErrors: [], failedRequests: [] },
      })),
  };
}

