import { canonicalStructuredFacts } from "./helpers/canonical-facts";
// Blueprint hero-link canonicalization for HISTORICAL design-blueprint/1
// artifacts (operator GO, 2026-09-10): pure-function proofs of the v1
// referential repair, retained because the frozen-artifact compat path
// (storedBlueprintToV2) runs it for safe reading. design-blueprint/2 makes
// canonicalization unnecessary for new artifacts (no model hero bookkeeping
// exists); the seam tests therefore cover:
//   - a valid explicit link is byte-for-value unchanged
//   - missing/wrong links resolve deterministically to the unique
//     qualifying same-page hero slot
//   - zero qualifying slots / ambiguity / cross-page / NORMAL-priority /
//     body slots NEVER canonicalize — the gate fails closed
//   - canonicalization changes no property other than mediaSlotId
//   - the v2 pipeline stores design-blueprint/2 with materialized hero ids
//     and NEVER invokes canonicalization
//   - a frozen v1 artifact resumes through the compat path into the v2
//     pipeline (RELEASE_READY, heroes materialized)

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  canonicalizeBlueprintHeroMediaLinks,
  evaluateBlueprintQualityGate,
  heroSlotIdForPage,
  storedBlueprintToV2,
  type DesignBlueprint,
} from "../src/simple-design/contracts";
import { getBuildStageArtifact, storeBuildStageArtifactIdempotent } from "../src/domain/stage-artifacts";
import { createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createSimpleScripts, finchV1BlueprintFixture, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS } from "./helpers/simple-scripts";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";

const env = providedEnv as unknown as Env;
const PAGES = ["home", "about", "services", "contact"] as const;

// The Finch fixture's about page: one qualifying hero slot (`about-hero`,
// section "Hero", HIGH) plus one body/content slot (`about-story`, section
// "Story Editorial", NORMAL) — the exact shape the canonicalization rules
// discriminate between.
function blueprintWithoutAboutLink(): DesignBlueprint {
  const blueprint = finchV1BlueprintFixture();
  delete (blueprint.pages.about.sections[0] as { mediaSlotId?: string }).mediaSlotId;
  return blueprint;
}

describe("hero-link canonicalization: deterministic resolution", () => {
  it("1. valid explicit hero links pass through byte-for-value unchanged", () => {
    const blueprint = finchV1BlueprintFixture();
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(false);
    expect(result.canonicalization.links).toEqual([]);
    // No clone, no rewrite — the exact same object comes back.
    expect(result.blueprint).toBe(blueprint);
    expect(evaluateBlueprintQualityGate(result.blueprint).passed).toBe(true);
  });

  it("2. missing mediaSlotId with exactly one qualifying hero slot is populated deterministically", () => {
    const blueprint = blueprintWithoutAboutLink();
    const first = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(first.canonicalization.applied).toBe(true);
    expect(first.canonicalization.links).toEqual([
      { page: "about", supplied: null, resolved: "about-hero", reason: "UNIQUE_PAGE_HERO_SLOT" },
    ]);
    expect(first.blueprint.pages.about.sections[0].mediaSlotId).toBe("about-hero");
    expect(evaluateBlueprintQualityGate(first.blueprint).passed).toBe(true);
    // Deterministic: the same input always produces the same output.
    const second = canonicalizeBlueprintHeroMediaLinks(blueprintWithoutAboutLink());
    expect(second.blueprint.pages.about.sections[0].mediaSlotId).toBe("about-hero");
    expect(second.canonicalization).toEqual(first.canonicalization);
  });

  it("3. wrong mediaSlotId with exactly one unambiguous qualifying slot is corrected", () => {
    const blueprint = finchV1BlueprintFixture();
    // about-story exists on the same page but is a body slot — not qualifying.
    blueprint.pages.about.sections[0].mediaSlotId = "about-story";
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(true);
    expect(result.canonicalization.links).toEqual([
      { page: "about", supplied: "about-story", resolved: "about-hero", reason: "UNIQUE_PAGE_HERO_SLOT" },
    ]);
    expect(result.blueprint.pages.about.sections[0].mediaSlotId).toBe("about-hero");
    expect(evaluateBlueprintQualityGate(result.blueprint).passed).toBe(true);
  });
});

describe("hero-link canonicalization: fail-closed boundaries", () => {
  it("4. missing mediaSlotId with zero qualifying hero slots fails the gate", () => {
    const blueprint = blueprintWithoutAboutLink();
    blueprint.imagery.imageSlots = blueprint.imagery.imageSlots.filter((slot) => slot.id !== "about-hero");
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    // Nothing invented: canonicalization declines, the gate fails closed.
    expect(result.canonicalization.applied).toBe(false);
    expect(result.blueprint.pages.about.sections[0].mediaSlotId).toBeUndefined();
    const gate = evaluateBlueprintQualityGate(result.blueprint);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("page 'about' hero section has no mediaSlotId");
  });

  it("5. missing mediaSlotId with two qualifying hero slots is ambiguous — the gate fails", () => {
    const blueprint = blueprintWithoutAboutLink();
    blueprint.imagery.imageSlots.push({
      ...blueprint.imagery.imageSlots.find((slot) => slot.id === "about-hero")!,
      id: "about-hero-alt",
    });
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(false);
    expect(result.blueprint.pages.about.sections[0].mediaSlotId).toBeUndefined();
    const gate = evaluateBlueprintQualityGate(result.blueprint);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("page 'about' hero section has no mediaSlotId");
  });

  it("6. a cross-page hero slot is never borrowed to satisfy a page hero", () => {
    const blueprint = blueprintWithoutAboutLink();
    blueprint.imagery.imageSlots = blueprint.imagery.imageSlots.filter((slot) => slot.id !== "about-hero");
    // home-hero still exists — but belongs to another page.
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(false);
    expect(result.canonicalization.links).toEqual([]);
    expect(result.blueprint.pages.about.sections[0].mediaSlotId).toBeUndefined();
    const gate = evaluateBlueprintQualityGate(result.blueprint);
    expect(gate.passed).toBe(false);
    const joined = gate.failures.join("; ");
    expect(joined).toContain("page 'about' hero section has no mediaSlotId");
    expect(joined).not.toContain("home-hero");
  });

  it("7. a NORMAL-priority hero slot never qualifies", () => {
    const blueprint = finchV1BlueprintFixture();
    blueprint.pages.about.sections[0].mediaSlotId = "about-hero";
    const aboutHero = blueprint.imagery.imageSlots.find((slot) => slot.id === "about-hero")!;
    aboutHero.priority = "NORMAL";
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(false);
    const gate = evaluateBlueprintQualityGate(result.blueprint);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("must be CRITICAL or HIGH priority");
  });

  it("8. a body/content slot is never selected merely because it belongs to the page", () => {
    const blueprint = blueprintWithoutAboutLink();
    // Remove the real hero slot: the ONLY remaining same-page slot is
    // about-story — a NORMAL-priority non-hero body slot. It must never be
    // selected just for sharing the page.
    blueprint.imagery.imageSlots = blueprint.imagery.imageSlots.filter((slot) => slot.id !== "about-hero");
    const result = canonicalizeBlueprintHeroMediaLinks(blueprint);
    expect(result.canonicalization.applied).toBe(false);
    expect(result.blueprint.pages.about.sections[0].mediaSlotId).toBeUndefined();
    const gate = evaluateBlueprintQualityGate(result.blueprint);
    expect(gate.passed).toBe(false);
    const joined = gate.failures.join("; ");
    expect(joined).toContain("page 'about' hero section has no mediaSlotId");
    expect(joined).not.toContain("about-story");
  });
});

describe("hero-link canonicalization: scope and provenance", () => {
  it("9. canonicalization changes no property other than mediaSlotId", () => {
    const original = blueprintWithoutAboutLink();
    const result = canonicalizeBlueprintHeroMediaLinks(original);
    const expected = JSON.parse(JSON.stringify(original)) as DesignBlueprint;
    expected.pages.about.sections[0].mediaSlotId = "about-hero";
    // Whole-tree equality: section order, names, layout, slot plan, DNA,
    // tokens, prompts — everything except the one repaired link — identical.
    expect(JSON.stringify(result.blueprint)).toBe(JSON.stringify(expected));
  });

  it("10. the v2 pipeline stores design-blueprint/2 and NEVER calls hero-link canonicalization", async () => {
    await persistSimpleScreenshot(env, "references/simple/hero-canon.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: SIMPLE_SCRIPTS_BUSINESS,
          contactEmail: "ops@rankforge.example",
          businessType: "SEO agency",
          businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
        ...(canonicalStructuredFacts())},
        reference: { screenshotR2Key: "references/simple/hero-canon.png" },
      },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const stored = await getBuildStageArtifact<DesignBlueprint>(env, outcome.releaseReadyBuildVersionId!, "design_blueprint");
    expect(stored).not.toBeNull();
    expect(stored!.schemaVersion).toBe("design-blueprint/2");
    // The materialized reserved hero ids are the pipeline's hero identity...
    for (const page of ["home", "about", "services", "contact"] as const) {
      expect(heroSlotIdForPage(page), page).toBeTruthy();
    }
    // ...and the v2 path records NO canonicalization — there is no hero
    // referential lottery left to repair (GO section 21).
    expect(stored!.provenance?.heroMediaLinkCanonicalization).toBeUndefined();
  });

  it("11. a frozen design-blueprint/1 artifact resumes through the compat path into the v2 pipeline", async () => {
    await persistSimpleScreenshot(env, "references/simple/hero-v1-compat.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: SIMPLE_SCRIPTS_BUSINESS,
          contactEmail: "ops@rankforge.example",
          businessType: "SEO agency",
          businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
        ...(canonicalStructuredFacts())},
        reference: { screenshotR2Key: "references/simple/hero-v1-compat.png" },
      },
    });
    const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    // Seed the frozen v1 artifact exactly as a pre-upgrade Build Version
    // would carry it (immutable historical evidence, never rewritten).
    await storeBuildStageArtifactIdempotent(env, {
      buildId: build.buildId,
      buildVersionId: build.buildVersionId,
      siteGenerationId: started.siteGenerationId,
      kind: "design_blueprint",
      schemaVersion: "design-blueprint/1",
      value: FINCH_KNOWN_GOOD_BLUEPRINT,
    });
    // The blueprint script would fail the v2 schema if the stage tried to
    // generate — the frozen artifact must be the stage result instead.
    const outcome = await runBuildPipeline(env, { siteGenerationId: started.siteGenerationId, buildId: build.buildId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const stored = await getBuildStageArtifact<DesignBlueprint>(env, outcome.releaseReadyBuildVersionId!, "design_blueprint");
    expect(stored!.schemaVersion).toBe("design-blueprint/1"); // stored artifact untouched
    const adapted = storedBlueprintToV2(stored!.value);
    expect(adapted.version).toBe("2");
    expect(Object.keys(adapted.imagery.pageHeroes).sort()).toEqual(["about", "contact", "home", "services"]);
    expect(adapted.imagery.supportingImageSlots.map((slot) => slot.id)).toContain("about-story");
  });
});
