import { describe, expect, it } from "vitest";
import type {
  DesignBlueprint,
  InteractionBlueprint,
  BlueprintInputs,
} from "../src/types";
import {
  detectRendererSpecificStrings,
  reviewBlueprints,
  validateBlueprints,
} from "../src/lib/blueprint-schema";
import {
  BlueprintValidationError,
  generateValidatedBlueprints,
  parseGeneratedPair,
} from "../src/lib/blueprint-generator";
import type { Env } from "../src/env.d";

function evidence(source: "capture" | "screenshot" | "client_facts" | "interaction" = "capture") {
  return { source, viewport: "desktop", selector: "main", screenshotR2Key: "k" };
}

function validDesign(): DesignBlueprint {
  return {
    schemaVersion: 1,
    source: { referenceUrl: "https://x.example", finalUrl: "https://x.example", captureManifestR2Key: "c", interactionManifestR2Key: "i", screenshotR2Key: "k" },
    layout: {
      navStyle: "sticky-horizontal",
      footerStyle: "minimal",
      gridSystem: "12-column",
      sections: [
        { id: "hero", type: "hero", role: "banner", order: 0, composition: "centered headline + cta", evidence: evidence(), confidence: 0.9 },
        { id: "features", type: "features", role: "region", order: 1, composition: "three-column cards", evidence: evidence(), confidence: 0.8 },
        { id: "cta", type: "cta", role: "region", order: 2, composition: "full-width band", evidence: evidence(), confidence: 0.8 },
      ],
    },
    typography: {
      body: { element: "body", fontFamily: "Inter", fontSize: "16px", fontWeight: "400", lineHeight: "1.5", evidence: evidence() },
      headings: [
        { element: "h1", fontFamily: "Inter", fontSize: "48px", fontWeight: "700", lineHeight: "1.1", evidence: evidence() },
        { element: "h2", fontFamily: "Inter", fontSize: "32px", fontWeight: "600", lineHeight: "1.2", evidence: evidence() },
      ],
      scale: "1.250 major-third",
    },
    colors: {
      roles: [
        { role: "background", value: "#ffffff", evidence: evidence() },
        { role: "text", value: "#111111", evidence: evidence() },
        { role: "primary", value: "#0066ff", evidence: evidence() },
      ],
    },
    spacing: { sectionPadding: "64px", rhythm: "8px base" },
    surfaces: { cards: "rounded surface with subtle border", buttons: "pill primary", inputs: "underlined" },
    imagery: { treatment: "photographic", slots: ["hero", "features"] },
    navigation: { structure: "top bar", items: ["Home", "About", "Contact"], responsiveBehavior: "collapses to menu" },
    responsive: { breakpoints: [768, 1024], changes: ["nav collapses at 768"] },
    icons: { intents: [{ slot: "features", intent: "education", evidence: evidence() }] },
    confidence: 0.85,
  };
}

function validInteraction(): InteractionBlueprint {
  return {
    schemaVersion: 1,
    source: { interactionManifestR2Key: "i" },
    interactions: [
      {
        trigger: "hover", target: "a", selector: "nav a", property: "color", duration: "150ms", easing: "ease-out",
        delay: "0s", hover: "color shifts to primary", focus: "outline visible", active: "color darkens",
        scrollBehavior: "none", reducedMotionBehavior: "instant color change, no transition", observed: true,
        evidence: evidence("interaction"), confidence: 0.8,
      },
      {
        trigger: "focus", target: "a", selector: "nav a", property: "outline", duration: "0ms", easing: "ease",
        delay: "0s", hover: "color shifts", focus: "outline visible", active: "none",
        scrollBehavior: "none", reducedMotionBehavior: "outline remains visible", observed: true,
        evidence: evidence("interaction"), confidence: 0.8,
      },
    ],
    reducedMotionStrategy: "disable all non-essential transitions; keep color and focus-indicator changes instant",
    confidence: 0.8,
  };
}

function inputs(captureStatus: "captured" | "failed" = "captured"): BlueprintInputs {
  return {
    jobId: "j1", siteId: "s1", clientSlug: "slug", styleKey: "minimalist-monochrome",
    clientFacts: { companyName: "Example", businessType: "education", businessDescription: "A school", idealClientProfile: "parents", mode: "light" },
    captureManifest: captureStatus === "captured" ? ({
      jobId: "j1", referenceUrl: "https://x.example", finalUrl: "https://x.example", overallStatus: "captured",
      viewports: [], responsiveDiffs: [], manifestR2Key: "c", capturedAt: "t",
    } as BlueprintInputs["captureManifest"]) : null,
    interactionManifest: null,
    screenshotR2Key: "k",
  };
}

const envStub = {} as Env;

describe("blueprint validation", () => {
  it("accepts a well-formed blueprint pair", () => {
    const result = validateBlueprints(validDesign(), validInteraction());
    expect(result.valid).toBe(true);
    expect(result.rendererSpecificStrings).toHaveLength(0);
  });

  it("rejects when a section lacks evidence", () => {
    const design = validDesign();
    (design.layout.sections[0] as { evidence: unknown }).evidence = { source: "bogus" };
    expect(validateBlueprints(design, validInteraction()).valid).toBe(false);
  });

  it("rejects when an interaction lacks reducedMotionBehavior", () => {
    const interaction = validInteraction();
    interaction.interactions[0].reducedMotionBehavior = "";
    const result = validateBlueprints(validDesign(), interaction);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_REDUCED_MOTION")).toBe(true);
  });

  it("rejects when reducedMotionStrategy is missing", () => {
    const interaction = validInteraction();
    interaction.reducedMotionStrategy = "";
    expect(validateBlueprints(validDesign(), interaction).valid).toBe(false);
  });

  it("flags missing color roles", () => {
    const design = validDesign();
    design.colors.roles = [{ role: "background", value: "#fff", evidence: evidence() }];
    expect(validateBlueprints(design, validInteraction()).valid).toBe(false);
  });
});

describe("renderer-specific string detection", () => {
  it("flags tailwind utility class strings", () => {
    const design = validDesign();
    design.surfaces.cards = "flex items-center gap-4 rounded-lg shadow";
    const offenders = detectRendererSpecificStrings(design);
    expect(offenders.length).toBeGreaterThan(0);
    expect(validateBlueprints(design, validInteraction()).valid).toBe(false);
  });

  it("flags style-package key names", () => {
    const design = validDesign();
    design.layout.gridSystem = "minimalist-monochrome grid";
    expect(detectRendererSpecificStrings(design).length).toBeGreaterThan(0);
  });

  it("does not flag semantic values", () => {
    expect(detectRendererSpecificStrings(validDesign())).toHaveLength(0);
  });
});

describe("blueprint review", () => {
  it("passes review for a complete accessible pair", () => {
    const issues = reviewBlueprints(validDesign(), validInteraction());
    expect(issues.filter((i) => i.severity === "major")).toHaveLength(0);
  });

  it("flags missing h1", () => {
    const design = validDesign();
    design.typography.headings = [{ element: "h2", fontFamily: "Inter", fontSize: "32px", fontWeight: "600", lineHeight: "1.2", evidence: evidence() }];
    expect(reviewBlueprints(design, validInteraction()).some((i) => i.category === "accessibility")).toBe(true);
  });

  it("flags missing focus interactions", () => {
    const interaction = validInteraction();
    interaction.interactions = interaction.interactions.filter((i) => i.trigger !== "focus");
    expect(reviewBlueprints(validDesign(), interaction).some((i) => i.message.includes("focus"))).toBe(true);
  });
});

describe("validated generation repair loop", () => {
  it("succeeds when the first attempt is valid", async () => {
    const generate = async () => ({ design: validDesign(), interaction: validInteraction(), model: "test-model" });
    const result = await generateValidatedBlueprints(envStub, inputs(), { generate, persist: async () => {} });
    expect(result.validation.valid).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.model).toBe("test-model");
  });

  it("repairs an invalid-then-valid sequence", async () => {
    let attempt = 0;
    const generate = async () => {
      attempt++;
      if (attempt === 1) {
        const design = validDesign();
        design.colors.roles = []; // invalid
        return { design, interaction: validInteraction(), model: null };
      }
      return { design: validDesign(), interaction: validInteraction(), model: null };
    };
    const result = await generateValidatedBlueprints(envStub, inputs(), { generate, persist: async () => {} });
    expect(result.attempts).toBe(2);
  });

  it("throws after the bounded repair loop when never valid", async () => {
    const generate = async () => {
      const design = validDesign();
      design.colors.roles = [];
      return { design, interaction: validInteraction(), model: null };
    };
    await expect(
      generateValidatedBlueprints(envStub, inputs(), { generate, persist: async () => {}, maxRepairAttempts: 1 })
    ).rejects.toBeInstanceOf(BlueprintValidationError);
  });
});

describe("LLM output parsing", () => {
  it("parses fenced JSON into a blueprint pair and forces schemaVersion", () => {
    const content = "```json\n" + JSON.stringify({ design: validDesign(), interaction: validInteraction() }) + "\n```";
    const parsed = parseGeneratedPair(content);
    expect(parsed.design.schemaVersion).toBe(1);
    expect(parsed.interaction.schemaVersion).toBe(1);
  });
});
