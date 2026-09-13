import { canonicalStructuredFacts } from "./helpers/canonical-facts";
// CRITICAL IMAGE COVERAGE (operator GO, 2026-09-10): the Website Builder's
// own image contract, proven at the seams the repository tests.
//
//   §1-§2  every CRITICAL slot of the materialized plan is mandatory
//          (the four deterministic heroes AND CRITICAL supporting slots)
//   §3-§4  HIGH / NORMAL supporting slots may be unused without a finding
//   §5-§7  coverage passes on the declared page; absence and wrong-page
//          placement each fail with their own finding id
//   §8     unknown IMG slots still fail deterministically downstream
//   §9     the canonical SIX_CALL build persists only when every realized
//          file passes its deterministic validation AND coverage
//   §10-§11 a six-call output still violating coverage fails CLOSED: no
//          persisted artifact, no engine retry, no second Builder attempt
//   §12    the mandatory ledger carries exact slot/page/section/priority
//          (shared context + per-page grouping for the pages call)
//   §13    a testimonial-style CRITICAL image ships WITHOUT fabricated
//          testimonial facts (design fidelity + truth zero-tolerance)
//   §14    the site_bundle artifact is written only after coverage validation
//   §15    the Assembly Preflight independently enforces the SAME shared
//          invariant as the final defense

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  materializeAcceptedImageDescriptors,
  materializeBlueprintImageSlots,
  type DesignBlueprintV2,
  type SiteBundle,
} from "../src/simple-design/contracts";
import { requiredCriticalImageSlots, validateCriticalImageCoverage } from "../src/simple-design/critical-image-coverage";
import {
  BUILDER_STRATEGY_NOTE,
  buildCriticalImageLedger,
  buildCriticalImageLedgerByPage,
  CRITICAL_IMAGE_INVARIANT,
  runSimpleWebsiteBuilderStage,
  SimpleWebsiteBuilderError,
} from "../src/simple-design/website-builder";
import { runDeterministicBundleQa } from "../src/simple-design/bundle-qa";
import { runTechnicalPreflight } from "../src/domain/technical-preflight";
import { classifyStageFailure } from "../src/domain/stage-failure";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createSimpleScripts, persistSimpleScreenshot, simpleBlueprintFixture } from "./helpers/simple-scripts";

const env = providedEnv as unknown as Env;
const PAGES = ["home", "about", "services", "contact"] as const;
const ENDPOINT = "https://test.example.com/api/v2/forms/submit";
const FACTS = {
  businessName: "RankForge Kenya",
  contactEmail: "ops@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
  ...(canonicalStructuredFacts()),
} as const;

// ── fixtures ─────────────────────────────────────────────────────────────────

// Finch v2 known-good: four CRITICAL heroes, HIGH/NORMAL supporting only.
const baseBlueprint = (): DesignBlueprintV2 => simpleBlueprintFixture();

// The live-failure analogue (2026-09-10): a planned CRITICAL SUPPORTING slot
// in a results/testimonial-style section, exactly the class the builder
// omitted in production. Names are this fixture's own — never hard-coded
// slot names in the contract.
const withCriticalSupporting = (): DesignBlueprintV2 => {
  const bp = baseBlueprint();
  bp.imagery.supportingImageSlots[0].priority = "CRITICAL"; // home-chapters-tents
  return bp;
};

const withNamedCriticalSupporting = (id: string, section: string): DesignBlueprintV2 => {
  const bp = baseBlueprint();
  bp.imagery.supportingImageSlots.push({ ...bp.imagery.supportingImageSlots[0], id, section, priority: "CRITICAL" });
  return bp;
};

const imgTag = (slotId: string) => `<img src="IMG:${slotId}" data-image-id="${slotId}" alt="${slotId} photograph">`;

const pageWith = (pageId: string, slotIds: string[], extraSection = ""): string =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageId}</title><meta name="description" content="${pageId} page for the coverage fixture bundle, described at length."><meta property="og:title" content="${pageId}"><meta property="og:description" content="${pageId} description"><link rel="stylesheet" href="site.css"></head><body><header><nav class="site-nav" aria-label="Primary"><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav></header><main><section class="hero">${slotIds.map(imgTag).join("")}<h1>${pageId}</h1><p>${pageId} body copy long enough for any schema floor the bundle schema applies to its pages.</p></section>${extraSection}</main><footer><p>Footer line for the fixture.</p></footer><script src="site.js" defer></script></body></html>`;

// Schema-valid shared CSS (site-bundle/1 requires >= 200 chars) that ALSO
// passes the deterministic file-realization CSS validation (>= 10 rules,
// token layer, @media, :focus-visible, prefers-reduced-motion).
const FIXTURE_CSS =
  ":root { --accent: #7c3aed; --ink: #1a1523; --paper: #faf7f2; }\nbody { margin: 0; background: var(--paper); color: var(--ink); font-family: system-ui, sans-serif; }\n.hero { min-height: 60vh; display: grid; place-items: center; }\n.site-nav { display: flex; gap: 1.5rem; }\nimg { max-width: 100%; display: block; }\nform { display: grid; gap: 1rem; }\na:hover { text-decoration: underline; }\n:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }\n@media (max-width: 767px) { .hero { min-height: 40vh; } }\n@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }";
const FIXTURE_JS = "(function(){var t=document.querySelector('.nav-toggle');if(t){t.addEventListener('click',function(){document.body.classList.toggle('nav-open');});}})();";

// Coverage-complete bundle for a blueprint: every page carries its hero;
// CRITICAL supporting slots carry their sections' imagery.
function coverageBundleFor(bp: DesignBlueprintV2): SiteBundle {
  const required = requiredCriticalImageSlots(materializeAcceptedImageDescriptors(bp));
  const slotsFor = (page: string) => required.filter((slot) => slot.page === page).map((slot) => slot.slotId);
  return {
    version: "1",
    pages: {
      home: pageWith("home", slotsFor("home")),
      about: pageWith("about", slotsFor("about")),
      services: pageWith("services", slotsFor("services")),
      contact: pageWith("contact", slotsFor("contact")),
    },
    sharedCss: FIXTURE_CSS,
    sharedJs: FIXTURE_JS,
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

// ── §1-§4: what is mandatory, what is not ────────────────────────────────────

describe("requiredCriticalImageSlots derives the mandatory set from the materialized plan", () => {
  it("§1 all four hero CRITICAL slots are mandatory", () => {
    const required = requiredCriticalImageSlots(materializeAcceptedImageDescriptors(baseBlueprint()));
    expect(required.map((slot) => slot.slotId).sort()).toEqual(["about-hero", "contact-hero", "home-hero", "services-hero"]);
    for (const slot of required) {
      expect(slot.priority).toBe("CRITICAL");
      expect(slot.required).toBe(true);
    }
  });

  it("§2 a CRITICAL supporting slot is mandatory too (descriptor carries priority + required)", () => {
    const descriptors = materializeAcceptedImageDescriptors(withCriticalSupporting());
    const required = requiredCriticalImageSlots(descriptors);
    expect(required.map((slot) => slot.slotId)).toContain("home-chapters-tents");
    expect(required).toHaveLength(5);
    const supporting = descriptors.find((descriptor) => descriptor.slotId === "home-chapters-tents")!;
    expect(supporting.priority).toBe("CRITICAL");
    expect(supporting.required).toBe(true);
    expect(supporting.page).toBe("home");
    expect(supporting.section).toBe("Chapters Collection");
    // HIGH/NORMAL stay convenience-optional
    const high = descriptors.find((descriptor) => descriptor.slotId === "home-location")!;
    expect(high.priority).toBe("HIGH");
    expect(high.required).toBe(false);
    const normal = descriptors.find((descriptor) => descriptor.slotId === "about-story")!;
    expect(normal.priority).toBe("NORMAL");
    expect(normal.required).toBe(false);
  });

  it("§3 a HIGH supporting slot may be unused without MISSING_CRITICAL_IMAGE", () => {
    // heroes only — all four HIGH home supporting slots stay unused
    const findings = validateCriticalImageCoverage(coverageBundleFor(baseBlueprint()).pages, materializeAcceptedImageDescriptors(baseBlueprint()), "placeholder");
    expect(findings).toEqual([]);
  });

  it("§4 a NORMAL supporting slot may be unused", () => {
    const findings = validateCriticalImageCoverage(coverageBundleFor(baseBlueprint()).pages, materializeAcceptedImageDescriptors(baseBlueprint()), "placeholder");
    expect(findings.some((finding) => finding.slotId === "about-story")).toBe(false);
  });
});

// ── §5-§7: page ownership ────────────────────────────────────────────────────

describe("validateCriticalImageCoverage: page ownership of CRITICAL slots", () => {
  it("§5 a CRITICAL slot used on its declared page passes", () => {
    const bp = withCriticalSupporting();
    const findings = validateCriticalImageCoverage(coverageBundleFor(bp).pages, materializeAcceptedImageDescriptors(bp), "placeholder");
    expect(findings).toEqual([]);
  });

  it("§6 a CRITICAL slot absent from the bundle fails with MISSING_CRITICAL_IMAGE", () => {
    const bp = withCriticalSupporting();
    const bundle = coverageBundleFor(bp);
    const pages = { ...bundle.pages, home: pageWith("home", ["home-chapters-tents"]) }; // home-hero dropped
    const findings = validateCriticalImageCoverage(pages, materializeAcceptedImageDescriptors(bp), "placeholder");
    const finding = findings.find((entry) => entry.slotId === "home-hero");
    expect(finding?.id).toBe("MISSING_CRITICAL_IMAGE");
    expect(finding?.page).toBe("home");
  });

  it("§7 a CRITICAL slot used only on a wrong page fails with WRONG_PAGE_CRITICAL_IMAGE", () => {
    const bp = baseBlueprint();
    const bundle = coverageBundleFor(bp);
    const pages = {
      ...bundle.pages,
      // about-hero moves to the home page; about loses it
      home: pageWith("home", ["home-hero", "about-hero"]),
      about: pageWith("about", []),
    };
    const findings = validateCriticalImageCoverage(pages, materializeAcceptedImageDescriptors(bp), "placeholder");
    const finding = findings.find((entry) => entry.slotId === "about-hero");
    expect(finding?.id).toBe("WRONG_PAGE_CRITICAL_IMAGE");
    expect(finding?.detail).toContain("about");
  });
});

// ── §8: unknown slots still fail deterministically ───────────────────────────

describe("unknown IMG slots still fail deterministically", () => {
  it("§8 bundle QA reports UNKNOWN_IMG_SLOT and preflight reports the unresolved placeholder", () => {
    const bp = baseBlueprint();
    const slotIds = new Set(materializeBlueprintImageSlots(bp).map((slot) => slot.id));
    const bundle = coverageBundleFor(bp);
    const withUnknown: SiteBundle = {
      ...bundle,
      pages: { ...bundle.pages, home: pageWith("home", ["home-hero", "home-unknown-slot"]) },
    };
    const qa = runDeterministicBundleQa({
      bundle: withUnknown,
      blueprint: bp,
      facts: FACTS,
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:test",
      slotIds,
      resolvedSlotIds: slotIds,
      renderEvidence: null,
    });
    expect(qa.technicalFindings.some((finding) => finding.id === "UNKNOWN_IMG_SLOT" && finding.detail.includes("home-unknown-slot"))).toBe(true);
    expect(qa.technicalBlockerCount).toBeGreaterThan(0);

    const preflight = runTechnicalPreflight(
      {
        pages: { ...bundle.pages, home: bundle.pages.home.replace("</main>", `${imgTag("home-unknown-slot")}</main>`) },
        sharedCss: bundle.sharedCss,
        sharedJs: bundle.sharedJs,
      },
      {
        formServiceEndpoint: ENDPOINT,
        expectedSiteFormId: "site:test",
        criticalSlots: [{ slotId: "home-hero", page: "home", section: "hero" }],
      }
    );
    expect(preflight.blockers.some((blocker) => blocker.id === "UNRESOLVED_IMAGE_SLOT" && blocker.detail?.includes("home-unknown-slot"))).toBe(true);
  });
});

// ── §9-§11, §14: the stage's strategy budget and fail-closed behavior ────────

function scriptedBuilderSeam(handlers: {
  onCssCall?: (userPrompt: string) => void;
  onPageCall?: (page: string, userPrompt: string) => void;
  pages: Record<string, string>;
}) {
  const calls: string[] = [];
  return {
    calls,
    generate: async (_system: string, user: string) => {
      if (user.includes("call 5 of 6")) {
        calls.push("site-css");
        handlers.onCssCall?.(user);
        return { content: FIXTURE_CSS, provider: "test", model: "@cf/zai-org/glm-5.3" };
      }
      const page = /Realize the "(home|about|services|contact)" page/.exec(user)?.[1];
      if (page) {
        calls.push(page);
        handlers.onPageCall?.(page, user);
        return { content: handlers.pages[page], provider: "test", model: "@cf/zai-org/glm-5.3" };
      }
      if (user.includes("call 6 of 6")) {
        calls.push("site-js");
        return { content: FIXTURE_JS, provider: "test", model: "@cf/zai-org/glm-5.3" };
      }
      throw new Error(`unexpected builder prompt: ${user.slice(0, 80)}`);
    },
  };
}

describe("the canonical SIX_CALL build: coverage-valid output persists; coverage-invalid output fails closed", () => {
  it("§9 a six-call build whose every file validates persists the bundle under the canonical strategy", async () => {
    const ctx = await scaffoldBuild("references/simple/critical-coverage-a.png");
    const bp = withCriticalSupporting();
    const valid = coverageBundleFor(bp);
    const seam = scriptedBuilderSeam({ pages: valid.pages });

    const result = await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: ctx.siteGenerationId,
      buildId: ctx.buildId,
      buildVersionId: ctx.buildVersionId,
      buildVersionNumber: 1,
      blueprint: bp,
      facts: FACTS as unknown as typeof FACTS & Record<string, never>,
      acceptedImages: materializeAcceptedImageDescriptors(bp),
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:critical-coverage",
      generate: seam.generate,
    });

    expect(result.strategy).toBe("SIX_CALL_FILE_REALIZATION");
    expect(seam.calls).toEqual(["home", "about", "services", "contact", "site-css", "site-js"]);
    expect(result.bundle.pages.home).toContain('src="IMG:home-chapters-tents"');
    expect(result.bundle.notes).toBe(BUILDER_STRATEGY_NOTE);

    // §14 (positive half): the PERSISTED artifact is the validated bundle.
    const stored = await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle");
    expect(stored?.value.pages.home).toContain('src="IMG:home-chapters-tents"');
    expect(stored?.value.pages.home).toBe(valid.pages.home);
  });

  it("§10+§11 a six-call output still violating coverage FAILS CLOSED: SimpleWebsiteBuilderError, nothing persisted, no second builder attempt, no engine retry", async () => {
    const ctx = await scaffoldBuild("references/simple/critical-coverage-b.png");
    const bp = withCriticalSupporting();
    const invalid = coverageBundleFor(baseBlueprint()); // missing the CRITICAL supporting slot
    const seam = scriptedBuilderSeam({ pages: invalid.pages });

    let thrown: unknown;
    try {
      await runSimpleWebsiteBuilderStage(env, {
        siteGenerationId: ctx.siteGenerationId,
        buildId: ctx.buildId,
        buildVersionId: ctx.buildVersionId,
        buildVersionNumber: 1,
        blueprint: bp,
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        acceptedImages: materializeAcceptedImageDescriptors(bp),
        formServiceEndpoint: ENDPOINT,
        siteFormId: "site:critical-coverage",
        generate: seam.generate,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SimpleWebsiteBuilderError);
    const error = thrown as SimpleWebsiteBuilderError;
    expect(error.code).toBe("CRITICAL_IMAGE_COVERAGE");
    expect(error.findings.map((finding) => finding.slotId)).toContain("home-chapters-tents");

    // exactly the six canonical calls — never a second attempt
    expect(seam.calls).toEqual(["home", "about", "services", "contact", "site-css", "site-js"]);
    // nothing was frozen as a successful Builder artifact (§14 negative half)
    const stored = await getBuildStageArtifact<SiteBundle>(env, ctx.buildVersionId, "site_bundle");
    expect(stored).toBeNull();
    // the engine can never turn this into a retry (a retry would be a second attempt)
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });
})

// ── §12: the deterministic ledger ────────────────────────────────────────────

describe("the mandatory CRITICAL ledger names exact slot/page/section/priority", () => {
  it("§12 ledger entries carry slot id, page, section, priority and REQUIRED (direct + in both builder calls)", async () => {
    const bp = withNamedCriticalSupporting("home-testimonial-office", "Testimonial Band");
    const descriptors = materializeAcceptedImageDescriptors(bp);
    const ledger = buildCriticalImageLedger(descriptors);
    expect(ledger).toContain("- home-hero\n  page: home\n  section: hero\n  priority: CRITICAL\n  REQUIRED");
    expect(ledger).toContain("- home-testimonial-office\n  page: home\n  section: Testimonial Band\n  priority: CRITICAL\n  REQUIRED");
    const byPage = buildCriticalImageLedgerByPage(descriptors);
    for (const group of ["HOME REQUIRED IMAGES:", "ABOUT REQUIRED IMAGES:", "SERVICES REQUIRED IMAGES:", "CONTACT REQUIRED IMAGES:"]) {
      expect(byPage).toContain(group);
    }
    expect(byPage).toContain("- home-testimonial-office — section: Testimonial Band — priority: CRITICAL — REQUIRED");
    expect(byPage).toContain("- about-hero — section: hero — priority: CRITICAL — REQUIRED");

    // and the SAME ledger reaches the model: the full ledger in the shared
    // context of every call, the page's own slice in each page call.
    const ctx = await scaffoldBuild("references/simple/critical-coverage-c.png");
    const cssPrompts: string[] = [];
    const homePrompts: string[] = [];
    const seam = scriptedBuilderSeam({
      onCssCall: (user) => cssPrompts.push(user),
      onPageCall: (page, user) => {
        if (page === "home") homePrompts.push(user);
      },
      pages: coverageBundleFor(bp).pages,
    });
    await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: ctx.siteGenerationId,
      buildId: ctx.buildId,
      buildVersionId: ctx.buildVersionId,
      buildVersionNumber: 1,
      blueprint: bp,
      facts: FACTS as unknown as typeof FACTS & Record<string, never>,
      acceptedImages: descriptors,
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:critical-coverage",
      generate: seam.generate,
    });
    expect(cssPrompts[0]).toContain("MANDATORY CRITICAL IMAGE PLACEMENTS");
    expect(cssPrompts[0]).toContain(CRITICAL_IMAGE_INVARIANT);
    expect(cssPrompts[0]).toContain("- home-testimonial-office\n  page: home\n  section: Testimonial Band\n  priority: CRITICAL\n  REQUIRED");
    expect(homePrompts[0]).toContain("THIS PAGE'S MANDATORY CRITICAL IMAGES");
    expect(homePrompts[0]).toContain("- home-testimonial-office — section: Testimonial Band — priority: CRITICAL — REQUIRED");
  });
});

// ── §13: truth-safe CRITICAL photography ─────────────────────────────────────

describe("a testimonial-style CRITICAL image ships without fabricated testimonial facts", () => {
  it("§13 the photographic proof band passes coverage AND truth lint with no invented identity; a fabricated author still fails", () => {
    const bp = withNamedCriticalSupporting("home-testimonial-office", "Testimonial Band");
    const bundle = coverageBundleFor(bp);
    // adapt the textual purpose: a consultation/proof-style composition using
    // the planned photography — while every testimonial identity stays absent
    const proofBand = `<section class="consultation-band">${imgTag("home-testimonial-office")}<h2>How we work</h2><p>Every engagement starts with a structured consultation at our Nairobi studio, so the plan fits the business before anything ships.</p><a href="/contact">Start a conversation</a></section>`;
    const pages = { ...bundle.pages, home: pageWith("home", ["home-hero", "home-testimonial-office"], proofBand) };

    // design fidelity: coverage passes — the CRITICAL photograph ships
    const findings = validateCriticalImageCoverage(pages, materializeAcceptedImageDescriptors(bp), "placeholder");
    expect(findings).toEqual([]);

    // truth zero-tolerance: the same bundle is truth-clean (facts above)
    const slotIds = new Set(materializeBlueprintImageSlots(bp).map((slot) => slot.id));
    const qa = runDeterministicBundleQa({
      bundle: { ...bundle, pages },
      blueprint: bp,
      facts: FACTS,
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:test",
      slotIds,
      resolvedSlotIds: slotIds,
      renderEvidence: null,
    });
    expect(qa.truthFindings).toEqual([]);

    // the guardrail that still holds: an invented testimonial author is
    // forbidden even though the image itself is mandatory
    const fabricated = `<section class="testimonials">${imgTag("home-testimonial-office")}<blockquote><p>They tripled our organic traffic.</p></blockquote><p class="testimonial-author">Zynthara Labs</p></section>`;
    const fabricatedQa = runDeterministicBundleQa({
      bundle: { ...bundle, pages: { ...bundle.pages, home: pageWith("home", ["home-hero", "home-testimonial-office"], fabricated) } },
      blueprint: bp,
      facts: FACTS,
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:test",
      slotIds,
      resolvedSlotIds: slotIds,
      renderEvidence: null,
    });
    expect(fabricatedQa.truthFindings.some((finding) => finding.id === "FABRICATED_TRUST_ENTITY")).toBe(true);
    expect(fabricatedQa.truthFindings.some((finding) => finding.detail.includes("Zynthara Labs"))).toBe(true);
  });
});

// ── §15: the Assembly Preflight remains the independent final defense ────────

describe("Assembly Preflight enforces the same shared invariant on assembled candidates", () => {
  // The deterministic assembly maps src="IMG:{slotId}" to the bundled asset
  // path; data-image-id and alt stay as the builder wrote them.
  const assemble = (html: string): string => html.replace(/src="IMG:([a-z0-9-]+)"/g, 'src="assets/images/$1.webp"');
  const assembledImg = (slotId: string) => assemble(imgTag(slotId));

  const assembledCandidate = (mutate?: (pages: Record<string, string>) => Record<string, string>) => {
    const bp = withCriticalSupporting();
    const bundle = coverageBundleFor(bp);
    const assembled = Object.fromEntries(Object.entries(bundle.pages).map(([page, html]) => [page, assemble(html)]));
    return { bp, pages: mutate ? mutate(assembled) : assembled, sharedCss: bundle.sharedCss, sharedJs: bundle.sharedJs };
  };

  const criticalContext = (bp: DesignBlueprintV2) => ({
    formServiceEndpoint: ENDPOINT,
    expectedSiteFormId: "site:test",
    criticalSlots: requiredCriticalImageSlots(materializeAcceptedImageDescriptors(bp)).map((slot) => ({
      slotId: slot.slotId,
      page: slot.page,
      ...(slot.section ? { section: slot.section } : {}),
    })),
  });

  it("§15 a well-formed assembled candidate with full coverage passes", () => {
    const { bp, pages, sharedCss, sharedJs } = assembledCandidate();
    const verdict = runTechnicalPreflight({ pages, sharedCss, sharedJs }, criticalContext(bp));
    expect(verdict.blockers.filter((blocker) => blocker.id === "MISSING_CRITICAL_IMAGE" || blocker.id === "WRONG_PAGE_CRITICAL_IMAGE")).toEqual([]);
  });

  it("§15 an assembled candidate missing a CRITICAL image is rejected (MISSING_CRITICAL_IMAGE)", () => {
    const { bp, pages, sharedCss, sharedJs } = assembledCandidate((all) => ({
      ...all,
      home: all.home.replace(assembledImg("home-chapters-tents"), ""),
    }));
    const verdict = runTechnicalPreflight({ pages, sharedCss, sharedJs }, criticalContext(bp));
    const blocker = verdict.blockers.find((entry) => entry.id === "MISSING_CRITICAL_IMAGE");
    expect(blocker?.detail).toContain("home-chapters-tents");
  });

  it("§15 a CRITICAL image shipped on the wrong page is rejected (WRONG_PAGE_CRITICAL_IMAGE)", () => {
    const { bp, pages, sharedCss, sharedJs } = assembledCandidate((all) => ({
      ...all,
      home: all.home.replace("</main>", `${assembledImg("about-hero")}</main>`),
      about: all.about.replace(assembledImg("about-hero"), ""),
    }));
    const verdict = runTechnicalPreflight({ pages, sharedCss, sharedJs }, criticalContext(bp));
    expect(verdict.blockers.some((entry) => entry.id === "WRONG_PAGE_CRITICAL_IMAGE" && entry.detail?.includes("about-hero"))).toBe(true);
  });
});

// ── primary seam: the pipeline fails closed IN-STEP ─────────────────────────

describe("pipeline: a Builder that cannot satisfy CRITICAL coverage terminates HUMAN_REVIEW_REQUIRED in-step", () => {
  it("no assembly, no preview, no repair, no engine retry — the terminal carries the coverage reason", async () => {
    const referenceKey = "references/simple/critical-coverage-pipeline.png";
    await persistSimpleScreenshot(env, referenceKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: referenceKey, url: "https://reference.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      deps: createSimpleScripts({ builderOmitsAboutHero: true }),
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons[0]).toContain("WEBSITE_BUILDER_CRITICAL_IMAGE_COVERAGE");
    expect(outcome.reasons[0]).toContain("about-hero");
    expect(outcome.reasons[0]).toContain("no further attempt");
    expect(outcome.repairApplied).toBe(false);
    expect(outcome.releaseReadyBuildVersionId).toBeNull();
    expect(outcome.previewUrl).toBeNull();

    const version = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(outcome.buildId)
      .first<{ id: string }>();
    // exactly one Build Version: no repair version was ever created
    const versionCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?").bind(outcome.buildId).first<{ n: number }>();
    expect(versionCount?.n).toBe(1);
    // no site bundle was frozen, nothing assembled
    expect(await getBuildStageArtifact<SiteBundle>(env, version!.id, "site_bundle")).toBeNull();
    expect(await getBuildStageArtifact(env, version!.id, "assembled_manifest")).toBeNull();
    expect(await getBuildStageArtifact(env, version!.id, "qa_package")).toBeNull();
    // the audit trail names the stage and the terminal
    const event = await env.DB.prepare(
      "SELECT stage, to_state FROM build_workflow_events WHERE build_id = ? AND stage = 'simple_website_build' AND to_state = 'HUMAN_REVIEW_REQUIRED'"
    )
      .bind(outcome.buildId)
      .first<{ stage: string; to_state: string }>();
    expect(event).not.toBeNull();
  });
});

describe("pipeline: a Builder whose stylesheet invents structure terminates HUMAN_REVIEW_REQUIRED in-step", () => {
  it("the DOM-first selector gate fails closed to review — no engine retry, no instance-killing escape", async () => {
    const referenceKey = "references/simple/invented-structure-pipeline.png";
    await persistSimpleScreenshot(env, referenceKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: referenceKey, url: "https://reference.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      deps: createSimpleScripts({ builderInventsCssSelectors: true }),
    });

    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");
    expect(outcome.reasons[0]).toContain("WEBSITE_BUILDER_INVENTED_STRUCTURE");
    // the gate names the invented selectors themselves
    expect(outcome.reasons[0]).toContain(".field-error");
    expect(outcome.reasons[0]).toContain(".js-reveal");
    expect(outcome.repairApplied).toBe(false);
    expect(outcome.releaseReadyBuildVersionId).toBeNull();
    expect(outcome.previewUrl).toBeNull();

    // exactly one Build Version: no repair version was ever created
    const versionCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?").bind(outcome.buildId).first<{ n: number }>();
    expect(versionCount?.n).toBe(1);
    // no site bundle was frozen, nothing assembled
    const version = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(outcome.buildId)
      .first<{ id: string }>();
    expect(await getBuildStageArtifact<SiteBundle>(env, version!.id, "site_bundle")).toBeNull();
    expect(await getBuildStageArtifact(env, version!.id, "assembled_manifest")).toBeNull();
    expect(await getBuildStageArtifact(env, version!.id, "qa_package")).toBeNull();
    // the audit trail carries the review terminal
    const event = await env.DB.prepare(
      "SELECT to_state FROM build_workflow_events WHERE build_id = ? AND stage = 'simple_website_build' AND to_state = 'HUMAN_REVIEW_REQUIRED'"
    )
      .bind(outcome.buildId)
      .first<{ to_state: string }>();
    expect(event).not.toBeNull();
  });
});

describe("pipeline: deterministic Builder chrome drift is canonicalized, not fatal", () => {
  it("a shared-chrome violation (SOURCE_INCOMPLETE) lands in review — never an instance-killing escape", async () => {
    const referenceKey = "references/simple/chrome-violation-pipeline.png";
    await persistSimpleScreenshot(env, referenceKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: referenceKey, url: "https://reference.example.com/" },
      },
    });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      deps: createSimpleScripts({ builderRestylesChrome: true }),
    });

    // the drifted inner-page footer was canonically replaced and the build
    // proceeded through QA instead of dying in the Builder stage
    expect(outcome.terminal).not.toBe("HUMAN_REVIEW_REQUIRED");
    const version = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(outcome.buildId)
      .first<{ id: string }>();
    const bundle = await getBuildStageArtifact<SiteBundle>(env, version!.id, "site_bundle");
    expect(bundle).not.toBeNull();
    expect(bundle!.value.pages.about).toContain("RankForge Kenya");
    expect(bundle!.value.pages.about).not.toContain("Different Business");
  });
});
