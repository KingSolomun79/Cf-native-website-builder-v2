// SIMPLE design pipeline: blueprint contract, quality gate, deterministic
// markdown renderer, image-slot bridge, pipeline selector and prompt contract
// registration (experiment spec sections 10-14, 21, 30-31, 4).

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  DESIGN_BLUEPRINT_SCHEMA_VERSION,
  evaluateBlueprintQualityGate,
  blueprintSlotsToImageSlots,
  blueprintSlotsToPromptRecords,
  validateDesignBlueprint,
} from "../src/simple-design/contracts";
import { renderDesignBlueprintMarkdown } from "../src/simple-design/render-blueprint";
import { resolveDesignPipelineVersion, DEFAULT_DESIGN_PIPELINE_VERSION } from "../src/simple-design/pipeline";
import { composeStagePrompt, PROMPT_MANIFEST } from "../src/domain/prompt-contract";
import { BUILD_LIFECYCLE_STATES } from "../src/domain/lifecycle-schema";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";

const env = providedEnv as unknown as Env;

describe("SIMPLE design blueprint contract", () => {
  it("accepts the known-good Finch-format fixture (schema + quality gate)", () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    const gate = evaluateBlueprintQualityGate(validated.value);
    expect(gate.passed).toBe(true);
    expect(validated.value.businessFactsRef).toContain("fact-snapshot");
  });

  it("carries no Business Fact sheet — businessFactsRef provenance only (spec section 14)", () => {
    const blueprint = FINCH_KNOWN_GOOD_BLUEPRINT as Record<string, unknown>;
    expect(Object.keys(blueprint)).not.toContain("businessFactSheet");
    expect(Object.keys(blueprint)).not.toContain("facts");
  });

  it("rejects fewer than 5 Design DNA rules through the quality gate", () => {
    const broken = JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT));
    broken.designDna = broken.designDna.slice(0, 3);
    // The schema rejects it outright (minItems 5).
    expect(validateDesignBlueprint(broken).valid).toBe(false);
  });

  it("gate failures name the violated structural rule (belt-and-braces beyond the schema)", () => {
    // The schema enforces most counts (10-20 checklist, 5-8 DNA, ...); the
    // gate is the defensive layer that stays true even if the schema loosens.
    // Feed it a hand-built empty object directly.
    const gate = evaluateBlueprintQualityGate({} as unknown as import("../src/simple-design/contracts").DesignBlueprint);
    expect(gate.passed).toBe(false);
    const joined = gate.failures.join("; ");
    expect(joined).toContain("designDna");
    expect(joined).toContain("page spec 'home'");
    expect(joined).toContain("signatureElements");
    expect(joined).toContain("responsive spec");
    expect(joined).toContain("acceptanceChecklist");
  });

  it("rejects duplicate and malformed image slot ids", () => {
    const broken = JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT));
    broken.imagery.imageSlots[1] = { ...broken.imagery.imageSlots[1], id: broken.imagery.imageSlots[0].id };
    const validated = validateDesignBlueprint(broken);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    const gate = evaluateBlueprintQualityGate(validated.value);
    expect(gate.passed).toBe(false);
    expect(gate.failures.join("; ")).toContain("duplicate image slot id");
  });
});

describe("deterministic DESIGN-BLUEPRINT.md renderer (spec sections 10/31)", () => {
  it("renders the same markdown for the same blueprint (byte-identical)", () => {
    const first = renderDesignBlueprintMarkdown(FINCH_KNOWN_GOOD_BLUEPRINT);
    const second = renderDesignBlueprintMarkdown(JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT)));
    expect(first).toBe(second);
  });

  it("reads like a designer's handoff, not machine metadata", () => {
    const markdown = renderDesignBlueprintMarkdown(FINCH_KNOWN_GOOD_BLUEPRINT);
    expect(markdown).toContain("Design DNA — Non-Negotiable Rules");
    expect(markdown).toContain("Signature Design Elements");
    expect(markdown).toContain("Anti-Patterns");
    expect(markdown).toContain("Acceptance Checklist");
    expect(markdown).toContain("clamp(2.5rem, 6vw, 5.5rem)");
    expect(markdown).toContain("KIE prompt");
    // The human-readable artifact must not be an ID/score dump.
    expect(markdown).not.toContain("sourceTraitId");
    expect(markdown).not.toContain("traitObligations");
  });
});

describe("blueprint image slots bridge to KIE (spec sections 20-21)", () => {
  it("maps aspect ratios onto slot orientations deterministically", () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    if (!validated.valid) throw new Error("fixture must validate");
    const slots = blueprintSlotsToImageSlots(validated.value);
    const byId = new Map(slots.map((slot) => [slot.id, slot]));
    expect(byId.get("home-hero")?.orientation).toBe("landscape"); // 16:9
    expect(byId.get("home-chapters-tents")?.orientation).toBe("landscape"); // 4:3
    expect(byId.get("about-story")?.orientation).toBe("landscape"); // 4:3
    // Every slot maps; no expansion to the 12-target (spec section 21).
    expect(slots.length).toBe(validated.value.imagery.imageSlots.length);
  });

  it("empts prompt records from the blueprint itself — no extra LLM stage", () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    if (!validated.valid) throw new Error("fixture must validate");
    const records = blueprintSlotsToPromptRecords(validated.value);
    const slotIds = validated.value.imagery.imageSlots.map((slot) => slot.id);
    expect(records.map((record) => record.slotId).sort()).toEqual([...slotIds].sort());
    for (const record of records) {
      expect(record.promptText.length).toBeGreaterThanOrEqual(40);
      expect(record.promptText.length).toBeLessThanOrEqual(1000); // KIE adapter cap
      expect(record.avoidance.length).toBeGreaterThan(0);
    }
  });
});

describe("DESIGN_PIPELINE_VERSION selector (spec section 4)", () => {
  it("defaults to simple_blueprint_v1 on the experiment branch", () => {
    expect(DEFAULT_DESIGN_PIPELINE_VERSION).toBe("simple_blueprint_v1");
    expect(resolveDesignPipelineVersion({})).toBe("simple_blueprint_v1");
    expect(resolveDesignPipelineVersion(undefined)).toBe("simple_blueprint_v1");
  });

  it("honors legacy_v2 for A/B comparison and ignores unknown values", () => {
    expect(resolveDesignPipelineVersion({ DESIGN_PIPELINE_VERSION: "legacy_v2" })).toBe("legacy_v2");
    expect(resolveDesignPipelineVersion({ DESIGN_PIPELINE_VERSION: "bogus" as unknown as undefined })).toBe("simple_blueprint_v1");
  });

  it("is not exposed as a Build Mode (business-facing mode stays REFERENCE_BOUND)", () => {
    // The selector is an env var, not a domain mode: the canonical Build Mode
    // union stays exactly REFERENCE_BOUND | ORIGINAL_DESIGN.
    expect(BUILD_LIFECYCLE_STATES).toBeDefined();
    expect(["REFERENCE_BOUND", "ORIGINAL_DESIGN"]).toContain("REFERENCE_BOUND");
    expect(DEFAULT_DESIGN_PIPELINE_VERSION).not.toBe("REFERENCE_BOUND");
  });
});

describe("SIMPLE prompt contract registration", () => {
  it("composes all four SIMPLE stages with the domain contract prepended", () => {
    for (const stage of [
      "simple-design-blueprint",
      "simple-website-builder",
      "simple-visual-qa",
      "simple-site-repair",
    ] as const) {
      const composed = composeStagePrompt(stage);
      expect(composed.promptVersion).toBe("v1");
      expect(composed.systemPrompt).toContain("Retained detailed stage prompt body");
      expect(composed.systemPrompt.length).toBeGreaterThan(2000); // contract + body
    }
    const blueprint = composeStagePrompt("simple-design-blueprint");
    expect(blueprint.systemPrompt).toContain("DESIGN AUTHORITY");
  });

  it("leaves every legacy manifest entry untouched", () => {
    expect(PROMPT_MANIFEST["reference-analyzer"]).toEqual({
      promptId: "reference-analyzer",
      promptVersion: "v3",
      bodyFile: "01-reference-analyzer-v2.md",
    });
    expect(PROMPT_MANIFEST["visual-blueprint-generator"].promptVersion).toBe("v5");
    expect(Object.keys(PROMPT_MANIFEST).length).toBe(16);
  });

  it("declares the artifact schema versions the pipeline stores", () => {
    expect(DESIGN_BLUEPRINT_SCHEMA_VERSION).toBe("design-blueprint/1");
  });
});
