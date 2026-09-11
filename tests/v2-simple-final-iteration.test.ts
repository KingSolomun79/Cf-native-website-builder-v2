// FINAL SIMPLE ITERATION (operator GO, 2026-09-09): regression proofs for the
// five scoped changes before the final decision benchmark —
//   #1  screen-free KIE scene adaptation at the request boundary (+ hashes)
//   #2  SIMPLE repair transport pinned to the Z.AI Coding Plan (no legacy
//       gateway fallback, even when a preflight-rejected candidate has no
//       renders)
//   #3  changed-files repair receives the full bundle + blueprint + exact
//       deterministic findings (preflight mode, no screenshots needed)
//   #4  builder progressive-enhancement instruction strengthened
//   #5  trust lint: CTA/navigation/action labels are never trust entities
//       (semantic roles, no exact-string whitelist)

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { Value } from "@sinclair/typebox/value";
import {
  adaptImageSceneToScreenFree,
  buildScreenSafePhotoPrompt,
  KIE_MAX_PROMPT_CHARS,
  SCREEN_FREE_PHOTO_REQUIREMENT,
  TEXT_SAFE_PHOTO_NEGATIVE,
} from "../src/lib/kie-v2";
import { sha256Hex } from "../src/lib/crypto";
import {
  failedFilesFromQaPackage,
  buildRepairUserPrompt,
  RepairedFilesSchema,
  runSimpleSiteRepairStage,
} from "../src/simple-design/site-repair";
import { runSimpleWebsiteBuilderStage } from "../src/simple-design/website-builder";
import { lintTrustContexts, factVocabulary } from "../src/domain/fact-lint";
import { validateDesignBlueprintV2,
  materializeAcceptedImageDescriptors, type QaPackage, type SiteBundle } from "../src/simple-design/contracts";
import { FINCH_V2_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch-v2";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";

const env = providedEnv as unknown as Env;

// ── shared fixtures ──────────────────────────────────────────────────────────

const blueprint = validateDesignBlueprintV2(FINCH_V2_KNOWN_GOOD_BLUEPRINT);
if (!blueprint.valid) throw new Error("Finch v2 fixture must validate");
const bp = blueprint.value;

const endpoint = "https://test.example.com/api/v2/forms/submit";
const siteFormId = "site:abc123";

const FACTS = {
  businessName: "RankForge Kenya",
  contactEmail: "ops@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
};

// The SIX frozen RankForge slot briefs (benchmark artifact d8fac165 /
// dabc524) verbatim — every one of them asks z-image for screens, which is
// exactly the pseudo-text failure the screen-free adaptation must rewrite.
const FROZEN_RANKFORGE_BRIEFS: Array<{ id: string; brief: string; staging: string }> = [
  {
    id: "hero-team-collab",
    brief:
      "Wide cinematic photo of a diverse digital agency team of four working together around laptops at a wooden table in a warm loft-style office, large windows casting soft evening light, deep purple ambient glow from screens and violet gradient wash over the scene, candid focused expressions, shallow depth of field, professional photography, no readable text or logos anywhere",
    staging: "only lids and backs visible",
  },
  {
    id: "about-strategist",
    brief:
      "Young professional woman SEO strategist with curly hair reviewing analytics on a laptop beside a potted monstera plant in a bright modern office, soft natural window light, warm neutral tones with a purple jumper, thoughtful candid expression, shallow depth of field, professional photography, no readable text or logos on screen",
    staging: "closed or rear-facing laptop",
  },
  {
    id: "results-celebration",
    brief:
      "Two colleagues in a dim modern office celebrating in front of a laptop showing rising graphs, genuine laughter, one raising a fist, purple and warm screen glow on faces, shallow depth of field, cinematic professional photography, no readable text or logos",
    staging: "no monitor, dashboard or visible screen in frame",
  },
  {
    id: "testimonial-office",
    brief:
      "Over-the-shoulder photo of a client and consultant shaking hands across a desk with laptops in a dim modern office, warm and purple mixed lighting, faces softly out of focus, professional documentary style photography, no readable text or logos",
    staging: "closed laptops",
  },
  {
    id: "newsletter-owner",
    brief:
      "Small business owner in a workshop office reviewing rankings on a tablet in the evening, screen glow lighting their face, purple and warm ambient tones, candid concentration, shallow depth of field, professional photography, no readable text or logos",
    staging: "paper notebook",
  },
  {
    id: "contact-presentation",
    brief:
      "Marketing consultant presenting a growth strategy on a large screen to a small business audience in a dark meeting room, gesturing toward abstract colorful charts, purple accent lighting, engaged listeners in soft focus foreground, cinematic professional photography, no readable text or logos",
    staging: "no presentation screen or signage",
  },
];

// ── #1: screen-free scene adaptation at the KIE request boundary ─────────────

describe("screen-free KIE scene adaptation (#1)", () => {
  it("rewrites every frozen RankForge brief screen-free while keeping the scene's purpose", () => {
    for (const slot of FROZEN_RANKFORGE_BRIEFS) {
      const adapted = adaptImageSceneToScreenFree(slot.brief);
      expect(adapted.adapted, slot.id).toBe(true);
      expect(adapted.matchedTerms.length, slot.id).toBeGreaterThan(0);
      expect(adapted.effectiveBrief, slot.id).toContain(slot.staging);
      // no screen-bearing object faces the camera anymore
      expect(adapted.effectiveBrief, slot.id).not.toMatch(/(?<!rear-)(?:in front of|facing) (?:a |the |their )?(?:laptop|monitor|screen|display|television)/);
      expect(adapted.effectiveBrief, slot.id).not.toMatch(/(?:reviewing|presenting) [a-z ]+ on (?:a |the )?(?:laptop|tablet|screen)/);
      // the human moment survives (collaboration / analysis / celebration / consulting / presentation)
      expect(`${slot.brief} ${adapted.effectiveBrief}`, slot.id).toMatch(/celebrating|team|strategist|owner|consultant|client/);
    }
  });

  it("leaves a brief without screen terms unadapted but still clause-protected", () => {
    const brief = "Portrait of the founder smiling in her workshop, warm evening light, shallow depth of field, professional photography.";
    const adapted = adaptImageSceneToScreenFree(brief);
    expect(adapted.adapted).toBe(false);
    expect(adapted.matchedTerms).toEqual([]);
    expect(adapted.effectiveBrief).toBe(brief);
  });

  it("assembles a provider prompt within the cap, clause first, negative last, with provenance fields", () => {
    for (const slot of FROZEN_RANKFORGE_BRIEFS) {
      const built = buildScreenSafePhotoPrompt(slot.brief, "16:9");
      expect(built.prompt.length, slot.id).toBeLessThanOrEqual(KIE_MAX_PROMPT_CHARS);
      expect(built.prompt, slot.id).toContain(SCREEN_FREE_PHOTO_REQUIREMENT);
      expect(built.prompt.indexOf(SCREEN_FREE_PHOTO_REQUIREMENT), slot.id).toBeLessThan(built.prompt.indexOf(slot.staging));
      expect(built.prompt.trim().endsWith(TEXT_SAFE_PHOTO_NEGATIVE + "."), slot.id).toBe(true);
      expect(built.screenSafeAdaptationApplied, slot.id).toBe(true);
      expect(built.blueprintPrompt, slot.id).toBe(slot.brief);
    }
  });

  it("hashes blueprint and effective prompts distinctly (provenance triple)", async () => {
    const slot = FROZEN_RANKFORGE_BRIEFS[1];
    const built = buildScreenSafePhotoPrompt(slot.brief, "16:9");
    const blueprintPromptHash = await sha256Hex(built.blueprintPrompt);
    const effectivePromptHash = await sha256Hex(built.prompt);
    expect(blueprintPromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effectivePromptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(effectivePromptHash).not.toEqual(blueprintPromptHash);
    // deterministic
    const again = buildScreenSafePhotoPrompt(slot.brief, "16:9");
    expect(await sha256Hex(again.prompt)).toEqual(effectivePromptHash);
  });
});

// ── #2 + #3: repair transport pinned + preflight-mode repair context ─────────

const preflightQaPackage: QaPackage = {
  version: "1",
  buildVersionNumber: 1,
  visual: null,
  truth: { findings: [], blockerCount: 0 },
  technical: {
    findings: [
      { id: "MALFORMED_HTML", severity: "blocker", detail: "home: <div> opened 89x, closed 88x" },
      { id: "CONTENT_HIDDEN_WITHOUT_JS", severity: "blocker", detail: "site.css hides content by default: .reveal { opacity: 0 }" },
    ],
    blockerCount: 2,
  },
  releaseReady: false,
  reasons: ["technical blockers present"],
  referenceScreenshotKeys: { desktop: "references/simple/ref.png" },
  candidateScreenshotKeys: { desktop: "" },
};

const repairBundle = (): SiteBundle => ({
  version: "1",
  pages: {
    home: "<!DOCTYPE html><html lang=\"en\"><head><title>Home</title></head><body><main><h1>Home</h1></main></body></html>",
    about: "<!DOCTYPE html><html lang=\"en\"><head><title>About</title></head><body><main><h1>About</h1></main></body></html>",
    services: "<!DOCTYPE html><html lang=\"en\"><head><title>Services</title></head><body><main><h1>Services</h1></main></body></html>",
    contact: "<!DOCTYPE html><html lang=\"en\"><head><title>Contact</title></head><body><main><h1>Contact</h1></main></body></html>",
  },
  sharedCss: ":root { --accent: #7c3aed; } .hero { min-height: 60vh; }",
  sharedJs: "document.body.classList.add('ready');",
});

function workersAiBinding(calls: Array<{ model: string; options: Record<string, unknown> }>) {
  return {
    run: async (model: string, options: Record<string, unknown>) => {
      calls.push({ model, options });
      const payload = JSON.stringify({
        files: [{ path: "site.css", content: "/* repaired css */ :root { --accent: #7c3aed; } .hero { min-height: 55vh; }" }],
      });
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: payload.slice(0, 50) })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: payload.slice(50) })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
    },
  };
}

async function scaffoldBuild(): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: FACTS,
      reference: { screenshotR2Key: "references/simple/final-iteration.png" },
    },
  });
  const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  const version = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
    .bind(build.buildId)
    .first<{ id: string }>();
  if (!version) throw new Error("no initial version");
  return { siteGenerationId: started.siteGenerationId, buildId: build.buildId, buildVersionId: version.id };
}

describe("SIMPLE repair transport pin (#2)", () => {
  it("a preflight-rejected candidate (no renders) repairs on the Z.AI Coding Plan — glm-5.3, streaming, thinking disabled; no Workers AI binding, no legacy gateway", async () => {
    const ctx = await scaffoldBuild();
    const repairPayload = JSON.stringify({
      files: [{ path: "site.css", content: "/* repaired css */ :root { --accent: #7c3aed; } .hero { min-height: 55vh; }" }],
    });
    const fetchCalls: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      fetchCalls.push(url);
      if (url.includes("/chat/completions")) {
        const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
        bodies.push(body);
        const encoder = new TextEncoder();
        const half = Math.ceil(repairPayload.length / 2);
        const sse =
          `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "analysis..." } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: { content: repairPayload.slice(0, half) } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: { content: repairPayload.slice(half) } }] })}\n\n` +
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
          "data: [DONE]\n\n";
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sse));
            controller.close();
          },
        }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    // The repair runs on the Coding Plan provider with a stubbed fetch; the
    // key value itself is irrelevant, its PRESENCE is configuration.
    const repairEnv = { ...env, ZAI_CODING_API_KEY: "test-cp-key" } as unknown as Env;
    let result;
    try {
      result = await runSimpleSiteRepairStage(repairEnv, {
        siteGenerationId: ctx.siteGenerationId,
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: 1,
        bundle: repairBundle(),
        blueprint: bp,
        facts: FACTS,
        qaPackage: preflightQaPackage,
        acceptedImages: [],
        formServiceEndpoint: endpoint,
        siteFormId,
        // the frozen reference evidence is always present (only the CANDIDATE
        // renders are absent in preflight-failure mode)
        referenceVisualInputs: [
          { kind: "full-page", artifact: "references/simple/ref.png", sha256: "frozen-ref-sha", width: 1440, height: 3200 },
        ],
        // NO candidateDesktopR2Key / candidateMobileR2Key — exactly the
        // Phase 4 shape that used to fall through to the legacy gateway.
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Coding Plan transport: coding endpoint, glm-5.3, stream = true,
    // thinking disabled; reasoning_content was sent but never entered source
    expect(bodies.length).toBe(1);
    expect(bodies[0].model).toBe("glm-5.3");
    expect(bodies[0].stream).toBe(true);
    expect(bodies[0].thinking).toEqual({ type: "disabled" });

    // no Workers AI binding call, no legacy gateway / openrouter / general API
    const legacy = fetchCalls.filter((url) => !url.includes("/chat/completions"));
    expect(legacy).toEqual([]);

    // the deterministic merge produced the repaired Build Version bundle
    expect(result.changedPaths).toEqual(["site.css"]);
    expect(result.bundle.sharedCss).toContain("repaired css");
    expect(result.bundle.pages.home).toBe(repairBundle().pages.home);
    expect(result.provenance?.model).toBe("glm-5.3");
  });

  it("the changed-files output schema accepts only the six bundle files", () => {
    const valid = { files: [{ path: "site.css", content: "x" }, { path: "index.html", content: "<!DOCTYPE html>" }] };
    expect(Value.Check(RepairedFilesSchema, valid)).toBe(true);
    const invalid = { files: [{ path: "assets/hero.webp", content: "x" }] };
    expect(Value.Check(RepairedFilesSchema, invalid)).toBe(false);
  });
});

describe("preflight-mode repair context (#3)", () => {
  it("failed files derive from page-prefixed and shared-file deterministic findings", () => {
    expect(failedFilesFromQaPackage(preflightQaPackage)).toEqual(["index.html", "site.css"]);
    const mixed: QaPackage = {
      ...preflightQaPackage,
      technical: {
        findings: [
          { id: "MISSING_H1", severity: "blocker", detail: "about: no H1" },
          { id: "FORM_CONTRACT_FAILURE", severity: "blocker", detail: "contact form does not post to the central Form Service contract" },
        ],
        blockerCount: 2,
      },
    };
    expect(failedFilesFromQaPackage(mixed)).toEqual(["about.html", "contact.html"]);
    const unattributable: QaPackage = {
      ...preflightQaPackage,
      technical: {
        findings: [{ id: "SOME_NEW_FINDING", severity: "blocker", detail: "something unattributable broke" }],
        blockerCount: 1,
      },
    };
    // findings that name no known target leave the repair owning the whole bundle
    expect(failedFilesFromQaPackage(unattributable)).toEqual(["index.html", "about.html", "services.html", "contact.html"]);
  });

  it("the repair prompt carries the full bundle, blueprint, exact findings, facts and preflight mode — no screenshots required", () => {
    const prompt = buildRepairUserPrompt({
      siteGenerationId: "sg",
      buildId: "b",
      buildVersionId: "bv",
      buildVersionNumber: 2,
      bundle: repairBundle(),
      blueprint: bp,
      facts: FACTS,
      qaPackage: preflightQaPackage,
      acceptedImages: [],
      formServiceEndpoint: endpoint,
      siteFormId,
      referenceVisualInputs: [],
    });
    expect(prompt).toContain("CURRENT SITE BUNDLE (complete repair context");
    expect(prompt).toContain("DESIGN BLUEPRINT (unchanged design authority");
    expect(prompt).toContain(JSON.stringify(bp).slice(0, 80));
    expect(prompt).toContain("MALFORMED_HTML");
    expect(prompt).toContain("FAILED FILES (deterministic findings implicate these): index.html, site.css");
    expect(prompt).toContain("MODE: deterministic preflight-failure repair");
    expect(prompt).not.toContain("Attached images");
    expect(prompt).toContain('name="siteFormId"');

    const withRenders = buildRepairUserPrompt({
      siteGenerationId: "sg",
      buildId: "b",
      buildVersionId: "bv",
      buildVersionNumber: 2,
      bundle: repairBundle(),
      blueprint: bp,
      facts: FACTS,
      qaPackage: preflightQaPackage,
      acceptedImages: [],
      formServiceEndpoint: endpoint,
      siteFormId,
      referenceVisualInputs: [],
      candidateDesktopR2Key: "renders/v1/desktop.png",
    });
    expect(withRenders).toContain("Attached images, in order");
    expect(withRenders).not.toContain("MODE: deterministic preflight-failure repair");
  });
});

// ── #4: builder progressive-enhancement instruction ──────────────────────────

describe("builder progressive-enhancement instruction (#4)", () => {
  it("the builder's frozen context states the base-visibility rule and names the banned pattern", async () => {
    const ctx = await scaffoldBuild();
    const seen: Array<{ system: string; user: string }> = [];
    // schema-valid bundle (pages >= 200 chars each, every CRITICAL hero slot
    // placed on its declared page) returned by the injected seam
    const longPage = (pageId: "home" | "about" | "services" | "contact") => {
      const title = pageId[0].toUpperCase() + pageId.slice(1);
      return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${title} page with a full descriptive body for the fixture bundle."><meta property="og:title" content="${title}"><meta property="og:description" content="${title} description"><link rel="stylesheet" href="site.css"></head><body><header><nav aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header><main><section class="hero"><img src="IMG:${pageId}-hero" data-image-id="${pageId}-hero" alt="${title} hero photograph"><h1>${title}</h1><p>${title} hero copy for the fixture bundle, long enough to satisfy the schema floor and describe the section honestly.</p></section></main><footer><p>Business footer line for the fixture.</p></footer><script src="site.js" defer></script></body></html>`;
    };
    const builderBundle: SiteBundle = {
      version: "1",
      pages: {
        home: longPage("home"),
        about: longPage("about"),
        services: longPage("services"),
        contact: longPage("contact"),
      },
      sharedCss:
        ":root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }\nbody { background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }\n.hero { min-height: 60vh; display: grid; place-items: center; }\n.site-nav { display: flex; gap: 1.5rem; }\nimg { max-width: 100%; display: block; }\nform { display: grid; gap: 1rem; }\na:hover { text-decoration: underline; }\n:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n@media (max-width: 767px) { .hero { min-height: 40vh; } }\n@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }",
      sharedJs: "(function(){var t=document.querySelector('.nav-toggle');if(t){t.addEventListener('click',function(){document.body.classList.toggle('nav-open');});}})();",
    };
    await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: ctx.siteGenerationId,
      buildId: ctx.buildId,
      buildVersionId: ctx.buildVersionId,
      buildVersionNumber: 1,
      blueprint: bp,
      facts: FACTS,
      acceptedImages: materializeAcceptedImageDescriptors(bp),
      formServiceEndpoint: endpoint,
      siteFormId,
      generate: async (system, user) => {
        seen.push({ system, user });
        // Canonical SIX_CALL shapes: one RAW file per call, in order.
        if (user.includes("call 1 of 6")) {
          return { content: builderBundle.sharedCss, provider: "test", model: "@cf/zai-org/glm-5.3" };
        }
        if (user.includes("call 6 of 6")) {
          return { content: builderBundle.sharedJs, provider: "test", model: "@cf/zai-org/glm-5.3" };
        }
        const page = /Realize the \"(home|about|services|contact)\" page/.exec(user)![1];
        return { content: builderBundle.pages[page as keyof typeof builderBundle.pages], provider: "test", model: "@cf/zai-org/glm-5.3" };
      },
    });
    expect(seen.length).toBe(6);
    for (const phrase of [
      "All content must be visible in the base HTML/CSS state.",
      "content visibility may never depend on JavaScript execution",
      "Do not ship .reveal { opacity: 0 }",
      "use progressive enhancement",
    ]) {
      expect(seen[0].user).toContain(phrase);
    }
  });
});

// ── #5: trust lint action-role exclusion ─────────────────────────────────────

describe("trust lint: CTA/nav/action labels are not trust entities (#5)", () => {
  const factWords = factVocabulary(FACTS);
  const businessNameWords = new Set(FACTS.businessName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const lint = (html: string) => lintTrustContexts(html, "home", factWords, new Map(), businessNameWords);

  it("an anchor CTA inside a testimonial-styled container passes (the Phase 4 false positive)", () => {
    const html = `<div class="testimonials"><blockquote><p>They rebuilt our site in three weeks.</p></blockquote><a href="/about">Learn More About Us</a></div>`;
    expect(lint(html)).toEqual([]);
  });

  it("a button CTA inside a client-proof region passes", () => {
    const html = `<div class="client-proof"><h3>Trusted by teams</h3><button type="button">Read More</button></div>`;
    expect(lint(html)).toEqual([]);
  });

  it("a plain div carrying CTA copy inside a testimonial container passes (semantic rescue, not a whitelist)", () => {
    const html = `<div class="testimonials"><div>Learn More About Us</div></div>`;
    expect(lint(html)).toEqual([]);
    const html2 = `<div class="testimonials"><div class="cta-row">Get Started Today</div></div>`;
    expect(lint(html2)).toEqual([]);
  });

  it("a fabricated testimonial author still fails", () => {
    const violations = lint(`<div class="testimonials"><p class="testimonial-author">Zynthara Labs</p></div>`);
    expect(violations.length).toBe(1);
    expect(violations[0].text).toBe("Zynthara Labs");
  });

  it("a fabricated client logo alt still fails", () => {
    const violations = lint(`<div class="clients"><div class="logo-row"><img src="IMG:x" alt="Acme Kenya"></div></div>`);
    expect(violations.length).toBe(1);
    expect(violations[0].text).toBe("Acme Kenya");
  });

  it("a fabricated award still fails", () => {
    const violations = lint(`<div class="awards"><div>Digital Africa Awards</div></div>`);
    expect(violations.length).toBe(1);
    expect(violations[0].text).toBe("Digital Africa Awards");
  });

  it("fabricated entities inside action-carriers are still caught when they appear as identity labels", () => {
    // the fake name is the LIST ITEM (identity role), not the anchor text
    const violations = lint(`<div class="clients"><ul><li>Zynthara Labs</li></ul><a href="/work">Read More</a></div>`);
    expect(violations.length).toBe(1);
    expect(violations[0].text).toBe("Zynthara Labs");
  });
});
