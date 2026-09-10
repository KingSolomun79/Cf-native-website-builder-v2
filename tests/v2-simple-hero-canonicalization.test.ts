// Deterministic blueprint hero-link canonicalization (operator GO,
// 2026-09-10): the duplicated hero mediaSlotId reference is resolved by
// deterministic code when — and ONLY when — the target is uniquely derivable
// from the blueprint's own image-slot plan. Proves:
//   - a valid explicit link is byte-for-value unchanged
//   - missing/wrong links resolve deterministically to the unique
//     qualifying same-page hero slot
//   - zero qualifying slots / ambiguity / cross-page / NORMAL-priority /
//     body slots NEVER canonicalize — the gate fails closed
//   - canonicalization changes no property other than mediaSlotId
//   - the stored Design Blueprint carries the canonical link while the raw
//     model evidence stays distinguishable in the ai-stage run artifact

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  canonicalizeBlueprintHeroMediaLinks,
  evaluateBlueprintQualityGate,
  validateDesignBlueprint,
  type DesignBlueprint,
} from "../src/simple-design/contracts";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { getObject } from "../src/lib/assets";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { createSimpleScripts, persistSimpleScreenshot, SIMPLE_SCRIPTS_BUSINESS, simpleBlueprintFixture } from "./helpers/simple-scripts";

const env = providedEnv as unknown as Env;
const PAGES = ["home", "about", "services", "contact"] as const;

// The Finch fixture's about page: one qualifying hero slot (`about-hero`,
// section "Hero", HIGH) plus one body/content slot (`about-story`, section
// "Story Editorial", NORMAL) — the exact shape the canonicalization rules
// discriminate between.
function blueprintWithoutAboutLink(): DesignBlueprint {
  const blueprint = simpleBlueprintFixture();
  delete (blueprint.pages.about.sections[0] as { mediaSlotId?: string }).mediaSlotId;
  return blueprint;
}

describe("hero-link canonicalization: deterministic resolution", () => {
  it("1. valid explicit hero links pass through byte-for-value unchanged", () => {
    const blueprint = simpleBlueprintFixture();
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
    const blueprint = simpleBlueprintFixture();
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
    const blueprint = simpleBlueprintFixture();
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

  it("10. the stored Design Blueprint artifact contains the canonical link", async () => {
    await persistSimpleScreenshot(env, "references/simple/hero-canon.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: SIMPLE_SCRIPTS_BUSINESS,
          contactEmail: "ops@rankforge.example",
          businessType: "SEO agency",
          businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
        },
        reference: { screenshotR2Key: "references/simple/hero-canon.png" },
      },
    });
    const base = createSimpleScripts();
    const modelBlueprint = blueprintWithoutAboutLink();
    const scripted: RawAiGenerate = async (system, user, attempt) => {
      if (user.includes("produce the Design Blueprint for the REPLACEMENT business")) {
        return { content: JSON.stringify(modelBlueprint), provider: "simple-script", model: "glm-5.3-flash" };
      }
      return base.visionGenerate!(system, user, attempt);
    };
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      deps: { ...base, generate: scripted, visionGenerate: scripted },
    });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const stored = await getBuildStageArtifact<DesignBlueprint>(env, outcome.releaseReadyBuildVersionId!, "design_blueprint");
    expect(stored).not.toBeNull();
    // The CANONICAL artifact carries the resolved link...
    expect(stored!.value.pages.about.sections[0].mediaSlotId).toBe("about-hero");
    expect(validateDesignBlueprint(stored!.value).valid).toBe(true);
    // ...with the canonicalization recorded in the artifact provenance.
    expect(stored!.provenance?.heroMediaLinkCanonicalization?.applied).toBe(true);
    expect(stored!.provenance?.heroMediaLinkCanonicalization?.links).toEqual([
      { page: "about", supplied: null, resolved: "about-hero", reason: "UNIQUE_PAGE_HERO_SLOT" },
    ]);
  });

  it("11. raw model evidence stays distinguishable from the canonical artifact", async () => {
    await persistSimpleScreenshot(env, "references/simple/hero-evidence.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: {
          businessName: SIMPLE_SCRIPTS_BUSINESS,
          contactEmail: "ops@rankforge.example",
          businessType: "SEO agency",
          businessDescription: "An SEO agency in Nairobi helping Kenyan businesses grow.",
        },
        reference: { screenshotR2Key: "references/simple/hero-evidence.png" },
      },
    });
    const base = createSimpleScripts();
    const modelBlueprint = blueprintWithoutAboutLink();
    const scripted: RawAiGenerate = async (system, user, attempt) => {
      if (user.includes("produce the Design Blueprint for the REPLACEMENT business")) {
        return { content: JSON.stringify(modelBlueprint), provider: "simple-script", model: "glm-5.3-flash" };
      }
      return base.visionGenerate!(system, user, attempt);
    };
    const outcome = await runBuildPipeline(env, {
      siteGenerationId: started.siteGenerationId,
      deps: { ...base, generate: scripted, visionGenerate: scripted },
    });
    expect(outcome.terminal).toBe("RELEASE_READY");

    // The boundary's raw accepted output for the blueprint stage keeps the
    // MODEL's link state: mediaSlotId missing on the about hero.
    const run = await env.DB.prepare(
      `SELECT artifact_r2_key FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-design-blueprint' AND outcome = 'valid'`
    )
      .bind(outcome.buildId)
      .first<{ artifact_r2_key: string }>();
    expect(run?.artifact_r2_key).toBeTruthy();
    const raw = JSON.parse(await new Response(await getObject(env, run!.artifact_r2_key)).text()) as {
      value: DesignBlueprint;
    };
    expect(raw.value.pages.about.sections[0].mediaSlotId).toBeUndefined();

    // While the canonical Design Blueprint artifact carries the resolved link.
    const stored = await getBuildStageArtifact<DesignBlueprint>(env, outcome.releaseReadyBuildVersionId!, "design_blueprint");
    expect(stored!.value.pages.about.sections[0].mediaSlotId).toBe("about-hero");

    // Every routed page's stored hero link resolves through the gate.
    for (const page of PAGES) {
      const link = stored!.value.pages[page].sections[0].mediaSlotId;
      expect(link, page).toBeTruthy();
      const slot = stored!.value.imagery.imageSlots.find((candidate) => candidate.id === link);
      expect(slot?.page, page).toBe(page);
    }
  });
});
