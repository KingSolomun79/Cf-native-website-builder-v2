import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { BuildPipelineDeps } from "../src/domain/build-pipeline";
import type { CraftCapture } from "../src/domain/craft-preflight";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { resolveEffectivePages } from "../src/domain/site-generator";
import { storeBuildStageArtifact, getBuildStageArtifact } from "../src/domain/stage-artifacts";
import { getObject } from "../src/lib/assets";
import { createPipelineScripts, persistPipelineScreenshot, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

const env = providedEnv as unknown as Env;

// Issue #66 — effective candidate / repair assembly integrity.
//
// Production Build 282f9b9d (2026-09-07): the Home realization repair
// reassembled the candidate from BASE page artifacts, silently discarding
// the already-applied about/contact assembly-repair-1 fixes. 8 of the 9
// terminal findings (BROKEN_NAV_LINK, ORPHANED_CLASS) reintroduced
// pre-repair defects that the realization repair never touched. The repair
// must operate on the CURRENT EFFECTIVE candidate through an explicit
// lineage — never a stale base fallback.

async function startGeneration(screenshotKey: string, decodable: boolean): Promise<string> {
  await persistPipelineScreenshot(env, screenshotKey, { decodable });
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

function failingCraftCapture(): CraftCapture {
  return {
    layout: {
      finalUrl: "https://preview.example/",
      title: PIPELINE_SCRIPTS_BUSINESS,
      lang: "en",
      description: PIPELINE_SCRIPTS_BUSINESS,
      viewportMeta: "width=device-width, initial-scale=1",
      sections: [
        { order: 0, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 0, width: 1440, height: 180 }, evidenceId: null, dataRegion: "r1" },
        { order: 1, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 180, width: 1440, height: 880 }, evidenceId: null, dataRegion: "r2" },
        { order: 2, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1060, width: 1440, height: 800 }, evidenceId: null, dataRegion: "r3" },
        { order: 3, tag: "section", role: null, heading: null, text: null, bounds: { x: 0, y: 1860, width: 1440, height: 640 }, evidenceId: null, dataRegion: "r4" },
      ],
      typography: [],
      colors: { background: "rgb(250,247,242)", text: "rgb(26,26,26)", accents: [] },
      nav: [],
      images: [],
      spacing: null,
      contrastSamples: [],
      consentDetected: false,
      headline: { text: PIPELINE_SCRIPTS_BUSINESS, fontFamily: "system-ui", fontSize: "32px", bounds: { x: 1100, y: 20, width: 700, height: 90 } },
      viewportHeight: 900,
      viewportWidth: 1440,
    },
    fullPageScreenshot: new TextEncoder().encode("not-a-png-craft-attempt-1"),
    viewportWidth: 1440,
    viewportHeight: 900,
  };
}

describe("effective candidate lineage (issue #66)", () => {
  it("frozen production regression replay: assembly repairs survive the home realization repair", async () => {
    // The exact production sequence: about assembly repair (BROKEN_NAV_LINK
    // fixes applied) -> craft preflight fails on home -> home realization
    // repair reassembles the candidate. The about repair MUST survive.
    const siteGenerationId = await startGeneration("references/uploads/effective-candidate.png", true);
    const base = createPipelineScripts({ visionReference: true });

    let aboutCalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      const result = await base.generate!(system, user);
      if (user.includes("page id 'about'") && !user.includes("Assembly repair directives")) {
        aboutCalls += 1;
        const page = JSON.parse(result.content) as { html: string };
        // The broken base about: every navigation target broken, exactly the
        // findings the harness's informed assembly repair then fixes.
        page.html = page.html
          .replaceAll('href="/about"', 'href="/broken-about"')
          .replaceAll('href="/services"', 'href="/broken-services"')
          .replaceAll('href="/contact"', 'href="/broken-contact"')
          .replaceAll('href="/"', 'href="/broken-home"');
        return { ...result, content: JSON.stringify(page) };
      }
      return result;
    };

    let craftCalls = 0;
    const scripted: BuildPipelineDeps = {
      ...base,
      generate,
      // With visual inputs present the generator legitimately runs through
      // the multimodal seam — the broken-about script must wrap BOTH seams.
      visionGenerate: generate,
      craftCapture: async () => {
        craftCalls += 1;
        return craftCalls === 1 ? failingCraftCapture() : base.craftCapture();
      },
    };

    const outcome = await runBuildPipeline(env, { siteGenerationId, deps: scripted });

    // With the stale-base bug this ended HUMAN_REVIEW_REQUIRED with 8
    // phantom findings (BROKEN_NAV_LINK + ORPHANED_CLASS). The effective
    // candidate lineage keeps the applied repairs and the build releases.
    expect(outcome.terminal).toEqual("RELEASE_READY");
    expect(outcome.reasons.join("\n")).not.toContain("BROKEN_NAV_LINK");

    // The production sequence actually ran: about assembly repair, then the
    // home realization repair under its immutable subkey.
    expect(aboutCalls).toEqual(1);
    const pageSubkeys = await env.DB.prepare(
      "SELECT subkey FROM build_stage_artifacts WHERE build_id = ?1 AND kind = 'generated_page' ORDER BY subkey"
    )
      .bind(outcome.buildId)
      .all<{ subkey: string }>();
    const subkeys = (pageSubkeys.results ?? []).map((row) => row.subkey);
    expect(subkeys).toContain("about.assembly-repair-1");
    expect(subkeys).toContain("home.realization-repair-1");
    expect(craftCalls).toEqual(2);

    // The candidate manifest records the effective lineage: about keeps its
    // assembly-repair pointer; home points at the realization repair.
    const { versionIdOf } = await import("./helpers/effective-candidate-helpers");
    const versionId = await versionIdOf(env, outcome.buildId);
    const repairManifest = await getBuildStageArtifact<{ pages: Record<string, { subkey: string }>; unaffectedHashes: Array<{ pageId: string; beforeSha256: string; afterSha256: string }> }>(
      env,
      versionId,
      "candidate_manifest",
      "realization-repair-1"
    );
    expect(repairManifest).not.toBeNull();
    expect(repairManifest!.value.pages.about.subkey).toEqual("about.assembly-repair-1");
    expect(repairManifest!.value.pages.home.subkey).toEqual("home.realization-repair-1");
    expect(repairManifest!.value.unaffectedHashes.length).toEqual(3);
    for (const hash of repairManifest!.value.unaffectedHashes) {
      expect(hash.beforeSha256).toEqual(hash.afterSha256);
    }

    // §16: the frozen assembled candidate answers "which About?" from its
    // own manifest.
    const manifestRecord = await getBuildStageArtifact<{ files: unknown[]; sourceArtifacts?: Record<string, string> }>(
      env,
      versionId,
      "assembled_manifest"
    );
    expect(manifestRecord).not.toBeNull();
    expect(manifestRecord!.value.sourceArtifacts?.about).toEqual("about.assembly-repair-1");
    expect(manifestRecord!.value.sourceArtifacts?.home).toEqual("home.realization-repair-1");

    // The about page FROZEN into the version is the repaired one (its broken
    // base never reaches the candidate).
    const aboutKey = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_id = ?1 AND kind = 'generated_page' AND subkey = 'about.assembly-repair-1'"
    )
      .bind(outcome.buildId)
      .first<{ artifact_r2_key: string }>();
    const body = await getObject(env, aboutKey!.artifact_r2_key);
    const aboutHtml = (JSON.parse(await new Response(body!).text()) as { html: string }).html;
    expect(aboutHtml).toContain('href="/about"');
    expect(aboutHtml).not.toContain('href="/broken-about"');
  });

  it("resolveEffectivePages reconstructs pre-manifest lineage from the artifact namespace", async () => {
    const screenshotKey = "references/uploads/effective-resolver.png";
    await persistPipelineScreenshot(env, screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const buildVersionId = created.buildVersionId;

    // A pre-manifest version: base pages + one superseding assembly repair.
    for (const pageId of ["home", "about", "services", "contact"]) {
      await storeBuildStageArtifact(env, {
        buildId: created.buildId, buildVersionId, siteGenerationId: started.siteGenerationId,
        kind: "generated_page", subkey: pageId, schemaVersion: `generated-source/page-${pageId}/1`,
        value: { html: `<!DOCTYPE html><html lang="en"><head><title>${pageId}</title></head><body>${pageId}</body></html>` },
      });
    }
    await storeBuildStageArtifact(env, {
      buildId: created.buildId, buildVersionId, siteGenerationId: started.siteGenerationId,
      kind: "generated_shared_source", subkey: "site.css", schemaVersion: "generated-source/site-css/1",
      value: { css: "/* shared css */ body{margin:0}" },
    });
    await storeBuildStageArtifact(env, {
      buildId: created.buildId, buildVersionId, siteGenerationId: started.siteGenerationId,
      kind: "generated_shared_source", subkey: "site.js", schemaVersion: "generated-source/site-js/1",
      value: { js: "// shared js" },
    });
    await storeBuildStageArtifact(env, {
      buildId: created.buildId, buildVersionId, siteGenerationId: started.siteGenerationId,
      kind: "generated_page", subkey: "about.assembly-repair-1", schemaVersion: "generated-source/page-about/1",
      value: { html: '<!DOCTYPE html><html lang="en"><head><title>about</title></head><body>about repaired</body></html>' },
    });

    const resolved = await resolveEffectivePages(env, buildVersionId);
    expect(resolved.lineage).toEqual("reconstructed/assembly-repair-namespace");
    expect(resolved.pages.about.subkey).toEqual("about.assembly-repair-1");
    expect(resolved.pages.home.subkey).toEqual("home");
    expect(resolved.sharedCss.subkey).toEqual("site.css");
  });

  it("resolveEffectivePages prefers the explicit candidate manifest", async () => {
    const screenshotKey = "references/uploads/effective-manifest.png";
    await persistPipelineScreenshot(env, screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });

    await storeBuildStageArtifact(env, {
      buildId: created.buildId, buildVersionId: created.buildVersionId, siteGenerationId: started.siteGenerationId,
      kind: "candidate_manifest", schemaVersion: "candidate-manifest/1",
      value: {
        schemaVersion: "candidate-manifest/1",
        lineage: "initial-generation",
        pages: {
          home: { subkey: "home", checksum: "a" },
          about: { subkey: "about.assembly-repair-1", checksum: "b" },
          services: { subkey: "services", checksum: "c" },
          contact: { subkey: "contact", checksum: "d" },
        },
        sharedCss: { subkey: "site.css", checksum: "e" },
        sharedJs: { subkey: "site.js", checksum: "f" },
      },
    });

    const resolved = await resolveEffectivePages(env, created.buildVersionId);
    expect(resolved.lineage).toEqual("manifest/initial-generation");
    expect(resolved.pages.about.subkey).toEqual("about.assembly-repair-1");
    expect(resolved.pages.about.checksum).toEqual("b");
  });
});
