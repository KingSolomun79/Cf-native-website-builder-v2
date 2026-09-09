// NANO BANANA 2 LITE SUBSTITUTION (operator GO, 2026-09-09): regression
// proofs for the SIMPLE photographic image-model swap z-image →
// nano-banana-2-lite. Implemented against the CURRENT KIE Nano Banana 2 Lite
// API reference (https://docs.kie.ai/cn/market/google/nano-banana-2-lite),
// never guessed from the z-image adapter:
//   - documented request shape: { model, callBackUrl?, input: { prompt,
//     aspect_ratio, image_urls? } } — image_urls omitted for text-to-image,
//     z-image's nsfw_checker flag is not part of the contract
//   - prompt cap 20000 chars (z-image: 1000)
//   - native aspect-ratio enum incl. 21:9 / 4:3 / 3:2 — the frozen Blueprint
//     composition ratios are used DIRECTLY where supported (no 21:9 → 16:9
//     downgrade); unsupported ratios (5:3) fall to the frozen
//     generationAspectRatio; mapping + reason recorded in provenance
//   - everything else (screen-free scene adaptation, attempt lifecycle,
//     budget gates, R2 storage) is KEEP-unchanged infrastructure

import { describe, expect, it } from "vitest";
import {
  buildKieCreateTaskRequestBody,
  buildScreenSafePhotoPrompt,
  KIE_MAX_PROMPT_CHARS,
  NANO_BANANA_MAX_PROMPT_CHARS,
  NANO_BANANA_MODEL_ID,
  NANO_BANANA_SUPPORTED_ASPECT_RATIOS,
  planKieImageRequest,
  resolveProviderAspectRatio,
  SCREEN_FREE_PHOTO_REQUIREMENT,
  TEXT_SAFE_PHOTO_NEGATIVE,
} from "../src/lib/kie-v2";
import { blueprintSlotsToImageSlots, validateDesignBlueprint } from "../src/simple-design/contracts";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";

// The SIX frozen RankForge slots verbatim from the frozen blueprint artifact
// (d8fac165 / dabc524 — R2 builds/06025a7d-74cc-4655-9718-b3a190e78f92/
// v6/design_blueprint.json): composition observation vs frozen generation
// ratio. The blueprint is NEVER mutated; the adapter maps per request.
const FROZEN_SLOTS: Array<{ id: string; compositionAspectRatio: string; generationAspectRatio: string; expectedProvider: string }> = [
  { id: "hero-team-collab", compositionAspectRatio: "21:9", generationAspectRatio: "16:9", expectedProvider: "21:9" },
  { id: "about-strategist", compositionAspectRatio: "5:3", generationAspectRatio: "16:9", expectedProvider: "16:9" },
  { id: "results-celebration", compositionAspectRatio: "5:3", generationAspectRatio: "16:9", expectedProvider: "16:9" },
  { id: "testimonial-office", compositionAspectRatio: "4:3", generationAspectRatio: "16:9", expectedProvider: "4:3" },
  { id: "newsletter-owner", compositionAspectRatio: "3:2", generationAspectRatio: "16:9", expectedProvider: "3:2" },
  { id: "contact-presentation", compositionAspectRatio: "16:9", generationAspectRatio: "16:9", expectedProvider: "16:9" },
];

// A frozen-slot-shaped brief (hero): screen-bearing wording so the test also
// proves the screen-free adaptation survives the substitution untouched.
const HERO_BRIEF =
  "Wide cinematic photo of a diverse digital agency team of four working together around laptops at a wooden table in a warm loft-style office, large windows casting soft evening light, deep purple ambient glow from screens, authentic candid documentary style, no readable text or logos on screens.";

describe("resolveProviderAspectRatio (GO §5 mapping)", () => {
  it("maps every frozen RankForge slot onto a supported provider ratio without mutating the blueprint", () => {
    for (const slot of FROZEN_SLOTS) {
      const resolved = resolveProviderAspectRatio(slot.compositionAspectRatio, slot.generationAspectRatio, "16:9");
      expect(resolved.providerAspectRatio, slot.id).toBe(slot.expectedProvider);
      expect(NANO_BANANA_SUPPORTED_ASPECT_RATIOS.has(resolved.providerAspectRatio), slot.id).toBe(true);
    }
  });

  it("uses a natively supported composition ratio DIRECTLY (no 21:9 → 16:9 downgrade)", () => {
    const resolved = resolveProviderAspectRatio("21:9", "16:9", "16:9");
    expect(resolved.providerAspectRatio).toBe("21:9");
    expect(resolved.mappingReason).toContain("natively supported");
  });

  it("falls to the frozen generationAspectRatio for an unsupported composition ratio (5:3)", () => {
    const resolved = resolveProviderAspectRatio("5:3", "16:9", "9:16");
    expect(resolved.providerAspectRatio).toBe("16:9");
    expect(resolved.mappingReason).toContain("5:3 unsupported");
    expect(resolved.mappingReason).toContain("generation ratio 16:9");
  });

  it("resorts to the numeric-nearest supported ratio only when neither blueprint ratio is supported", () => {
    const resolved = resolveProviderAspectRatio("14:9", "7:5", "1:1");
    // 14:9 ≈ 1.556 → nearest supported is 3:2 (1.5) over 16:9 (1.778).
    expect(resolved.providerAspectRatio).toBe("3:2");
    expect(resolved.mappingReason).toContain("nearest supported ratio");
  });

  it("keeps the legacy orientation bridge when no composition context exists", () => {
    const resolved = resolveProviderAspectRatio(undefined, undefined, "9:16");
    expect(resolved.providerAspectRatio).toBe("9:16");
    expect(resolved.mappingReason).toContain("legacy orientation bridge");
  });
});

describe("planKieImageRequest (single source of truth for adapter + provenance)", () => {
  it("nano-banana profile: provider ratio resolved from blueprint ratios, prompt carries the provider ratio and the screen-free clause, full brief unfitted", () => {
    const plan = planKieImageRequest(
      {
        slotId: "hero-team-collab",
        promptText: HERO_BRIEF,
        aspectRatio: "16:9",
        compositionAspectRatio: "21:9",
        generationAspectRatio: "16:9",
      },
      NANO_BANANA_MODEL_ID
    );
    expect(plan.profile).toBe("nano-banana-2-lite");
    expect(plan.model).toBe(NANO_BANANA_MODEL_ID);
    expect(plan.providerAspectRatio).toBe("21:9");
    expect(plan.compositionAspectRatio).toBe("21:9");
    expect(plan.generationAspectRatio).toBe("16:9");
    expect(plan.prompt).toContain("Aspect ratio: 21:9.");
    expect(plan.prompt).toContain(SCREEN_FREE_PHOTO_REQUIREMENT);
    expect(plan.prompt).toContain(TEXT_SAFE_PHOTO_NEGATIVE);
    // 20000-char contract: the full brief survives (no z-image squeeze).
    expect(plan.screenSafeAdaptationApplied).toBe(true);
    expect(plan.prompt).toContain("around laptops turned away from the camera");
    expect(plan.prompt.length).toBeLessThanOrEqual(NANO_BANANA_MAX_PROMPT_CHARS);
    expect(plan.prompt).not.toContain("no readable text or logos on screens"); // superseded self-policy tail stripped
  });

  it("legacy z-image profile: historical 1000-char cap and orientation-bridge ratio unchanged", () => {
    const plan = planKieImageRequest(
      { slotId: "hero-team-collab", promptText: HERO_BRIEF, aspectRatio: "16:9" },
      "z-image"
    );
    expect(plan.profile).toBe("legacy-z-image");
    expect(plan.providerAspectRatio).toBe("16:9");
    expect(plan.mappingReason).toBe("legacy orientation bridge");
    expect(plan.prompt.length).toBeLessThanOrEqual(KIE_MAX_PROMPT_CHARS);
    expect(plan.prompt).toContain(SCREEN_FREE_PHOTO_REQUIREMENT);
  });
});

describe("buildKieCreateTaskRequestBody (documented payload shapes)", () => {
  it("nano-banana-2-lite: input carries prompt + aspect_ratio only — no nsfw_checker, no image_urls", () => {
    const plan = planKieImageRequest(
      {
        slotId: "hero-team-collab",
        promptText: HERO_BRIEF,
        aspectRatio: "16:9",
        compositionAspectRatio: "21:9",
        generationAspectRatio: "16:9",
      },
      NANO_BANANA_MODEL_ID
    );
    const body = buildKieCreateTaskRequestBody(plan, "https://example.invalid/callback");
    expect(body.model).toBe("nano-banana-2-lite");
    expect(body.callBackUrl).toBe("https://example.invalid/callback");
    expect(Object.keys(body.input).sort()).toEqual(["aspect_ratio", "prompt"]);
    expect(body.input.aspect_ratio).toBe("21:9");
    expect(typeof body.input.prompt).toBe("string");
    expect(body.input).not.toHaveProperty("nsfw_checker");
    expect(body.input).not.toHaveProperty("image_urls");
  });

  it("z-image legacy: historical shape preserved (nsfw_checker retained)", () => {
    const plan = planKieImageRequest(
      { slotId: "s", promptText: HERO_BRIEF, aspectRatio: "16:9" },
      "z-image"
    );
    const body = buildKieCreateTaskRequestBody(plan, "https://example.invalid/callback");
    expect(body.model).toBe("z-image");
    expect(body.input).toHaveProperty("nsfw_checker", true);
    expect(body.input).not.toHaveProperty("image_urls");
  });
});

describe("blueprint slot bridge provenance", () => {
  it("blueprintSlotsToImageSlots carries both blueprint ratios so the adapter can map them", () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    expect(validated.valid).toBe(true);
    const blueprint = validated.value!;
    const slots = blueprintSlotsToImageSlots(blueprint);
    expect(slots.length).toBeGreaterThan(0);
    for (const [index, slot] of blueprint.imagery.imageSlots.entries()) {
      expect(slots[index].compositionAspectRatio).toBe(slot.compositionAspectRatio);
      expect(slots[index].generationAspectRatio).toBe(slot.generationAspectRatio);
    }
  });
});

describe("screen-safe prompt cap parameterization", () => {
  it("default remains the documented z-image cap; the nano cap admits the full frozen brief", () => {
    const legacy = buildScreenSafePhotoPrompt(HERO_BRIEF, "16:9");
    expect(legacy.prompt.length).toBeLessThanOrEqual(KIE_MAX_PROMPT_CHARS);
    const nano = buildScreenSafePhotoPrompt(HERO_BRIEF, "21:9", NANO_BANANA_MAX_PROMPT_CHARS);
    expect(nano.prompt).toContain(HERO_BRIEF.replace(/\s{2,}/g, " ").trim().slice(0, 80));
    expect(nano.prompt.length).toBeLessThanOrEqual(NANO_BANANA_MAX_PROMPT_CHARS);
  });
});
