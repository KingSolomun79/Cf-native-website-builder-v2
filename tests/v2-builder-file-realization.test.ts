// SIX_CALL_FILE_REALIZATION Builder on the Z.AI Coding Plan — DOM-FIRST,
// CSS-LAST (operator GO 2026-09-11: VISUAL FIDELITY ITERATION), proven at the
// repository's seams:
//
//   §1-§2   the Builder routes to Coding Plan glm-5.3 (never fallback), and
//           the per-file budgets stay in place
//   §3-§7   stage discipline: exactly SIX calls in the DOM-first canonical
//           order (home → about → services → contact → site.css → site.js),
//           one semantic generation each; prompt v8 raw-output discipline;
//           frozen outputs thread home(chrome+vocabulary) → pages → css(all
//           four docs) → js; per-call runs, artifacts and per-file resume
//           artifacts persist
//   §8      §18 frozen shared chrome: home defines it; the remaining pages
//           receive it in the prompt and MUST reproduce it exactly — a
//           mismatch fails closed (SOURCE_INCOMPLETE) before CSS/JS run
//   §9      a fenced site.css realization is deterministically stripped once
//   §10-§11 SOURCE_INCOMPLETE fails closed after the ONE semantic generation
//   §12     OUTPUT_EXHAUSTED fails closed deterministically
//   §13-§15 provenance (reasoning control), cost telemetry, strategy note
//   §16-§17 §20 resume: completed per-file artifacts are REUSED (no model
//           call, reused metrics) and the stage continues at the first
//           missing file; a resumed CSS still receives ALL FOUR page files;
//           the frozen bundle short-circuit still wins
//   §18     §6 HOME STRUCTURAL VOCABULARY: deterministic extraction, threaded
//           to the inner pages only
//   §19     §26 DOM-first gate: site.css referencing structure absent from
//           the four documents AND site.js fails closed (invented markup)

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  BUILDER_CSS_MAX_COMPLETION_TOKENS,
  BUILDER_FILE_CALL_ORDER,
  BUILDER_JS_MAX_COMPLETION_TOKENS,
  BUILDER_PAGE_MAX_COMPLETION_TOKENS,
  BUILDER_REASONING_CONTROL,
  BUILDER_STRATEGY_NOTE,
  cssSelectorFailures,
  estimateBuilderCallCostUsd,
  extractHomeStructuralVocabulary,
  resolveWebsiteBuilderModel,
  runSimpleBuilderFileRealizationCore,
  runSimpleWebsiteBuilderStage,
  SimpleWebsiteBuilderError,
} from "../src/simple-design/website-builder";
import { ZaiCodingPlanOutputExhaustedError } from "../src/lib/zai-coding-plan";
import { composeStagePrompt } from "../src/domain/prompt-contract";
import { classifyStageFailure } from "../src/domain/stage-failure";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../src/domain/stage-artifacts";
import { createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
import { materializeAcceptedImageDescriptors, type DesignBlueprintV2, type SiteBundle } from "../src/simple-design/contracts";
import { persistSimpleScreenshot, simpleBlueprintFixture } from "./helpers/simple-scripts";

const env = providedEnv as unknown as Env;
const ENDPOINT = "https://test.example.com/api/v2/forms/submit";
const FACTS = {
  businessName: "RankForge Kenya",
  contactEmail: "ops@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
} as const;

// ── fixtures ─────────────────────────────────────────────────────────────────

const HEADER = `<header><nav class="site-nav" aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
const FOOTER = `<footer><p>© <span id="year">2026</span> RankForge Kenya</p></footer>`;

const FULL_PAGE = (pageId: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageId}</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body>${HEADER}
<main><section class="hero ${pageId}-hero"><img src="IMG:${pageId}-hero" data-image-id="${pageId}-hero" alt="${pageId} hero"><h1>${pageId}</h1><p>${pageId} realized body copy of fixture length.</p></section><section class="section"><div class="section-inner"><a class="cta" href="/contact">Enquire</a></div></section></main>
${FOOTER}</body></html>`;

const TOKENS_CSS = `:root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
.hero { min-height: 60vh; display: grid; place-items: center; }
.site-nav { display: flex; gap: 1.5rem; }
.section { padding-block: 4rem; }
.section-inner { max-width: 1200px; margin-inline: auto; }
.cta { border: 1px solid var(--accent); border-radius: 999px; padding: 0.75rem 2rem; }
img { max-width: 100%; display: block; }
form { display: grid; gap: 1rem; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 767px) { .hero { min-height: 40vh; } }
@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }`;

const CODE_JS = `(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) { toggle.addEventListener('click', function () { document.body.classList.toggle('nav-open'); }); }
})();`;

const blueprint = (): DesignBlueprintV2 => simpleBlueprintFixture();

function scriptedSixCallSeam(handlers: {
  css?: string;
  pages?: Record<string, string>;
  js?: string;
  onCall?: (call: string, system: string, user: string) => void;
}) {
  const calls: string[] = [];
  return {
    calls,
    generate: async (system: string, user: string) => {
      const page = /Realize the "(home|about|services|contact)" page/.exec(user)?.[1];
      if (page) {
        calls.push(page);
        handlers.onCall?.(page, system, user);
        return { content: handlers.pages?.[page] ?? FULL_PAGE(page), provider: "test", model: "glm-5.3", tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      if (user.includes("call 5 of 6")) {
        calls.push("site-css");
        handlers.onCall?.("site-css", system, user);
        return { content: handlers.css ?? TOKENS_CSS, provider: "test", model: "glm-5.3", tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      if (user.includes("call 6 of 6")) {
        calls.push("site-js");
        handlers.onCall?.("site-js", system, user);
        return { content: handlers.js ?? CODE_JS, provider: "test", model: "glm-5.3", tokenUsage: { prompt_tokens: 1000, completion_tokens: 100 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      throw new Error(`unexpected builder prompt: ${user.slice(0, 80)}`);
    },
  };
}

async function scaffoldBuild(referenceKey: string): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  await persistSimpleScreenshot(env, referenceKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: FACTS as unknown as typeof FACTS & Record<string, never>,
      reference: { screenshotR2Key: referenceKey },
    },
  });
  const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: build.buildId, buildVersionId: build.buildVersionId };
}

function stageInput(ctx: { siteGenerationId: string; buildId: string; buildVersionId: string }, bp: DesignBlueprintV2, generate: (system: string, user: string) => Promise<{ content: string; provider: string; model: string; tokenUsage?: unknown; finishReason?: string | null; reasoningControl?: string }>) {
  return {
    siteGenerationId: ctx.siteGenerationId,
    buildId: ctx.buildId,
    buildVersionId: ctx.buildVersionId,
    buildVersionNumber: 1,
    blueprint: bp,
    facts: FACTS as unknown as typeof FACTS & Record<string, never>,
    acceptedImages: materializeAcceptedImageDescriptors(bp),
    formServiceEndpoint: ENDPOINT,
    siteFormId: "site:file-realization",
    generate,
  };
}

// ── §1-§2: routing + budgets ─────────────────────────────────────────────────

describe("Coding Plan routing and budgets (GO §4/§10)", () => {
  it("§1 the Builder routes to Coding Plan glm-5.3 — stage policy, never fallback; ZAI_CODING_MODEL may pin explicitly", () => {
    expect(resolveWebsiteBuilderModel({} as Env)).toBe("glm-5.3");
    expect(resolveWebsiteBuilderModel({ ZAI_CODING_MODEL: "glm-5.3" } as Env)).toBe("glm-5.3");
  });

  it("§2 the per-file budgets and the DOM-first canonical call order hold", () => {
    expect(BUILDER_FILE_CALL_ORDER).toEqual(["page-home", "page-about", "page-services", "page-contact", "site-css", "site-js"]);
    expect(BUILDER_CSS_MAX_COMPLETION_TOKENS).toBe(18_000);
    expect(BUILDER_PAGE_MAX_COMPLETION_TOKENS).toBe(16_000);
    expect(BUILDER_JS_MAX_COMPLETION_TOKENS).toBe(6_000);
  });
});

// ── §3-§7: stage discipline ──────────────────────────────────────────────────

describe("stage discipline: SIX calls, one semantic generation each (GO §4)", () => {
  it("§3 the prompt contract is v8 and carries the raw-output discipline", () => {
    const composed = composeStagePrompt("simple-website-builder");
    expect(composed.promptVersion).toBe("v8");
    expect(composed.systemPrompt).toContain("RAW source");
    expect(composed.systemPrompt).toContain("no Markdown fences");
    expect(composed.systemPrompt).toContain("DOM-FIRST");
  });

  it("§4 exactly six calls in DOM-first order: home defines chrome+vocabulary → inner pages → css(all four docs) → js", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-order.png");
    const seenUsers: Record<string, string> = {};
    const seam = scriptedSixCallSeam({ onCall: (call, _s, user) => (seenUsers[call] = user) });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    expect(seam.calls).toEqual(["home", "about", "services", "contact", "site-css", "site-js"]);
    expect(result.strategy).toBe("SIX_CALL_FILE_REALIZATION");
    for (const call of seam.calls) {
      expect(seenUsers[call]).toContain("DESIGN BLUEPRINT (design authority");
      expect(seenUsers[call]).toContain("MANDATORY CRITICAL IMAGE PLACEMENTS");
      expect(seenUsers[call]).toContain("No Markdown fences");
      expect(seenUsers[call]).toContain("Return ONLY the complete contents");
    }
    // No page call receives a stylesheet — CSS DOES NOT EXIST YET (GO §5).
    for (const page of ["home", "about", "services", "contact"]) {
      expect(seenUsers[page]).not.toContain("FROZEN site.css");
    }
    // home DEFINES the chrome and the structural vocabulary
    expect(seenUsers.home).not.toContain("FROZEN SHARED CHROME");
    expect(seenUsers.home).not.toContain("HOME STRUCTURAL VOCABULARY");
    expect(seenUsers.home).toContain("ENCODE COMPOSITION STRUCTURALLY");
    // the inner pages receive the frozen chrome AND the home vocabulary (GO §6/§7)
    for (const page of ["about", "services", "contact"]) {
      expect(seenUsers[page]).toContain("FROZEN SHARED CHROME");
      expect(seenUsers[page]).toContain(HEADER);
      expect(seenUsers[page]).toContain("HOME STRUCTURAL VOCABULARY");
      expect(seenUsers[page]).toContain("site-nav hero home-hero section section-inner cta");
    }
    expect(seenUsers.about).toContain("THIS PAGE'S MANDATORY CRITICAL IMAGES");
    expect(seenUsers.about).toContain("- about-hero");
    // the CSS call is styled AGAINST the four final documents (GO §9)
    expect(seenUsers["site-css"]).toContain("call 5 of 6");
    expect(seenUsers["site-css"]).toContain("AGAINST THE REAL DOM");
    expect(seenUsers["site-css"]).toContain("FIDELITY PRIORITIES");
    expect(seenUsers["site-css"]).toContain("NUMERIC BLUEPRINT VALUES ARE BINDING");
    expect(seenUsers["site-css"]).toContain("IMAGE TREATMENT IS INTENTIONAL");
    for (const page of ["home", "about", "services", "contact"]) {
      expect(seenUsers["site-css"]).toContain(`FROZEN ${page}.html`);
      expect(seenUsers["site-css"]).toContain(FULL_PAGE(page));
    }
    expect(seenUsers["site-css"]).not.toContain("FROZEN SHARED CHROME");
    // js waits for the CSS and all four pages (GO §15/§26)
    expect(seenUsers["site-js"]).toContain("FROZEN site.css");
    expect(seenUsers["site-js"]).toContain("FROZEN home.html");
    expect(seenUsers["site-js"]).toContain("call 6 of 6");
    // the final bundle still wires the shared assets (GO §26)
    expect(result.bundle.pages.home).toContain('href="site.css"');
    expect(result.bundle.pages.home).toContain('src="site.js"');
  });

  it("§5 the assembled bundle passes SiteBundleSchema and persists under the deterministic strategy note", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-persist.png");
    const seam = scriptedSixCallSeam({});
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const bundle: SiteBundle = result.bundle;
    expect(Object.keys(bundle.pages).sort()).toEqual(["about", "contact", "home", "services"]);
    expect(bundle.notes).toBe(BUILDER_STRATEGY_NOTE);
    expect(BUILDER_STRATEGY_NOTE).toContain("glm-5.3 on the Z.AI Coding Plan");
    expect(BUILDER_STRATEGY_NOTE).toContain("SIX_CALL_FILE_REALIZATION");
    expect(BUILDER_STRATEGY_NOTE).toContain("DOM-first");
  });

  it("§6 every call persists its own ai_stage_runs row AND its per-file resume artifact (GO §20)", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-runs.png");
    const seam = scriptedSixCallSeam({});
    await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const rows = await env.DB.prepare(
      "SELECT schema_version, outcome, artifact_r2_key, model FROM ai_stage_runs WHERE build_version_id = ? AND stage = 'simple-website-builder'"
    )
      .bind(ctx.buildVersionId)
      .all<{ schema_version: string; outcome: string; artifact_r2_key: string | null; model: string }>();
    expect((rows.results ?? []).length).toBe(6);
    expect((rows.results ?? []).map((r) => r.schema_version).sort()).toEqual(
      [
        "builder-file/site-css/1",
        "builder-file/page-home/1",
        "builder-file/page-about/1",
        "builder-file/page-services/1",
        "builder-file/page-contact/1",
        "builder-file/site-js/1",
      ].sort()
    );
    for (const row of rows.results ?? []) {
      expect(row.outcome).toBe("valid");
      expect(row.artifact_r2_key).toBeTruthy();
      expect(row.model).toBe("glm-5.3");
    }
    // every per-file resume artifact is frozen
    for (const kind of ["builder_file/page-home", "builder_file/page-about", "builder_file/page-services", "builder_file/page-contact", "builder_file/site-css", "builder_file/site-js"]) {
      const stored = await getBuildStageArtifact<string>(env, ctx.buildVersionId, kind as `builder_file/${string}`);
      expect(stored, kind).not.toBeNull();
    }
  });

  it("§7 the core reports per-call metrics: routed model, finish reason, tokens, estimated cost", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-metrics.png");
    const seam = scriptedSixCallSeam({});
    const core = await runSimpleBuilderFileRealizationCore(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleBuilderFileRealizationCore>[1]);

    expect(core.calls.map((c) => c.call)).toEqual(BUILDER_FILE_CALL_ORDER);
    for (const call of core.calls) {
      expect(call.model).toBe("glm-5.3");
      expect(call.finishReason).toBe("stop");
      expect(call.inputTokens).toBe(1000);
      expect(call.outputTokens).toBeGreaterThan(0);
      expect(call.estimatedCostUsd).toBeGreaterThan(0);
      expect(call.outputChars).toBeGreaterThan(0);
      expect(call.reused).toBeFalsy();
    }
  });

  it("§9 a fenced site.css realization is deterministically stripped exactly once", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-fence.png");
    const seam = scriptedSixCallSeam({ css: "```css\n" + TOKENS_CSS + "\n```" });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.bundle.sharedCss).toBe(TOKENS_CSS);
  });
});

// ── §8: frozen shared chrome ─────────────────────────────────────────────────

describe("frozen shared chrome (GO §6/§18)", () => {
  it("§8a a page that restyles the shared chrome FAILS CLOSED before the css/js calls", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-chrome.png");
    const restyled = FULL_PAGE("about").replace(FOOTER, `<footer><p>© 2026 Different Business</p></footer>`);
    const seam = scriptedSixCallSeam({ pages: { about: restyled } });
    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    const error = thrown as SimpleWebsiteBuilderError;
    expect(error.code).toBe("SOURCE_INCOMPLETE");
    expect(error.message).toContain("frozen shared chrome");
    // the four pages ran; css and js never happened (fail closed before them)
    expect(seam.calls).toEqual(["home", "about", "services", "contact"]);
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("§8b insignificant whitespace variance is NOT redesign — normalized chrome still matches", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-chrome-ws.png");
    // services reflows the header across lines — the same semantic chrome,
    // different insignificant whitespace
    const reflowed = FULL_PAGE("services").replace(
      HEADER,
      HEADER.replace("><a", `>\n  <a`).replace("</nav>", "\n  </nav>")
    );
    const seam = scriptedSixCallSeam({ pages: { services: reflowed } });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.bundle.pages.services).toBe(reflowed);
  });

  it("§8c the aria-current marker MOVES to the current page's nav link — required accessibility, not redesign (live qualification evidence)", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-chrome-aria.png");
    const servicesNav = HEADER.replace('<a href="/services">Services</a>', '<a href="/services" aria-current="page">Services</a>');
    const reflowed = FULL_PAGE("services").replace(HEADER, servicesNav);
    const seam = scriptedSixCallSeam({ pages: { services: reflowed } });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.bundle.pages.services).toBe(reflowed);
  });
});

// ── §18: home structural vocabulary ──────────────────────────────────────────

describe("home structural vocabulary (GO §6)", () => {
  it("§18a extraction is deterministic: first-appearance order, deduplicated, quoted and unquoted class attributes", () => {
    const html = `<body><header class="site-header"><nav class="site-nav nav"></nav></header><main><section class='hero alt-hero'><div class="wrap"><a class="btn cta">x</a><span class="hero">again</span></div></section></main></body>`;
    expect(extractHomeStructuralVocabulary(html)).toBe("site-header site-nav nav hero alt-hero wrap btn cta");
  });

  it("§18b the vocabulary is bounded (200 tokens) so the inner-page prompt stays lean", () => {
    const many = Array.from({ length: 300 }, (_, i) => `c${i}`).join(" ");
    expect(extractHomeStructuralVocabulary(`<div class="${many}"></div>`).split(" ").length).toBe(200);
  });
});

// ── §19: the DOM-first CSS gate (GO §26) ─────────────────────────────────────

describe("site.css cannot invent structure absent from the realized DOM (GO §26)", () => {
  const pages = () => ({
    home: FULL_PAGE("home"),
    about: FULL_PAGE("about"),
    services: FULL_PAGE("services"),
    contact: FULL_PAGE("contact"),
  });

  it("§19a a class selector absent from every page and site.js is flagged", () => {
    const css = `.invented-band { padding: 2rem; }\n${TOKENS_CSS}`;
    const failures = cssSelectorFailures(css, pages(), CODE_JS);
    expect(failures.some((f) => f.includes(".invented-band"))).toBe(true);
    expect(failures.some((f) => f.includes(".hero"))).toBe(false);
  });

  it("§19b a JS state class (toggled by site.js, never in the markup) is a legitimate hook", () => {
    const css = `${TOKENS_CSS}\n.nav-open .site-nav { display: block; }`;
    expect(cssSelectorFailures(css, pages(), CODE_JS)).toEqual([]);
  });

  it("§19c declarations never false-positive: hex colors and custom properties are not selectors", () => {
    const css = `:root { --brand-blue: #2f6fed; }\n.hero { border-color: #abc; background: url(sprite#x.png); }`;
    const failures = cssSelectorFailures(css, pages(), CODE_JS);
    expect(failures).toEqual([]);
  });

  it("§19c' comments are not selectors (live A/B evidence: a `/* … site.css */` header must not flag .css)", () => {
    const css = `/* RankForge Kenya — site.css */\n${TOKENS_CSS}\n/* the .hero wraps the first viewport */\n.section { padding: 2rem; }`;
    expect(cssSelectorFailures(css, pages(), CODE_JS)).toEqual([]);
  });

  it("§19d an id selector must exist in the markup", () => {
    const css = `${TOKENS_CSS}\n#year { font-variant-numeric: tabular-nums; }`;
    expect(cssSelectorFailures(css, pages(), CODE_JS)).toEqual([]);
    const invented = `${TOKENS_CSS}\n#faq-accordion { display: none; }`;
    expect(cssSelectorFailures(invented, pages(), CODE_JS).length).toBe(1);
  });

  it("§19e the gate fails the STAGE closed: invented CSS structure never persists", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-cssgate.png");
    const inventingCss = `.marketing-unicorn-band { display: grid; }\n${TOKENS_CSS}`;
    const seam = scriptedSixCallSeam({ css: inventingCss });
    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    const error = thrown as SimpleWebsiteBuilderError;
    expect(error.code).toBe("SOURCE_INCOMPLETE");
    expect(error.message).toContain("invented structure");
    expect(seam.calls).toEqual(["home", "about", "services", "contact", "site-css", "site-js"]);
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });
});

// ── §10-§12: fail-closed paths ───────────────────────────────────────────────

describe("SOURCE_INCOMPLETE and OUTPUT_EXHAUSTED fail closed", () => {
  it("§10 a meta-stub page never persists: no repair call, deterministic review", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-stub.png");
    const stub = "The home page contains the complete hero section and the rest of the page content follows the blueprint.";
    const seam = scriptedSixCallSeam({ pages: { home: stub } });

    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    const error = thrown as SimpleWebsiteBuilderError;
    expect(error.code).toBe("SOURCE_INCOMPLETE");
    expect(error.message).toContain("page-home");
    expect(seam.calls).toEqual(["home"]);
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("§11 a malformed fence frame is refused deterministically", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-frame.png");
    const seam = scriptedSixCallSeam({ pages: { about: "```html\n<!DOCTYPE html><html><body>never closed" } });
    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    expect((thrown as SimpleWebsiteBuilderError).code).toBe("SOURCE_INCOMPLETE");
    expect(seam.calls).toEqual(["home", "about"]);
  });

  it("§12 OUTPUT_EXHAUSTED at the stage boundary fails closed deterministically", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-exhaust.png");
    const generate = async () => {
      throw new ZaiCodingPlanOutputExhaustedError("simple-website-builder:page-home", 16_000, "length", { completion_tokens: 16_000 }, 68_000, 140_000);
    };
    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    const error = thrown as SimpleWebsiteBuilderError;
    expect(error.code).toBe("OUTPUT_EXHAUSTED");
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
  });
});

// ── §13-§17: provenance, cost, resume ────────────────────────────────────────

describe("provenance, cost telemetry and resume", () => {
  it("§13 records the reasoning-control setting and routed model in the frozen provenance", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-provenance.png");
    const seam = scriptedSixCallSeam({});
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.provenance?.reasoningControl).toBe("thinking.type=disabled");
    expect(BUILDER_REASONING_CONTROL).toBe("thinking.type=disabled");
    expect(result.provenance?.model).toBe("glm-5.3");
  });

  it("§14 the cost model prices GLM models from provider usage only", () => {
    expect(estimateBuilderCallCostUsd("glm-5.3", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(5.8, 6);
    expect(estimateBuilderCallCostUsd("glm-5.3-flash", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(5.8, 6);
    expect(estimateBuilderCallCostUsd("some-other-model", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeNull();
    expect(estimateBuilderCallCostUsd("glm-5.3", null)).toBeNull();
  });

  it("§16 §20 resume: pre-completed page artifacts are REUSED and the resumed CSS receives ALL FOUR page files (GO §26)", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-resume.png");
    const provenance = {
      promptId: "simple-website-builder",
      promptVersion: "v8",
      promptDomainContractVersion: "1",
      model: "glm-5.3",
      schemaVersion: "builder-file/page-home/1",
      attempt: 1,
      inputArtifactIds: [],
    };
    // A previous run completed all four pages, then died before the css call.
    for (const page of ["home", "about", "services", "contact"] as const) {
      await storeBuildStageArtifactIdempotent(env, {
        buildId: ctx.buildId,
        siteGenerationId: ctx.siteGenerationId,
        buildVersionId: ctx.buildVersionId,
        kind: `builder_file/page-${page}`,
        schemaVersion: `builder-file/page-${page}/1`,
        value: FULL_PAGE(page),
        provenance,
      });
    }

    const seenUsers: Record<string, string> = {};
    const seam = scriptedSixCallSeam({ onCall: (call, _s, user) => (seenUsers[call] = user) });
    const core = await runSimpleBuilderFileRealizationCore(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleBuilderFileRealizationCore>[1]);

    // exactly css + js were generated — all four pages reused
    expect(seam.calls).toEqual(["site-css", "site-js"]);
    for (const page of ["home", "about", "services", "contact"] as const) {
      expect(core.pages[page]).toBe(FULL_PAGE(page));
      const metrics = core.calls.find((c) => c.call === `page-${page}`)!;
      expect(metrics.reused).toBe(true);
      expect(metrics.durationMs).toBe(0);
      expect(metrics.outputTokens).toBeNull();
    }
    // the resumed CSS call still receives ALL FOUR final documents —
    // dependency semantics hold across resume
    expect(seenUsers["site-css"]).toContain(FULL_PAGE("home"));
    expect(seenUsers["site-css"]).toContain(FULL_PAGE("about"));
    expect(seenUsers["site-css"]).toContain(FULL_PAGE("services"));
    expect(seenUsers["site-css"]).toContain(FULL_PAGE("contact"));
    const cssMetrics = core.calls.find((c) => c.call === "site-css")!;
    expect(cssMetrics.reused).toBeFalsy();
    expect(cssMetrics.outputTokens).toBeGreaterThan(0);
    // the chrome was re-extracted from the REUSED home, so the inner-page
    // contract held without any page call
    expect(core.calls.find((c) => c.call === "site-js")!).toBeDefined();
  });

  it("§16b §20 resume continues at the first missing file in the new order", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-resume2.png");
    const provenance = {
      promptId: "simple-website-builder",
      promptVersion: "v8",
      promptDomainContractVersion: "1",
      model: "glm-5.3",
      schemaVersion: "builder-file/page-home/1",
      attempt: 1,
      inputArtifactIds: [],
    };
    // A previous run completed home + about, then died on services.
    for (const page of ["home", "about"] as const) {
      await storeBuildStageArtifactIdempotent(env, {
        buildId: ctx.buildId,
        siteGenerationId: ctx.siteGenerationId,
        buildVersionId: ctx.buildVersionId,
        kind: `builder_file/page-${page}`,
        schemaVersion: `builder-file/page-${page}/1`,
        value: FULL_PAGE(page),
        provenance,
      });
    }

    const seam = scriptedSixCallSeam({});
    const core = await runSimpleBuilderFileRealizationCore(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleBuilderFileRealizationCore>[1]);

    // services, contact, css and js generated; home and about reused
    expect(seam.calls).toEqual(["services", "contact", "site-css", "site-js"]);
    expect(core.pages.home).toBe(FULL_PAGE("home"));
    expect(core.pages.about).toBe(FULL_PAGE("about"));
    const aboutMetrics = core.calls.find((c) => c.call === "page-about")!;
    expect(aboutMetrics.reused).toBe(true);
    const servicesMetrics = core.calls.find((c) => c.call === "page-services")!;
    expect(servicesMetrics.reused).toBeFalsy();
    expect(servicesMetrics.outputTokens).toBeGreaterThan(0);
  });

  it("§17 the frozen site_bundle short-circuit still wins over per-file resume", async () => {
    const ctx = await scaffoldBuild("references/simple/dom-first-replay.png");
    const first = scriptedSixCallSeam({});
    const built = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), first.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const second = scriptedSixCallSeam({});
    const replay = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), second.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(second.calls).toEqual([]);
    expect(replay.artifactR2Key).toBe(built.artifactR2Key);
    expect(replay.bundle.pages.home).toBe(built.bundle.pages.home);
  });
});
