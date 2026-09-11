// SIX_CALL_FILE_REALIZATION Builder (operator GO 2026-09-11: WEBSITE BUILDER
// V7 — ONE SHARED BUILDER STAGE, FILE-SIZED REALIZATION CALLS), proven at the
// repository's seams:
//
//   §3-§5   raw file transport request shape: stream=false, NO response_format,
//           enable_thinking=false, max_completion_tokens (never max_tokens)
//   §6      the Builder routes to FULL GLM-5.3 (stage policy, never fallback)
//   §7-§9   output exhaustion classifies OUTPUT_EXHAUSTED and is NEVER retried
//   §10-§12 bounded transport policy: genuine faults retry, deterministic
//           request defects fail fast, empty content is never a result
//   §13-§17 stage discipline: exactly SIX calls in canonical order, each ONE
//           semantic generation; frozen outputs thread (css → pages → js);
//           prompt v7 carries the raw-output discipline; per-call runs and
//           artifacts persist
//   §18     deterministic fence tolerance is wired into the stage
//   §19-§20 SOURCE_INCOMPLETE fails closed (stub prose, malformed fence):
//           no repair call, nothing persisted, deterministic review
//   §21     OUTPUT_EXHAUSTED at the stage boundary fails closed deterministically
//   §22-§24 provenance (reasoning control, model echo via provider response),
//           per-call cost telemetry, deterministic strategy note
//   §25     workflow-retry safety: the frozen bundle IS the stage result

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
  runSimpleBuilderFileRealizationCore,
  runSimpleWebsiteBuilderStage,
  SimpleWebsiteBuilderError,
  WEBSITE_BUILDER_MODEL,
} from "../src/simple-design/website-builder";
import {
  generateWorkersAiFile,
  WorkersAiFileOutputExhaustedError,
  WorkersAiFileTransportError,
} from "../src/lib/workers-ai-file";
import { composeStagePrompt } from "../src/domain/prompt-contract";
import { classifyStageFailure } from "../src/domain/stage-failure";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
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

const FULL_PAGE = (pageId: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageId}</title><link rel="stylesheet" href="site.css"><script src="site.js" defer></script></head>
<body><header><nav aria-label="Primary"><a href="/about">About</a></nav></header>
<main><section class="hero ${pageId}-hero"><img src="IMG:${pageId}-hero" data-image-id="${pageId}-hero" alt="${pageId} hero"><h1>${pageId}</h1><p>${pageId} realized body copy of fixture length.</p></section></main>
<footer><p>Fin</p></footer></body></html>`;

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
        return { content: handlers.css ?? TOKENS_CSS, provider: "test", model: WEBSITE_BUILDER_MODEL, tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      const page = /Realize the "(home|about|services|contact)" page/.exec(user)?.[1];
      if (page) {
        calls.push(page);
        handlers.onCall?.(page, system, user);
        return { content: handlers.pages?.[page] ?? FULL_PAGE(page), provider: "test", model: WEBSITE_BUILDER_MODEL, tokenUsage: { prompt_tokens: 1000, completion_tokens: 500 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
      }
      if (user.includes("call 6 of 6")) {
        calls.push("site-js");
        handlers.onCall?.("site-js", system, user);
        return { content: handlers.js ?? CODE_JS, provider: "test", model: WEBSITE_BUILDER_MODEL, tokenUsage: { prompt_tokens: 1000, completion_tokens: 100 }, finishReason: "stop", reasoningControl: BUILDER_REASONING_CONTROL };
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

// ── §3-§6: the raw file transport ────────────────────────────────────────────

describe("raw file transport request shape (GO §5)", () => {
  it("§3 sends stream=false, NO response_format, enable_thinking=false, max_completion_tokens — never max_tokens", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const result = await generateWorkersAiFile({} as Env, {
      model: WEBSITE_BUILDER_MODEL,
      system: "SYSTEM PROMPT",
      user: "USER PROMPT",
      maxCompletionTokens: 1234,
      label: "shape-probe",
      run: async (model, body) => {
        expect(model).toBe("@cf/zai-org/glm-5.3");
        bodies.push(body as Record<string, unknown>);
        return { response: "body { margin: 0 }", model: "@cf/zai-org/glm-5.3", finish_reason: "stop", usage: { prompt_tokens: 10, completion_tokens: 5 } };
      },
    });
    const body = bodies[0] as {
      messages: Array<{ role: string; content: string }>;
      stream: unknown;
      max_completion_tokens: unknown;
      chat_template_kwargs: { enable_thinking: unknown };
      response_format?: unknown;
    };
    expect(body.stream).toBe(false);
    expect(body.max_completion_tokens).toBe(1234);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect(body.response_format).toBeUndefined();
    expect(body.messages.map((m) => [m.role, m.content])).toEqual([["system", "SYSTEM PROMPT"], ["user", "USER PROMPT"]]);
    expect("max_tokens" in body).toBe(false);
    // result normalization
    expect(result.content).toBe("body { margin: 0 }");
    expect(result.provider).toBe("workers-ai");
    expect(result.model).toBe(WEBSITE_BUILDER_MODEL);
    expect(result.providerModel).toBe("@cf/zai-org/glm-5.3");
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(result.contentChars).toBe("body { margin: 0 }".length);
  });

  it("§4 the Builder budgets are per-file constants in the canonical call order", () => {
    expect(BUILDER_FILE_CALL_ORDER).toEqual(["site-css", "page-home", "page-about", "page-services", "page-contact", "site-js"]);
    expect(BUILDER_CSS_MAX_COMPLETION_TOKENS).toBe(18_000);
    expect(BUILDER_PAGE_MAX_COMPLETION_TOKENS).toBe(16_000);
    expect(BUILDER_JS_MAX_COMPLETION_TOKENS).toBe(6_000);
  });

  it("§6 the Builder routes to FULL GLM-5.3 — an explicit stage constant, never a fallback chain", () => {
    expect(WEBSITE_BUILDER_MODEL).toBe("@cf/zai-org/glm-5.3");
  });
});

// ── §7-§9: output exhaustion ─────────────────────────────────────────────────

describe("output exhaustion fails closed and is never retried (GO §5)", () => {
  it("§7 finish_reason=length classifies OUTPUT_EXHAUSTED on the FIRST attempt", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateWorkersAiFile({} as Env, {
        model: WEBSITE_BUILDER_MODEL,
        system: "s",
        user: "u",
        maxCompletionTokens: 100,
        label: "exhaust-probe",
        run: async () => {
          calls += 1;
          return { response: "partial source", finish_reason: "length", usage: { completion_tokens: 100 } };
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkersAiFileOutputExhaustedError);
    expect(calls).toBe(1);
  });

  it("§8 the completion-token ceiling is the equivalent exhaustion signal when finish_reason is absent", async () => {
    let thrown: unknown;
    try {
      await generateWorkersAiFile({} as Env, {
        model: WEBSITE_BUILDER_MODEL,
        system: "s",
        user: "u",
        maxCompletionTokens: 50,
        label: "ceiling-probe",
        run: async () => ({ response: "x".repeat(80), usage: { completion_tokens: 50 } }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkersAiFileOutputExhaustedError);
  });

  it("§9 a healthy stop result carries the complete payload", async () => {
    const result = await generateWorkersAiFile({} as Env, {
      model: WEBSITE_BUILDER_MODEL,
      system: "s",
      user: "u",
      maxCompletionTokens: 100,
      label: "stop-probe",
      run: async () => ({ response: "done", finish_reason: "stop", usage: { completion_tokens: 7 } }),
    });
    expect(result.finishReason).toBe("stop");
    expect(result.content).toBe("done");
  });
});

// ── §10-§12: bounded transport policy ────────────────────────────────────────

describe("bounded transport policy (transient retries, deterministic fail-fast)", () => {
  it("§10 retries a genuine network fault and succeeds within the bound", async () => {
    let calls = 0;
    const result = await generateWorkersAiFile({} as Env, {
      model: WEBSITE_BUILDER_MODEL,
      system: "s",
      user: "u",
      maxCompletionTokens: 100,
      label: "retry-probe",
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        return { response: "ok", finish_reason: "stop" };
      },
    });
    expect(result.content).toBe("ok");
    expect(calls).toBe(2);
  });

  it("§11 a deterministic request defect fails fast — ONE attempt", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateWorkersAiFile({} as Env, {
        model: WEBSITE_BUILDER_MODEL,
        system: "s",
        user: "u",
        maxCompletionTokens: 100,
        label: "defect-probe",
        run: async () => {
          calls += 1;
          throw new Error("unsupported parameter: chat_template_kwargs");
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkersAiFileTransportError);
    expect(calls).toBe(1);
  });

  it("§12 empty non-streaming content is a malformed transport attempt, not a result", async () => {
    let calls = 0;
    let thrown: unknown;
    try {
      await generateWorkersAiFile({} as Env, {
        model: WEBSITE_BUILDER_MODEL,
        system: "s",
        user: "u",
        maxCompletionTokens: 100,
        label: "empty-probe",
        run: async () => {
          calls += 1;
          return { response: "", finish_reason: "stop" };
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkersAiFileTransportError);
    expect(calls).toBe(3);
  });
});

// ── §13-§25: the ONE Builder stage, six file-sized calls ─────────────────────

describe("stage discipline: SIX calls, one semantic generation each (GO §2)", () => {
  it("§13 the prompt contract is v7 and carries the raw-output discipline", () => {
    const composed = composeStagePrompt("simple-website-builder");
    expect(composed.promptVersion).toBe("v7");
    expect(composed.systemPrompt).toContain("RAW source");
    expect(composed.systemPrompt).toContain("no Markdown fences");
  });

  it("§14 exactly six calls in canonical order; frozen outputs thread css → pages → js", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-order.png");
    const seenUsers: Record<string, string> = {};
    const seam = scriptedSixCallSeam({ onCall: (call, _s, user) => (seenUsers[call] = user) });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    expect(seam.calls).toEqual(["site-css", "home", "about", "services", "contact", "site-js"]);
    expect(result.strategy).toBe("SIX_CALL_FILE_REALIZATION");
    // every call shares the frozen context and the output-mode discipline
    for (const call of seam.calls) {
      expect(seenUsers[call]).toContain("DESIGN BLUEPRINT (design authority");
      expect(seenUsers[call]).toContain("MANDATORY CRITICAL IMAGE PLACEMENTS");
      expect(seenUsers[call]).toContain("No Markdown fences");
      expect(seenUsers[call]).toContain("Return ONLY the complete contents");
    }
    // page calls realize on the FROZEN stylesheet
    expect(seenUsers.home).toContain("FROZEN site.css");
    expect(seenUsers.home).toContain("var(--accent)");
    expect(seenUsers.contact).toContain("FROZEN site.css");
    // the js call binds to the frozen markup
    expect(seenUsers["site-js"]).toContain("FROZEN site.css");
    expect(seenUsers["site-js"]).toContain("FROZEN home.html");
    expect(seenUsers["site-js"]).toContain("FROZEN contact.html");
    // each page call carries only ITS mandatory CRITICAL slice
    expect(seenUsers.about).toContain("THIS PAGE'S MANDATORY CRITICAL IMAGES");
    expect(seenUsers.about).toContain("- about-hero");
    expect(seenUsers.about).not.toContain("- home-hero —");
    // per-call task numbering
    expect(seenUsers["site-css"]).toContain("call 1 of 6");
    expect(seenUsers.contact).toContain("call 5 of 6");
    expect(seenUsers["site-js"]).toContain("call 6 of 6");
  });

  it("§15 the assembled bundle passes SiteBundleSchema and persists under the deterministic strategy note", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-persist.png");
    const seam = scriptedSixCallSeam({});
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const bundle: SiteBundle = result.bundle;
    expect(bundle.version).toBe("1");
    expect(Object.keys(bundle.pages).sort()).toEqual(["about", "contact", "home", "services"]);
    expect(bundle.sharedCss).toBe(TOKENS_CSS);
    expect(bundle.sharedJs).toBe(CODE_JS);
    expect(bundle.notes).toBe(BUILDER_STRATEGY_NOTE);
    expect(BUILDER_STRATEGY_NOTE).toContain("simple-website-builder/v7");
    expect(BUILDER_STRATEGY_NOTE).toContain("@cf/zai-org/glm-5.3");
    expect(BUILDER_STRATEGY_NOTE).toContain("SIX_CALL_FILE_REALIZATION");

    const stored = await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle");
    expect(stored?.value.pages.home).toBe(bundle.pages.home);
  });

  it("§16 every call persists its own ai_stage_runs row and immutable run artifact", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-runs.png");
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
      expect(row.model).toBe(WEBSITE_BUILDER_MODEL);
    }
  });

  it("§17 the core reports per-call metrics: routed model, finish reason, tokens, estimated cost", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-metrics.png");
    const seam = scriptedSixCallSeam({});
    const core = await runSimpleBuilderFileRealizationCore(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleBuilderFileRealizationCore>[1]);

    expect(core.calls.map((c) => c.call)).toEqual(BUILDER_FILE_CALL_ORDER);
    for (const call of core.calls) {
      expect(call.model).toBe(WEBSITE_BUILDER_MODEL);
      expect(call.finishReason).toBe("stop");
      expect(call.inputTokens).toBe(1000);
      expect(call.outputTokens).toBeGreaterThan(0);
      expect(call.estimatedCostUsd).toBeGreaterThan(0);
      expect(call.outputChars).toBeGreaterThan(0);
    }
    expect(core.css).toBe(TOKENS_CSS);
    expect(core.js).toBe(CODE_JS);
    expect(Object.keys(core.pages).sort()).toEqual(["about", "contact", "home", "services"]);
  });

  it("§18 a fenced site.css realization is deterministically stripped exactly once", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-fence.png");
    const seam = scriptedSixCallSeam({ css: "```css\n" + TOKENS_CSS + "\n```" });
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.bundle.sharedCss).toBe(TOKENS_CSS);
  });
});

describe("SOURCE_INCOMPLETE fails closed after the ONE semantic generation (GO §6)", () => {
  it("§19 a meta-stub page never persists: no repair call, deterministic review", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-stub.png");
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

    // css + home only — the failing call got exactly ONE semantic generation
    expect(seam.calls).toEqual(["site-css", "home"]);
    // nothing frozen, and the invalid run persisted no artifact
    expect(await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle")).toBeNull();
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("§20 a malformed fence frame is refused deterministically", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-frame.png");
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
});

describe("OUTPUT_EXHAUSTED at the stage boundary (GO §5)", () => {
  it("§21 fails closed deterministically — never retried, never budget-raised", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-exhaust.png");
    const generate = async () => {
      throw new WorkersAiFileOutputExhaustedError("simple-website-builder:site-css", 18_000, "length", { completion_tokens: 18_000 }, 50_000, 9000);
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

describe("provenance, cost telemetry and workflow-retry safety", () => {
  it("§22 records the reasoning-control setting and routed model in the frozen provenance", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-provenance.png");
    const seam = scriptedSixCallSeam({});
    const result = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), seam.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(result.provenance?.reasoningControl).toBe("chat_template_kwargs.enable_thinking=false");
    expect(BUILDER_REASONING_CONTROL).toBe("chat_template_kwargs.enable_thinking=false");
    expect(result.provenance?.model).toBe(WEBSITE_BUILDER_MODEL);
    const row = await env.DB.prepare(
      "SELECT token_usage_json FROM ai_stage_runs WHERE build_version_id = ? AND schema_version = 'builder-file/site-js/1'"
    )
      .bind(ctx.buildVersionId)
      .first<{ token_usage_json: string }>();
    expect(JSON.parse(row!.token_usage_json)).toEqual({ prompt_tokens: 1000, completion_tokens: 100 });
  });

  it("§23 the cost model prices only the routed Builder model from provider usage", () => {
    expect(estimateBuilderCallCostUsd(WEBSITE_BUILDER_MODEL, { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeCloseTo(5.8, 6);
    expect(estimateBuilderCallCostUsd("@cf/zai-org/glm-5.3-flash", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })).toBeNull();
    expect(estimateBuilderCallCostUsd(WEBSITE_BUILDER_MODEL, null)).toBeNull();
  });

  it("§25 workflow-retry safety: an existing frozen bundle is returned without any new model call", async () => {
    const ctx = await scaffoldBuild("references/simple/file-realization-replay.png");
    const first = scriptedSixCallSeam({});
    const built = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), first.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);

    const second = scriptedSixCallSeam({});
    const replay = await runSimpleWebsiteBuilderStage(env, stageInput(ctx, blueprint(), second.generate) as Parameters<typeof runSimpleWebsiteBuilderStage>[1]);
    expect(second.calls).toEqual([]);
    expect(replay.artifactR2Key).toBe(built.artifactR2Key);
    expect(replay.bundle.pages.home).toBe(built.bundle.pages.home);
    expect(replay.strategy).toBe("SIX_CALL_FILE_REALIZATION");
  });
});
