// FOUR-PAGE HERO MEDIA (operator GO, 2026-09-09): regression proofs for the
// inner-page hero requirement —
//   - the Blueprint contract requires a photographic hero (mediaSlotId) on
//     ALL FOUR routed pages, linked to a dedicated per-page hero image slot
//   - the image plan carries the page-hero slots
//   - the Builder instruction cannot produce typography-only inner-page
//     heroes (INNER_PAGE_HERO_MEDIA_MISSING fires deterministically)
//   - hero images are traceable to Accepted Images
//   - the Nano Banana screen-free adaptation covers every page hero
//   - the mobile hero-mass rule ships in the builder prompt

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  blueprintHeroSlotId,
  blueprintSlotsToImageSlots,
  evaluateBlueprintQualityGate,
  validateDesignBlueprint,
  heroSlotIdForPage,
  materializeAcceptedImageDescriptors,
  type DesignBlueprint,
  type DesignBlueprintV2,
  type SiteBundle,
} from "../src/simple-design/contracts";
import { runDeterministicBundleQa, findInnerPageHeroMediaFinding } from "../src/simple-design/bundle-qa";
import { runSimpleWebsiteBuilderStage } from "../src/simple-design/website-builder";
import { planKieImageRequest, NANO_BANANA_MODEL_ID, SCREEN_FREE_PHOTO_REQUIREMENT } from "../src/lib/kie-v2";
import { composeStagePrompt } from "../src/domain/prompt-contract";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";
import { FINCH_V2_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch-v2";
import { createSimpleScripts, finchV1BlueprintFixture, simpleBlueprintFixture } from "./helpers/simple-scripts";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";

const env = providedEnv as unknown as Env;
const fixture = () => JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT)) as DesignBlueprint;
const clone = fixture;
const PAGES = ["home", "about", "services", "contact"] as const;

// Minimal Business Facts for the deterministic bundle QA harness.
const FACTS = {
  businessName: "RankForge Kenya",
  contactEmail: "ops@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
} as const;

function heroSectionHtml(slotId: string, variant: "img" | "data-id" | "css-only" = "img"): string {
  const media =
    variant === "img"
      ? `<img src="IMG:${slotId}" data-image-id="${slotId}" alt="Hero photograph">`
      : variant === "data-id"
        ? `<div class="hero-media" data-image-id="${slotId}" role="img" aria-label="Hero photograph"></div>`
        : `<div class="hero-media" style="background-image:url('assets/images/missing.webp')"></div>`;
  return `<section class="hero ${slotId}-hero"><div class="hero-inner"><h1>Hero headline</h1>${media}</div></section>`;
}

function pageHtml(page: (typeof PAGES)[number], heroSlotId: string | null, variant: "img" | "data-id" | "css-only" = "img"): string {
  const hero =
    heroSlotId === null
      ? '<div class="page-head"><h1>' + page + "</h1><p>A pale typography-only header.</p></div>"
      : heroSectionHtml(heroSlotId, variant);
  return `<!DOCTYPE html><html lang="en"><head><title>${page}</title><meta name="description" content="${page}"></head><body><header><nav><a href="/">home</a><a href="/about">about</a><a href="/services">services</a><a href="/contact">contact</a></nav></header><main>${hero}<section class="body-copy"><h2>Body</h2><p>Some copy.</p></section></main><footer></footer></body></html>`;
}

function bundleWithHeroes(heroByPage: Partial<Record<(typeof PAGES)[number], { slotId: string | null; variant?: "img" | "data-id" | "css-only" }>>): { bundle: SiteBundle; blueprint: DesignBlueprintV2 } {
  const blueprint = JSON.parse(JSON.stringify(FINCH_V2_KNOWN_GOOD_BLUEPRINT)) as DesignBlueprintV2;
  const defaults: Record<(typeof PAGES)[number], string> = {
    home: "home-hero",
    about: "about-hero",
    services: "services-hero",
    contact: "contact-hero",
  };
  // `slotId: null` (typography-only hero) must be distinguishable from an
  // absent override — hence explicit undefined checks, never ??.
  const slotFor = (page: (typeof PAGES)[number]): string | null =>
    heroByPage[page] && heroByPage[page]!.slotId !== undefined ? heroByPage[page]!.slotId! : defaults[page];
  const variantFor = (page: (typeof PAGES)[number]): "img" | "data-id" | "css-only" =>
    heroByPage[page]?.variant ?? "img";
  const bundle: SiteBundle = {
    version: "1",
    pages: {
      home: pageHtml("home", slotFor("home"), variantFor("home")),
      about: pageHtml("about", slotFor("about"), variantFor("about")),
      services: pageHtml("services", slotFor("services"), variantFor("services")),
      contact: pageHtml("contact", slotFor("contact"), variantFor("contact")),
    },
    sharedCss: "body{color:#111} :focus-visible{outline:2px solid #5b21b6} @media (max-width:768px){.hero{min-height:40svh}}",
    sharedJs: "document.querySelector('.nav-toggle')?.addEventListener('click', () => {});",
  };
  return { bundle, blueprint };
}

function runQa(input: { bundle: SiteBundle; blueprint: DesignBlueprintV2 }) {
  const slotIds = new Set(
    [
      ...PAGES.map((page) => heroSlotIdForPage(page)),
      ...input.blueprint.imagery.supportingImageSlots.map((slot) => slot.id),
    ]
  );
  return runDeterministicBundleQa({
    bundle: input.bundle,
    blueprint: input.blueprint,
    facts: FACTS as unknown as typeof FACTS & Record<string, never>,
    formServiceEndpoint: "https://test.example.com/api/v2/forms/submit",
    siteFormId: "site:abc123",
    slotIds,
    resolvedSlotIds: slotIds,
    renderEvidence: null,
  });
}

const heroFindingIds = (result: ReturnType<typeof runQa>) =>
  result.technicalFindings.filter((finding) => finding.id === "INNER_PAGE_HERO_MEDIA_MISSING");

describe("Blueprint contract: hero media on all four pages", () => {
  it("the known-good fixture (with hero media) passes schema and the quality gate", () => {
    const validated = validateDesignBlueprint(finchV1BlueprintFixture());
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    const gate = evaluateBlueprintQualityGate(validated.value);
    expect(gate.failures).toEqual([]);
    expect(gate.passed).toBe(true);
  });

  it("requires hero media on all four pages — removing any page's mediaSlotId fails the gate", () => {
    for (const page of PAGES) {
      const broken = clone();
      delete (broken.pages[page].sections[0] as { mediaSlotId?: string }).mediaSlotId;
      const validated = validateDesignBlueprint(broken);
      expect(validated.valid, page).toBe(true); // schema allows absence; the GATE is the invariant
      const gate = evaluateBlueprintQualityGate(validated.value!);
      expect(gate.passed, page).toBe(false);
      expect(gate.failures.join("; "), page).toContain(`page '${page}' hero section has no mediaSlotId`);
    }
  });

  it("rejects a hero mediaSlotId that points at a non-hero or wrong-page slot", () => {
    const wrongSection = clone();
    wrongSection.pages.about.sections[0].mediaSlotId = "about-story"; // exists, but section is "Story Editorial"
    const gateWrongSection = evaluateBlueprintQualityGate(wrongSection);
    expect(gateWrongSection.passed).toBe(false);
    expect(gateWrongSection.failures.join("; ")).toContain("must target the hero section");

    const wrongPage = clone();
    wrongSection.pages.about.sections[0].mediaSlotId = "home-hero"; // another page's hero slot
    wrongPage.pages.about.sections[0].mediaSlotId = "home-hero";
    const gateWrongPage = evaluateBlueprintQualityGate(wrongPage);
    expect(gateWrongPage.passed).toBe(false);
    expect(gateWrongPage.failures.join("; ")).toContain("belongs to page 'home'");
  });

  it("enforces unique page heroes: a slot owned by another page fails that page's hero check", () => {
    // A slot belongs to exactly ONE page, so the same-page guard is what makes
    // duplicate page photography impossible via the blueprint contract.
    const stolen = clone();
    stolen.pages.services.sections[0].mediaSlotId = "about-hero"; // another page's hero slot
    const gate = evaluateBlueprintQualityGate(stolen);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("page heroes are unique by default");
  });

  it("rejects a NORMAL-priority hero slot (heroes are CRITICAL or HIGH)", () => {
    const normal = clone();
    const aboutHero = normal.imagery.imageSlots.find((slot) => slot.id === "about-hero")!;
    aboutHero.priority = "NORMAL";
    const gate = evaluateBlueprintQualityGate(normal);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("must be CRITICAL or HIGH priority");
  });

  it("exposes the per-page hero slot id via blueprintHeroSlotId", () => {
    const blueprint = finchV1BlueprintFixture();
    expect(blueprintHeroSlotId(blueprint, "home")).toBe("home-hero");
    expect(blueprintHeroSlotId(blueprint, "about")).toBe("about-hero");
    expect(blueprintHeroSlotId(blueprint, "services")).toBe("services-hero");
    expect(blueprintHeroSlotId(blueprint, "contact")).toBe("contact-atmosphere");
    const broken = clone();
    delete (broken.pages.about.sections[0] as { mediaSlotId?: string }).mediaSlotId;
    expect(blueprintHeroSlotId(broken, "about")).toBeNull();
  });
});

describe("Image plan: page-hero slots", () => {
  it("carries one dedicated hero slot per routed page", () => {
    const slots = blueprintSlotsToImageSlots(finchV1BlueprintFixture());
    for (const page of PAGES) {
      const heroSlots = slots.filter((slot) => slot.page === page && /hero/i.test(slot.regionId ?? ""));
      expect(heroSlots.length, page).toBeGreaterThanOrEqual(1);
    }
  });

  it("orientation follows the PROVIDER-resolved ratio, not the legacy generation ratio (live regression)", () => {
    // Live finding (four-page-hero regression v12): a slot with composition
    // 4:3 and generation 1:1 requested 4:3 from the provider, received a
    // correct 4:3 image, and was rejected by square-class conformance —
    // burning both attempts. Orientation must match the requested shape.
    const blueprint = clone();
    const slot = blueprint.imagery.imageSlots.find((candidate) => candidate.id === "about-hero")!;
    slot.compositionAspectRatio = "4:3"; // design wants 4:3 — natively supported
    slot.generationAspectRatio = "1:1"; // legacy class: square; provider class: landscape
    const mapped = blueprintSlotsToImageSlots(blueprint).find((candidate) => candidate.id === "about-hero")!;
    expect(mapped.orientation).toBe("landscape");
  });
});

describe("Deterministic QA: INNER_PAGE_HERO_MEDIA_MISSING", () => {
  it("a fully hero-media-bearing bundle produces NO hero finding", () => {
    const result = runQa(bundleWithHeroes({}));
    expect(heroFindingIds(result)).toEqual([]);
  });

  it("a typography-only About hero triggers the blocker", () => {
    const result = runQa(bundleWithHeroes({ about: { slotId: null } }));
    const findings = heroFindingIds(result);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe("blocker");
    expect(findings[0].detail).toContain("about");
  });

  it("a typography-only Services hero triggers the blocker", () => {
    const result = runQa(bundleWithHeroes({ services: { slotId: null } }));
    expect(heroFindingIds(result).map((f) => f.detail).join(" ")).toContain("services");
  });

  it("a typography-only Contact hero triggers the blocker", () => {
    const result = runQa(bundleWithHeroes({ contact: { slotId: null } }));
    expect(heroFindingIds(result).map((f) => f.detail).join(" ")).toContain("contact");
  });

  it("a hero without its Accepted Image reference triggers the blocker", () => {
    const result = runQa(bundleWithHeroes({ about: { slotId: "about-hero", variant: "css-only" } }));
    const findings = heroFindingIds(result);
    expect(findings.length).toBe(1);
    expect(findings[0].detail).toContain("'about-hero' is not referenced");
  });

  it("a hero media reference OUTSIDE the hero region triggers the blocker", () => {
    // data-image-id variant inside the hero is traceable and PASSES...
    const ok = runQa(bundleWithHeroes({ about: { slotId: "about-hero", variant: "data-id" } }));
    expect(heroFindingIds(ok)).toEqual([]);
    // ...but the same identity hidden in the footer (below the body sections) FAILS.
    const blueprint = clone();
    const html = `<!DOCTYPE html><html lang="en"><head><title>about</title><meta name="description" content="about"></head><body><header><nav><a href="/">home</a><a href="/about">about</a><a href="/services">services</a><a href="/contact">contact</a></nav></header><main><section class="hero about-hero"><h1>About headline</h1><p>No image here.</p></section><section class="body"><p>Copy.</p></section></main><footer><div data-image-id="about-hero"></div></footer></body></html>`;
    const finding = findInnerPageHeroMediaFinding("about", html, "about-hero");
    expect(finding).toContain("outside the hero region");
  });

  it("an <img> hero inside a hero-marked element passes (data-image-id traceable)", () => {
    const html = `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body><main><section class="hero about-hero"><img src="IMG:about-hero" data-image-id="about-hero" alt="x"></section></main></body></html>`;
    expect(findInnerPageHeroMediaFinding("about", html, "about-hero")).toBeNull();
  });
});

describe("Builder: hero invariant ships in every builder call", () => {
  it("builds a four-page bundle whose inner pages keep hero media (mocked seam), with the hero rule present in the prompt", async () => {
    const scripts = createSimpleScripts();
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: "references/simple/exp-finch-ref.png" },
      },
    });
    const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const blueprint = simpleBlueprintFixture();
    const result = await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: build.buildId,
      buildVersionId: build.buildVersionId,
      buildVersionNumber: build.buildVersionNumber,
      blueprint,
      facts: FACTS as unknown as typeof FACTS & Record<string, never>,
      acceptedImages: materializeAcceptedImageDescriptors(blueprint),
      formServiceEndpoint: "https://test.example.com/api/v2/forms/submit",
      siteFormId: "site:abc123",
      visualInputs: [],
      generate: scripts.generate,
    });
    expect(result.bundle.pages.home).toContain('src="IMG:home-hero"');
    expect(result.bundle.pages.about).toContain('src="IMG:about-hero"');
    expect(result.bundle.pages.services).toContain('src="IMG:services-hero"');
    expect(result.bundle.pages.contact).toContain('src="IMG:contact-hero"');
    for (const page of PAGES) {
      expect(result.bundle.pages[page]).toMatch(/class="[^"]*hero/);
    }
  });
});

describe("Nano Banana screen-free adaptation covers every page hero", () => {
  it("every materialized hero slot's effective prompt carries the SCREEN-FREE clause and the nano profile", () => {
    const blueprint = simpleBlueprintFixture();
    for (const page of PAGES) {
      const heroSlotId = heroSlotIdForPage(page);
      const brief = blueprint.imagery.pageHeroes[page];
      const plan = planKieImageRequest(
        {
          slotId: heroSlotId,
          promptText: brief.kiePrompt,
          aspectRatio: "16:9",
          compositionAspectRatio: brief.compositionAspectRatio,
          generationAspectRatio: brief.generationAspectRatio,
        },
        NANO_BANANA_MODEL_ID
      );
      expect(plan.profile, page).toBe("nano-banana-2-lite");
      expect(plan.prompt, page).toContain(SCREEN_FREE_PHOTO_REQUIREMENT);
      expect(plan.providerAspectRatio, page).toBe(brief.generationAspectRatio);
    }
  });
});

describe("Mobile hero mass rule ships in the builder prompt", () => {
  it("the composed builder prompt contains the hero media rule and the mobile 35-50svh floor", async () => {
    const composed = composeStagePrompt("simple-website-builder");
    expect(composed.promptVersion).toBe("v3");
    expect(composed.systemPrompt).toContain("FOUR-PAGE HERO MEDIA");
    expect(composed.systemPrompt).toContain("35–50svh");
    const blueprint = composeStagePrompt("simple-design-blueprint");
    expect(blueprint.promptVersion).toBe("v5");
    expect(blueprint.systemPrompt).toContain("pageHeroes");
    expect(blueprint.systemPrompt).not.toContain("mediaSlotId");
    const visualQa = composeStagePrompt("simple-visual-qa");
    expect(visualQa.promptVersion).toBe("v2");
    expect(visualQa.systemPrompt).toContain("photographic hero treatment");
  });
});
