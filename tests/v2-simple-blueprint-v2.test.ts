// design-blueprint/2 (operator GO, 2026-09-10): four-page heroes are
// STRUCTURAL schema invariants with deterministic materialization.
//   §19 schema: required hero specs + required hero image briefs per page; no
//               model-provided hero bookkeeping; reserved-id collisions fail.
//   §20 materialization: reserved hero ids, page ownership, section, CRITICAL
//               priority, brief preservation, supporting slots appended, no
//               duplicate ids.
//   §21 downstream: KIE receives all four heroes; the builder receives the
//               hero/image relationships; the technical hero gate sees all
//               four; Nano Banana screen-safe adaptation covers all four; no
//               v2 path calls hero-link canonicalization.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Value } from "@sinclair/typebox/value";
import type { Env } from "../src/env.d";
import {
  DESIGN_BLUEPRINT_V2_SCHEMA_VERSION,
  DesignBlueprintV2Schema,
  evaluateBlueprintQualityGateV2,
  heroSlotIdForPage,
  materializeAcceptedImageDescriptors,
  materializeBlueprintImageSlots,
  materializeBlueprintPromptRecords,
  storedBlueprintToV2,
  validateDesignBlueprintV2,
  type DesignBlueprintV2,
} from "../src/simple-design/contracts";
import { runDeterministicBundleQa } from "../src/simple-design/bundle-qa";
import { runSimpleWebsiteBuilderStage } from "../src/simple-design/website-builder";
import { canonicalizeBlueprintHeroMediaLinks, evaluateBlueprintQualityGate, validateDesignBlueprint } from "../src/simple-design/contracts";
import { planKieImageRequest, NANO_BANANA_MODEL_ID, SCREEN_FREE_PHOTO_REQUIREMENT } from "../src/lib/kie-v2";
import { createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
import { runSimpleDesignBlueprintStage } from "../src/simple-design/design-blueprint";
import { createSimpleScripts, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS, simpleBlueprintFixture } from "./helpers/simple-scripts";
import { FINCH_V2_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch-v2";

const env = providedEnv as unknown as Env;
const PAGES = ["home", "about", "services", "contact"] as const;
const clone = () => JSON.parse(JSON.stringify(FINCH_V2_KNOWN_GOOD_BLUEPRINT)) as DesignBlueprintV2;

const FACTS = {
  businessName: "RankForge Kenya",
  contactEmail: "ops@rankforge.example",
  businessType: "SEO agency",
  businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
} as const;

// ── §19 schema ──────────────────────────────────────────────────────────────

describe("design-blueprint/2 schema: heroes are structural invariants", () => {
  it("the known-good v2 fixture validates and passes the quality gate", () => {
    const validated = validateDesignBlueprintV2(FINCH_V2_KNOWN_GOOD_BLUEPRINT);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    expect(evaluateBlueprintQualityGateV2(validated.value).passed).toBe(true);
  });

  for (const page of PAGES) {
    it(`${page}: hero spec is REQUIRED by the schema`, () => {
      const bp = clone();
      delete (bp.pages[page] as { hero?: unknown }).hero;
      expect(Value.Check(DesignBlueprintV2Schema, bp)).toBe(false);
    });

    it(`${page}: hero image brief is REQUIRED by the schema`, () => {
      const bp = clone();
      delete (bp.imagery.pageHeroes as Record<string, unknown>)[page];
      expect(Value.Check(DesignBlueprintV2Schema, bp)).toBe(false);
    });
  }

  it("a missing About hero cannot validate and is named by the validator", () => {
    const bp = clone();
    delete (bp.pages.about as { hero?: unknown }).hero;
    const result = validateDesignBlueprintV2(bp);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.toLowerCase()).toContain("hero");
  });

  it("a missing About hero image brief cannot validate and is named by the validator", () => {
    const bp = clone();
    delete (bp.imagery.pageHeroes as Record<string, unknown>).about;
    const result = validateDesignBlueprintV2(bp);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("pageHeroes");
  });

  it("the schema provides NO field for model-provided hero bookkeeping (mediaSlotId, ids, page, priority)", () => {
    // Hero spec: design decisions only (subset of the allowed design keys).
    const allowedHeroKeys = ["purpose", "layout", "visualMass", "surface", "typography", "mediaTreatment", "cta", "responsive"];
    for (const page of PAGES) {
      for (const key of Object.keys(FINCH_V2_KNOWN_GOOD_BLUEPRINT.pages[page].hero)) {
        expect(allowedHeroKeys, `${page}:${key}`).toContain(key);
      }
    }
    // Hero image brief: semantic decisions only.
    const briefKeys = Object.keys(FINCH_V2_KNOWN_GOOD_BLUEPRINT.imagery.pageHeroes.about).sort();
    expect(briefKeys).not.toContain("id");
    expect(briefKeys).not.toContain("page");
    expect(briefKeys).not.toContain("section");
    expect(briefKeys).not.toContain("priority");
    expect(briefKeys).not.toContain("mediaSlotId");
    // v2 page sections carry no mediaSlotId at all.
    for (const page of PAGES) {
      for (const section of FINCH_V2_KNOWN_GOOD_BLUEPRINT.pages[page].sections) {
        expect(Object.keys(section), `${page}:${section.name}`).not.toContain("mediaSlotId");
      }
    }
    expect(DESIGN_BLUEPRINT_V2_SCHEMA_VERSION).toBe("design-blueprint/2");
  });

  it("a supporting image slot colliding with the reserved about-hero id fails deterministically", () => {
    const bp = clone();
    bp.imagery.supportingImageSlots.push({
      ...bp.imagery.supportingImageSlots[0],
      id: "about-hero",
    });
    const gate = evaluateBlueprintQualityGateV2(bp);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("collides with a reserved page-hero id");
  });

  it("v2 artifacts cannot enter through the v1 schema and vice versa (version literal)", () => {
    expect(FINCH_V2_KNOWN_GOOD_BLUEPRINT.version).toBe("2");
    const asV1 = validateDesignBlueprint(FINCH_V2_KNOWN_GOOD_BLUEPRINT);
    expect(asV1.valid).toBe(false); // v1 schema has no hero/pageHeroes shape
  });
});

// ── §20 materialization ─────────────────────────────────────────────────────

describe("materializeBlueprintImageSlots: deterministic hero domain construction", () => {
  it("materializes the four reserved hero ids in routed-page order", () => {
    const slots = materializeBlueprintImageSlots(simpleBlueprintFixture());
    expect(slots.slice(0, 4).map((slot) => slot.id)).toEqual([
      "home-hero",
      "about-hero",
      "services-hero",
      "contact-hero",
    ]);
  });

  it("assigns correct page ownership, hero section and CRITICAL priority", () => {
    const slots = materializeBlueprintImageSlots(simpleBlueprintFixture());
    for (const page of PAGES) {
      const slot = slots.find((candidate) => candidate.id === heroSlotIdForPage(page))!;
      expect(slot.page, page).toBe(page);
      expect(slot.regionId, page).toBe("hero");
      expect(slot.priority, page).toBe("CRITICAL");
      expect(slot.negativeSpaceForText, page).toBe(true);
    }
  });

  it("preserves the semantic image brief (orientation bridge, subject, ratios)", () => {
    const blueprint = simpleBlueprintFixture();
    const slots = materializeBlueprintImageSlots(blueprint);
    for (const page of PAGES) {
      const brief = blueprint.imagery.pageHeroes[page];
      const slot = slots.find((candidate) => candidate.id === heroSlotIdForPage(page))!;
      expect(slot.compositionAspectRatio, page).toBe(brief.compositionAspectRatio);
      expect(slot.generationAspectRatio, page).toBe(brief.generationAspectRatio);
      expect(slot.semanticRole, page).toContain(brief.subjectDirection.slice(0, 20));
      expect(slot.orientation, page).toBeTruthy();
    }
  });

  it("appends supporting slots unchanged after the heroes", () => {
    const blueprint = simpleBlueprintFixture();
    const slots = materializeBlueprintImageSlots(blueprint);
    expect(slots.length).toBe(4 + blueprint.imagery.supportingImageSlots.length);
    const supportingIds = slots.slice(4).map((slot) => slot.id);
    expect(supportingIds).toEqual(blueprint.imagery.supportingImageSlots.map((slot) => slot.id));
  });

  it("produces no duplicate ids", () => {
    const slots = materializeBlueprintImageSlots(simpleBlueprintFixture());
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length);
  });

  it("materializes one prompt record per slot with the brief's KIE prompt verbatim", () => {
    const blueprint = simpleBlueprintFixture();
    const records = materializeBlueprintPromptRecords(blueprint);
    expect(records.length).toBe(4 + blueprint.imagery.supportingImageSlots.length);
    for (const page of PAGES) {
      const record = records.find((candidate) => candidate.slotId === heroSlotIdForPage(page))!;
      expect(record.promptText, page).toBe(blueprint.imagery.pageHeroes[page].kiePrompt);
      expect(record.altText, page).toBe(blueprint.imagery.pageHeroes[page].altText);
    }
  });

  it("materializes builder descriptors carrying the hero→slot relationship", () => {
    const descriptors = materializeAcceptedImageDescriptors(simpleBlueprintFixture());
    const about = descriptors.find((descriptor) => descriptor.slotId === "about-hero")!;
    expect(about.page).toBe("about");
    expect(about.section).toBe("hero");
    expect(about.aspectRatio).toBe(simpleBlueprintFixture().imagery.pageHeroes.about.generationAspectRatio);
  });
});

// ── §21 downstream ──────────────────────────────────────────────────────────

describe("design-blueprint/2 downstream", () => {
  it("KIE planning receives all four mandatory page heroes", () => {
    const blueprint = simpleBlueprintFixture();
    const slots = materializeBlueprintImageSlots(blueprint);
    const records = materializeBlueprintPromptRecords(blueprint);
    for (const page of PAGES) {
      const slot = slots.find((candidate) => candidate.id === heroSlotIdForPage(page))!;
      const record = records.find((candidate) => candidate.slotId === heroSlotIdForPage(page))!;
      const plan = planKieImageRequest(
        {
          slotId: slot.id,
          promptText: record.promptText,
          aspectRatio: slot.orientation === "portrait" ? "9:16" : slot.orientation === "square" ? "1:1" : "16:9",
          compositionAspectRatio: slot.compositionAspectRatio,
          generationAspectRatio: slot.generationAspectRatio,
        },
        NANO_BANANA_MODEL_ID
      );
      expect(plan.profile, page).toBe("nano-banana-2-lite");
      expect(plan.prompt, page).toContain(SCREEN_FREE_PHOTO_REQUIREMENT);
    }
  });

  it("the Website Builder receives all four hero/image relationships and uses them (mocked seam)", async () => {
    await persistSimpleScreenshot(env, "references/simple/v2-blueprint.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: "references/simple/v2-blueprint.png" },
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
      generate: createSimpleScripts().generate,
    });
    for (const page of PAGES) {
      expect(result.bundle.pages[page], page).toContain(`src="IMG:${heroSlotIdForPage(page)}"`);
    }
  });

  it("the technical hero gate sees all four materialized heroes", () => {
    const blueprint = simpleBlueprintFixture();
    const slots = materializeBlueprintImageSlots(blueprint);
    const slotIds = new Set(slots.map((slot) => slot.id));
    const heroPage = (slotId: string) =>
      `<!DOCTYPE html><html lang="en"><head><title>t</title><meta name="description" content="t"></head><body><header><nav><a href="/">h</a><a href="/about">a</a><a href="/services">s</a><a href="/contact">c</a></nav></header><main><section class="hero"><img src="IMG:${slotId}" data-image-id="${slotId}" alt="hero"></section><section class="body"><p>Copy.</p></section></main><footer></footer></body></html>`;
    const bundle = {
      version: "1" as const,
      pages: {
        home: heroPage("home-hero"),
        about: heroPage("about-hero"),
        services: heroPage("services-hero"),
        contact: heroPage("contact-hero"),
      },
      sharedCss: "body{color:#111} :focus-visible{outline:2px solid #111}",
      sharedJs: "document.querySelector('.nav-toggle')?.addEventListener('click', () => {});",
    };
    const result = runDeterministicBundleQa({
      bundle,
      blueprint,
      facts: FACTS as unknown as typeof FACTS & Record<string, never>,
      formServiceEndpoint: "https://test.example.com/api/v2/forms/submit",
      siteFormId: "site:abc123",
      slotIds,
      resolvedSlotIds: slotIds,
      renderEvidence: null,
    });
    const heroFindings = result.technicalFindings.filter((finding) => finding.id === "INNER_PAGE_HERO_MEDIA_MISSING");
    expect(heroFindings).toEqual([]);
  });

  it("Accepted Image identity remains traceable through the descriptors", () => {
    const descriptors = materializeAcceptedImageDescriptors(simpleBlueprintFixture());
    const ids = descriptors.map((descriptor) => descriptor.slotId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const page of PAGES) {
      expect(ids, page).toContain(heroSlotIdForPage(page));
    }
  });

  it("no v2 path calls hero-link canonicalization (v1 canonicalizer untouched for history)", () => {
    // The v1 canonicalizer still exists for historical artifacts...
    const v1Result = canonicalizeBlueprintHeroMediaLinks(finchV1());
    expect(v1Result.canonicalization.applied).toBe(false); // valid v1 links unchanged
    // ...but the v2 stage contract never produces canonicalization metadata,
    // and the v2 gate has no hero-link checks to run.
    const blueprint = simpleBlueprintFixture();
    const gate = evaluateBlueprintQualityGateV2(blueprint);
    expect(gate.passed).toBe(true);
    // The v2 artifact round-trips version dispatch untouched.
    expect(storedBlueprintToV2(blueprint)).toBe(blueprint);
  });

  it("the live stage validates with the v2 native schema and stores design-blueprint/2", async () => {
    await persistSimpleScreenshot(env, "references/simple/v2-stage.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS as unknown as typeof FACTS & Record<string, never>,
        reference: { screenshotR2Key: "references/simple/v2-stage.png" },
      },
    });
    const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const result = await runSimpleDesignBlueprintStage(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: build.buildId,
      buildVersionId: build.buildVersionId,
      buildVersionNumber: build.buildVersionNumber,
      businessFactsRef: "onboarding-submission:test#fact-snapshot",
      replacementBusiness: { name: FACTS.businessName, type: FACTS.businessType, description: FACTS.businessDescription },
      visualInputs: [{ kind: "full-page", artifact: "references/simple/v2-stage.png", sha256: "test", width: 1440, height: 3200 }],
      generate: createSimpleScripts().generate,
    });
    expect(result.schemaVersion).toBe("design-blueprint/2");
    expect(result.blueprint.version).toBe("2");
    expect(result.heroMediaLinkCanonicalization).toEqual({ applied: false, links: [] });
    const stored = await import("../src/domain/stage-artifacts").then((module) =>
      module.getBuildStageArtifact<DesignBlueprintV2>(env, build.buildVersionId, "design_blueprint")
    );
    expect(stored!.schemaVersion).toBe("design-blueprint/2");
  });
});

// v1 fixture accessor for the retained canonicalizer proofs.
import { FINCH_KNOWN_GOOD_BLUEPRINT as FINCH_V1 } from "./_generated-simple-finch";
function finchV1() {
  return JSON.parse(JSON.stringify(FINCH_V1)) as import("../src/simple-design/contracts").DesignBlueprint;
}
