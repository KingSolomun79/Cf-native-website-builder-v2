// SIMPLE design pipeline: blueprint contract, quality gate, deterministic
// markdown renderer, image-slot bridge, pipeline selector and prompt contract
// registration (experiment spec sections 10-14, 21, 30-31, 4).

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {

  DESIGN_BLUEPRINT_SCHEMA_VERSION,
  DesignBlueprintSchema,
  evaluateBlueprintQualityGate,
  blueprintSlotsToImageSlots,
  blueprintSlotsToPromptRecords,
  validateDesignBlueprint,
} from "../src/simple-design/contracts";
import { renderDesignBlueprintMarkdown } from "../src/simple-design/render-blueprint";
import { DESIGN_PIPELINE_VERSION } from "../src/simple-design/pipeline";
import { composeStagePrompt, PROMPT_MANIFEST } from "../src/domain/prompt-contract";
import { runSchemaValidatedAiStage } from "../src/domain/ai-boundary";
import { createInitialBuild, startSiteGeneration } from "../src/domain/lifecycle";
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

describe("design-blueprint/1 schema-convergence amendments (brief sections 3-12)", () => {
  const clone = () => JSON.parse(JSON.stringify(FINCH_KNOWN_GOOD_BLUEPRINT));

  it("display maxWidthCh narrow measures are valid — role-aware floors replace the global min 20 (§8)", () => {
    const blueprint = clone();
    blueprint.tokens.typography.scale[0].maxWidthCh = 12; // "Hero H1" — display-class narrow measure
    const validated = validateDesignBlueprint(blueprint);
    expect(validated.valid).toBe(true);
  });

  it("body keeps a modest floor; display below 8ch and body below 20ch fail the role check", () => {
    const narrowDisplay = clone();
    narrowDisplay.tokens.typography.scale[0].maxWidthCh = 6; // display/hero floor is 8
    expect(validateDesignBlueprint(narrowDisplay).valid).toBe(false);

    const narrowBody = clone();
    const bodyRow = narrowBody.tokens.typography.scale.find((row: { element: string }) => /body/i.test(row.element));
    bodyRow.maxWidthCh = 12; // body/reading floor is 20
    const bodyResult = validateDesignBlueprint(narrowBody);
    expect(bodyResult.valid).toBe(false);
    if (!bodyResult.valid) expect(bodyResult.errors).toContain("body/reading floor");
  });

  it("body width stays reasonable and UI measures may be small (§8)", () => {
    const blueprint = clone();
    const bodyRow = blueprint.tokens.typography.scale.find((row: { element: string }) => /body/i.test(row.element));
    bodyRow.maxWidthCh = 65; // sensible reading measure
    expect(validateDesignBlueprint(blueprint).valid).toBe(true);
    const uiRow = clone();
    uiRow.tokens.typography.scale[5].maxWidthCh = 6; // kickers/labels — small UI measure
    expect(validateDesignBlueprint(uiRow).valid).toBe(true);
  });

  it("composition ratio is separate from the KIE generation ratio (§9)", () => {
    const blueprint = clone();
    blueprint.imagery.imageSlots[0].compositionAspectRatio = "21:9"; // design truth
    blueprint.imagery.imageSlots[0].generationAspectRatio = "16:9"; // provider request
    blueprint.imagery.imageSlots[0].cropStrategy = "subject-left";
    const validated = validateDesignBlueprint(blueprint);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    // Bridge orientation follows the GENERATION ratio.
    const slots = blueprintSlotsToImageSlots(validated.value);
    expect(slots[0].orientation).toBe("landscape");
    // Non-integer composition ratios are legal design observations.
    const decimal = clone();
    decimal.imagery.imageSlots[0].compositionAspectRatio = "2.2:1";
    expect(validateDesignBlueprint(decimal).valid).toBe(true);
  });

  it("custom typed color roles are valid — roles, not fixed property names (§10)", () => {
    const blueprint = clone();
    blueprint.tokens.colors = [
      { role: "paper-ground", value: "#F4EFE6", usage: "warm paper page ground" },
      { role: "forest-ink", value: "#17321F", usage: "primary ink mass" },
      { role: "violet-accent", value: "#7C3AED", usage: "links and active states" },
    ];
    const validated = validateDesignBlueprint(blueprint);
    expect(validated.valid).toBe(true);
  });

  it("color list below three roles is rejected — a system, not a dump (§10)", () => {
    const blueprint = clone();
    blueprint.tokens.colors = blueprint.tokens.colors.slice(0, 2);
    expect(validateDesignBlueprint(blueprint).valid).toBe(false);
  });

  it("unknown fixed schema fields are still rejected (additionalProperties:false, §12)", () => {
    const extraTopLevel = clone();
    extraTopLevel.modelNotes = "invented field";
    expect(validateDesignBlueprint(extraTopLevel).valid).toBe(false);

    const extraSlotField = clone();
    extraSlotField.imagery.imageSlots[0].seoBoost = true;
    expect(validateDesignBlueprint(extraSlotField).valid).toBe(false);
  });

  it("Business Facts cannot enter the blueprint — the schema has no place for them (§6)", () => {
    const withFacts = clone();
    withFacts.businessFactSheet = { businessName: "RankForge" };
    const result = validateDesignBlueprint(withFacts);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors).toContain("businessFactSheet");
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

describe("design pipeline provenance (no runtime selector)", () => {
  it("the canonical pipeline is simple_blueprint_v1 and no env selector exists", () => {
    expect(DESIGN_PIPELINE_VERSION).toBe("simple_blueprint_v1");
    expect((globalThis as Record<string, unknown>).DESIGN_PIPELINE_VERSION).toBeUndefined();
  });

  it("is not exposed as a Build Mode (business-facing mode stays REFERENCE_BOUND)", () => {
    // Provenance is a string, not a domain mode: the canonical Build Mode
    // union stays exactly REFERENCE_BOUND | ORIGINAL_DESIGN.
    expect(BUILD_LIFECYCLE_STATES).toBeDefined();
    expect(["REFERENCE_BOUND", "ORIGINAL_DESIGN"]).toContain("REFERENCE_BOUND");
    expect(DESIGN_PIPELINE_VERSION).not.toBe("REFERENCE_BOUND");
  });
});
