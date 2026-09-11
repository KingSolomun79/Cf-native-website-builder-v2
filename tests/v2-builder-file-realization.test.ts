// SIX_CALL_FILE_REALIZATION Builder on the Z.AI Coding Plan (operator GO
// 2026-09-11: ZAI CODING PLAN UNIFICATION), proven at the repository's seams:
//
//   §1-§2   the Builder routes to Coding Plan glm-5.3 (never fallback), and
//           the per-file budgets stay in place
//   §3-§7   stage discipline: exactly SIX calls in canonical order, one
//           semantic generation each; prompt v7 raw-output discipline; frozen
//           outputs thread css → home(chrome) → pages → js; per-call runs,
//           artifacts and per-file resume artifacts persist
//   §8      §18 frozen shared chrome: home defines it; the remaining pages
//           receive it in the prompt and MUST reproduce it exactly — a
//           mismatch fails closed (SOURCE_INCOMPLETE)
//   §9      a fenced site.css realization is deterministically stripped once
//   §10-§11 SOURCE_INCOMPLETE fails closed after the ONE semantic generation
//   §12     OUTPUT_EXHAUSTED fails closed deterministically
//   §13-§15 provenance (reasoning control), cost telemetry, strategy note
//   §16-§17 §20 resume: completed per-file artifacts are REUSED (no model
//           call, reused metrics) and the stage continues at the first
//           missing file; the frozen bundle short-circuit still wins

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
  estimateBuilderCallCostUsd,
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

const HEADER = `<header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>`;
const FOOTER = `<footer><p>© 2026 RankForge Kenya</p></footer>`;

const FULL_PAGE = (pageId: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageId}</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body>${HEADER}
<main><section class="hero ${pageId}-hero"><img src="IMG:${pageId}-hero" data-image-id="${pageId}-hero" alt="${pageId} hero"><h1>${pageId}</h1><p>${pageId} realized body copy of fixture length.</p></section></main>
${FOOTER}</body></html>`;

const TOKENS_CSS = `:root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }
.hero { min-height: 60vh; display: grid; place-items: center; }
.site-nav { display: flex; gap: 1.5rem; }
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
      if (user.includes("call 1 of 6")) {
        calls.push("site-css");
        handlers.onCall?.("site-css", system, user);
        return { content: handlers.css ?? TOKENS_CSS, provider: "test", model: "glm-5.3", tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      const page = /Realize the "(home|about|services|contact)" page/.exec(user)?.[1];
      if (page) {
        calls.push(page);
        handlers.onCall?.(page, system, user);
        return { content: handlers.pages?.[page] ?? FULL_PAGE(page), provider: "test", model: "glm-5.3", tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
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

  it("§2 the per-file budgets and the canonical call order hold", () => {
    expect(BUILDER_FILE_CALL_ORDER).toEqual(["site-css", "page-home", "page-about", "page-services", "page-contact", "site-js"]);
    expect(BUILDER_CSS_MAX_COMPLETION_TOKENS).toBe(18_000);
    expect(BUILDER_PAGE_MAX_COMPLETION_TOKENS).toBe(16_000);
    expect(BUILDER_JS_MAX_COMPLETION_TOKENS).toBe(6_000);
  });
});

// ── §3-§7: stage discipline ──────────────────────────────────────────────────

describe("stage discipline: SIX calls, one semantic generation each (GO §10)", () => {
  it("§3 the prompt contract is v7 and carries the raw-output discipline", () => {
    const composed = composeStagePrompt("simple-website-builder");
    expect(composed.promptVersion).toBe("v7");
    expect(composed.systemPrompt).toContain("RAW source");
    expect(composed.systemPrompt).toContain("no Markdown fences");
  });

  it("§4 exactly six calls in canonical order; frozen outputs thread css → home(chrome) → pages → js", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-order.png");
    const seenUsers: Record<string, string> = {};
    const seam = scriptedSixCallSeam({ onCall: (call, _s, user) => (seenUsers[call] = user) });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    expect(seam.calls).toEqual(["site-css", "home", "about", "services", "contact", "site-js"]);
    expect(result.strategy).toBe("SIX_CALL_FILE_REALIZATION");
    for (const call of seam.calls) {
      expect(seenUsers[call]).toContain("DESIGN BLUEPRINT (design authority");
      expect(seenUsers[call]).toContain("MANDATORY CRITICAL IMAGE PLACEMENTS");
      expect(seenUsers[call]).toContain("No Markdown fences");
      expect(seenUsers[call]).toContain("Return ONLY the complete contents");
    }
    expect(seenUsers.home).toContain("FROZEN site.css");
    // home DEFINES the chrome; the remaining pages receive it frozen
    expect(seenUsers.home).not.toContain("FROZEN SHARED CHROME");
    for (const page of ["about", "services", "contact"]) {
      expect(seenUsers[page]).toContain("FROZEN SHARED CHROME");
      expect(seenUsers[page]).toContain(HEADER);
    }
    expect(seenUsers.about).toContain("THIS PAGE'S MANDATORY CRITICAL IMAGES");
    expect(seenUsers.about).toContain("- about-hero");
    expect(seenUsers["site-js"]).toContain("FROZEN home.html");
    expect(seenUsers["site-js"]).toContain("call 6 of 6");
  });

  it("§5 the assembled bundle passes SiteBundleSchema and persists under the deterministic strategy note", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-persist.png");
    const seam = scriptedSixCallSeam({});
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const bundle: SiteBundle = result.bundle;
    expect(Object.keys(bundle.pages).sort()).toEqual(["about", "contact", "home", "services"]);
    expect(bundle.notes).toBe(BUILDER_STRATEGY_NOTE);
    expect(BUILDER_STRATEGY_NOTE).toContain("glm-5.3 on the Z.AI Coding Plan");
    expect(BUILDER_STRATEGY_NOTE).toContain("SIX_CALL_FILE_REALIZATION");
    expect(BUILDER_STRATEGY_NOTE).toContain("shared chrome");
  });

  it("§6 every call persists its own ai_stage_runs row AND its per-file resume artifact (GO §20)", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-runs.png");
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
    for (const kind of ["builder_file/site-css", "builder_file/page-home", "builder_file/page-about", "builder_file/page-services", "builder_file/page-contact", "builder_file/site-js"]) {
      const stored = await getBuildStageArtifact<string>(env, ctx.buildVersionId, kind as `builder_file/${string}`);
      expect(stored, kind).not.toBeNull();
    }
  });

  it("§7 the core reports per-call metrics: routed model, finish reason, tokens, estimated cost", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-metrics.png");
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
    const ctx = await scaffoldBuild("references/simple/coding-plan-fence.png");
    const seam = scriptedSixCallSeam({ css: "```css\n" + TOKENS_CSS + "\n```" });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.bundle.sharedCss).toBe(TOKENS_CSS);
  });
});

// ── §8: frozen shared chrome ─────────────────────────────────────────────────

describe("frozen shared chrome (GO §18)", () => {
  it("§8a a page that restyles the shared chrome FAILS CLOSED before the js call", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-chrome.png");
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
    // css + 4 pages ran; the js call never happened (fail closed before it)
    expect(seam.calls).toEqual(["site-css", "home", "about", "services", "contact"]);
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });
});

// ── §10-§12: fail-closed paths ───────────────────────────────────────────────

describe("SOURCE_INCOMPLETE and OUTPUT_EXHAUSTED fail closed", () => {
  it("§10 a meta-stub page never persists: no repair call, deterministic review", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-stub.png");
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
    expect(seam.calls).toEqual(["site-css", "home"]);
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("§11 a malformed fence frame is refused deterministically", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-frame.png");
    const seam = scriptedSixCallSeam({ pages: { about: "```html\n<!DOCTYPE html><html><body>never closed" } });
    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    expect((thrown as SimpleWebsiteBuilderError).code).toBe("SOURCE_INCOMPLETE");
    expect(seam.calls).toEqual(["site-css", "home", "about"]);
  });

  it("§12 OUTPUT_EXHAUSTED at the stage boundary fails closed deterministically", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-exhaust.png");
    const generate = async () => {
      throw new ZaiCodingPlanOutputExhaustedError("simple-website-builder:site-css", 18_000, "length", { completion_tokens: 18_000 }, 72_780, 141_000);
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
    const ctx = await scaffoldBuild("references/simple/coding-plan-provenance.png");
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

  it("§16 §20 resume: pre-completed per-file artifacts are REUSED — no model call, reused metrics — and the stage continues at the first missing file", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-resume.png");
    const provenance = {
      promptId: "simple-website-builder",
      promptVersion: "v7",
      promptDomainContractVersion: "1",
      model: "glm-5.3",
      schemaVersion: "builder-file/site-css/1",
      attempt: 1,
      inputArtifactIds: [],
    };
    // A previous run completed css + home, then died on about.
    await storeBuildStageArtifactIdempotent(env, {
      buildId: ctx.buildId,
      siteGenerationId: ctx.siteGenerationId,
      buildVersionId: ctx.buildVersionId,
      kind: "builder_file/site-css",
      schemaVersion: "builder-file/site-css/1",
      value: TOKENS_CSS,
      provenance,
    });
    await storeBuildStageArtifactIdempotent(env, {
      buildId: ctx.buildId,
      siteGenerationId: ctx.siteGenerationId,
      buildVersionId: ctx.buildVersionId,
      kind: "builder_file/page-home",
      schemaVersion: "builder-file/page-home/1",
      value: FULL_PAGE("home"),
      provenance,
    });

    const seam = scriptedSixCallSeam({});
    const core = await runSimpleBuilderFileRealizationCore(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleBuilderFileRealizationCore>[1]);

    // exactly the four MISSING files were generated — css and home reused
    expect(seam.calls).toEqual(["about", "services", "contact", "site-js"]);
    expect(core.css).toBe(TOKENS_CSS);
    expect(core.pages.home).toBe(FULL_PAGE("home"));
    const cssMetrics = core.calls.find((c) => c.call === "site-css")!;
    expect(cssMetrics.reused).toBe(true);
    expect(cssMetrics.durationMs).toBe(0);
    expect(cssMetrics.outputTokens).toBeNull();
    const aboutMetrics = core.calls.find((c) => c.call === "page-about")!;
    expect(aboutMetrics.reused).toBeFalsy();
    expect(aboutMetrics.outputTokens).toBeGreaterThan(0);
  });

  it("§17 the frozen site_bundle short-circuit still wins over per-file resume", async () => {
    const ctx = await scaffoldBuild("references/simple/coding-plan-replay.png");
    const first = scriptedSixCallSeam({});
    const built = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), first.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const second = scriptedSixCallSeam({});
    const replay = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), second.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(second.calls).toEqual([]);
    expect(replay.artifactR2Key).toBe(built.artifactR2Key);
    expect(replay.bundle.pages.home).toBe(built.bundle.pages.home);
  });
});
