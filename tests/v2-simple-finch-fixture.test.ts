// Known-good Blueprint builder test (experiment spec section 61): given the
// Finch-format Design Blueprint as a FIXED fixture, the new Website Builder
// produces a high-quality coherent four-page bundle that passes the
// deterministic truth + technical contract and ASSEMBLES through the shared
// KEEP-list assembly path — the builder-quality seam of the experiment,
// independent of Reference analysis.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { buildAssembledCandidate } from "../src/domain/assembly";
import { putObject } from "../src/lib/assets";
import { runDeterministicBundleQa } from "../src/simple-design/bundle-qa";
import { runSimpleWebsiteBuilderStage } from "../src/simple-design/website-builder";
import { renderDesignBlueprintMarkdown } from "../src/simple-design/render-blueprint";
import {
  blueprintSlotsToImageSlots,
  blueprintSlotsToPromptRecords,
  validateDesignBlueprint,
  type SiteBundle,
} from "../src/simple-design/contracts";
import { createSimpleScripts, persistSimpleScreenshot } from "./helpers/simple-scripts";
import { FINCH_KNOWN_GOOD_BLUEPRINT } from "./_generated-simple-finch";

const env = providedEnv as unknown as Env;

const ENDPOINT = "https://test.example.com/api/v2/forms/submit";
const FACTS = {
  businessName: "Savannah Hearth Camps",
  contactEmail: "stay@savannahhearth.example",
  businessType: "Luxury tented safari camp",
  businessDescription: "A small luxury tented camp with golden-season visits and quiet evenings.",
};

describe("known-good Blueprint builder test (spec section 61)", () => {
  it("the Website Builder turns the fixed blueprint into a valid, truth-clean bundle", async () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    expect(validated.valid).toBe(true);
    if (!validated.valid) return;
    const blueprint = validated.value;

    // Real Build scaffold so the immutable artifact store accepts the bundle.
    await persistSimpleScreenshot(env, "references/simple/finch-ref.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS,
        reference: { screenshotR2Key: "references/simple/finch-ref.png" },
      },
    });
    const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const versionRow = await env.DB
      .prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(build.buildId)
      .first<{ id: string }>();
    expect(versionRow).not.toBeNull();

    const scripts = createSimpleScripts();
    const built = await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: build.buildId,
      buildVersionId: versionRow!.id,
      buildVersionNumber: 1,
      blueprint,
      facts: FACTS,
      acceptedImages: blueprint.imagery.imageSlots.map((slot) => ({
        slotId: slot.id,
        altText: slot.altText,
        aspectRatio: slot.generationAspectRatio,
        page: slot.page,
        ...(slot.section ? { section: slot.section } : {}),
      })),
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:finch-fixture",
      visualInputs: [
        { kind: "full-page", artifact: "references/simple/finch-ref.png", sha256: "fixture-sha", width: 1440, height: 3200 },
      ],
      visionGenerate: scripts.visionGenerate,
    });

    expect(built.strategy).toBe("ONE_CALL");
    const bundle: SiteBundle = built.bundle;
    expect(Object.keys(bundle.pages).sort()).toEqual(["about", "contact", "home", "services"]);
    expect(bundle.sharedCss).toContain(":focus-visible");
    expect(bundle.sharedCss).toContain("prefers-reduced-motion");

    // Deterministic truth + technical contract passes on the bundle.
    const slotIds = new Set(blueprint.imagery.imageSlots.map((slot) => slot.id));
    const qa = runDeterministicBundleQa({
      bundle,
      blueprint,
      facts: FACTS,
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:finch-fixture",
      slotIds,
      resolvedSlotIds: slotIds,
      renderEvidence: { capturesRendered: 9, mobileCaptured: true, failedRequestCount: 0 },
    });
    expect(qa.truthFindings).toEqual([]);
    expect(qa.technicalBlockerCount).toBe(0);
    for (const [gateId, passed] of Object.entries(qa.gates)) {
      expect(passed, `gate ${gateId}`).toBe(true);
    }
  });

  it("assembles through the shared KEEP-list assembly path with real accepted image bytes", async () => {
    const validated = validateDesignBlueprint(FINCH_KNOWN_GOOD_BLUEPRINT);
    if (!validated.valid) return;
    const blueprint = validated.value;
    const scripts = createSimpleScripts();

    await persistSimpleScreenshot(env, "references/simple/finch-assembly-ref.png");
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: FACTS,
        reference: { screenshotR2Key: "references/simple/finch-assembly-ref.png" },
      },
    });
    const build = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const versionRow = (await env.DB
      .prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number DESC LIMIT 1")
      .bind(build.buildId)
      .first<{ id: string }>())!;

    const built = await runSimpleWebsiteBuilderStage(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: build.buildId,
      buildVersionId: versionRow.id,
      buildVersionNumber: 1,
      blueprint,
      facts: FACTS,
      acceptedImages: blueprint.imagery.imageSlots.map((slot) => ({
        slotId: slot.id,
        altText: slot.altText,
        aspectRatio: slot.generationAspectRatio,
        page: slot.page,
        ...(slot.section ? { section: slot.section } : {}),
      })),
      formServiceEndpoint: ENDPOINT,
      siteFormId: "site:finch-fixture",
      visualInputs: [
        { kind: "full-page", artifact: "references/simple/finch-assembly-ref.png", sha256: "fixture-sha", width: 1440, height: 3200 },
      ],
      visionGenerate: scripts.visionGenerate,
    });

    // Real image bytes per slot so assembly resolves every placeholder.
    const acceptedImages = new Map<string, string>();
    for (const slot of blueprint.imagery.imageSlots) {
      const key = `fixtures/simple-images/${slot.id}.webp`;
      await putObject(env, key, new TextEncoder().encode(`WEBP-fixture-${slot.id}`));
      acceptedImages.set(slot.id, key);
    }

    const candidate = await buildAssembledCandidate(env, {
      siteGenerationId: started.siteGenerationId,
      buildId: build.buildId,
      buildVersionId: versionRow.id,
      buildVersionNumber: 1,
      pages: built.bundle.pages,
      sharedCss: built.bundle.sharedCss,
      sharedJs: built.bundle.sharedJs,
      imagePlanSlots: blueprintSlotsToImageSlots(blueprint),
      acceptedImages,
      formServiceEndpoint: ENDPOINT,
      expectedSiteFormId: "site:finch-fixture",
    });
    expect(candidate.files.has("index.html")).toBe(true);
    expect(candidate.files.has("site.css")).toBe(true);
    expect(candidate.files.has("site.js")).toBe(true);
    expect(candidate.files.has(`assets/images/${blueprint.imagery.imageSlots[0].id}.webp`)).toBe(true);
    expect(candidate.artifactManifestHash).toBeTruthy();
    // The placeholder convention survived: bundled pages reference real asset paths.
    const indexHtml = new TextDecoder().decode(candidate.files.get("index.html")!);
    expect(indexHtml).not.toContain("IMG:");
    expect(indexHtml).toContain("assets/images/");
  });

  it("markdown handoff is readable and stable for the fixed blueprint", () => {
    const markdown = renderDesignBlueprintMarkdown(FINCH_KNOWN_GOOD_BLUEPRINT);
    expect(markdown).toContain("## 06 · Home — Section Spec");
    expect(markdown).toContain("Signature Design Elements");
    expect(markdown).not.toContain("sourceTraitId");
    expect(markdown).not.toContain("obligation");
    expect(markdown.split("\n").length).toBeGreaterThan(120);
    // Deterministic: same input, byte-identical output.
    expect(renderDesignBlueprintMarkdown(FINCH_KNOWN_GOOD_BLUEPRINT)).toBe(markdown);
    void blueprintSlotsToPromptRecords;
  });
});
