import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { createPipelineScripts } from "./helpers/pipeline-scripts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import { encodePng } from "../src/lib/png-codec";
import { putObject } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

// Issue #43 — the generator SEES the reference it must faithfully realize:
// every visual-output generation step (shared CSS/JS + all four pages)
// receives the attached normalized reference image via the vision path, the
// reference content-isolation clause, and reference-fidelity-over-convention
// authority. Without visual inputs (ORIGINAL_DESIGN / undecodable evidence)
// prompts are unchanged. The CSS step also receives the identity blueprint
// fields it previously omitted (signatureTraits, homepageRegions, thesis,
// first viewport).

const env = providedEnv as unknown as Env;

async function structuredPagePng(): Promise<Uint8Array> {
  const width = 1024;
  const height = 1560;
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3;
      if (y < 560) {
        rgb[at] = 245; rgb[at + 1] = 242; rgb[at + 2] = 235;
      } else if (y < 940) {
        const wave = (x * 5 + y * 11) % 80;
        rgb[at] = 40 + wave; rgb[at + 1] = 40 + ((wave * 2) % 170); rgb[at + 2] = 40 + wave;
      } else {
        rgb[at] = 26; rgb[at + 1] = 26; rgb[at + 2] = 26;
      }
    }
  }
  return encodePng({ width, height, rgb });
}

async function startGeneration(screenshotKey: string, decodable: boolean): Promise<string> {
  await putObject(env, screenshotKey, decodable ? await structuredPagePng() : new Uint8Array(buildPng({ width: 1440, height: 3200 })));
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Visual Context Co", contactEmail: "vc@context.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

function promptCollecting(scripts: ReturnType<typeof createPipelineScripts>, collected: string[]): RawAiGenerate {
  return async (system, user, attempt) => {
    collected.push(user);
    return scripts.generate!(system, user, attempt);
  };
}

const GENERATION_MARKERS = ["shared stylesheet", "minimal shared runtime", "page id 'home'", "page id 'about'", "page id 'services'", "page id 'contact'"];

describe("generator visual-reference context (issue #43)", () => {
  it("with decodable evidence every generation prompt carries the attached reference context, isolation and fidelity authority", async () => {
    const siteGenerationId = await startGeneration(`references/uploads/vc-${Math.random().toString(36).slice(2)}.png`, true);
    const scripts = createPipelineScripts();
    const prompts: string[] = [];
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: { ...scripts, generate: promptCollecting(scripts, prompts), visionGenerate: promptCollecting(scripts, prompts) },
    });
    expect(outcome.terminal).toBe("RELEASE_READY");

    for (const marker of GENERATION_MARKERS) {
      const prompt = prompts.find((candidate) => candidate.includes(marker));
      expect(prompt, `prompt for ${marker}`).toBeDefined();
      expect(prompt).toContain("REFERENCE VISUAL CONTEXT");
      expect(prompt).toContain("DO NOT copy from the Reference");
      expect(prompt).toContain("REFERENCE FIDELITY OVERRIDES GENERIC CONVENTION");
      expect(prompt).toContain('"kind":"full-page"');
    }

    // Provenance records the visual input artifacts for generator stages.
    const run = await env.DB.prepare(
      "SELECT input_artifact_ids_json FROM ai_stage_runs WHERE build_id = ? AND prompt_id = 'website-generator' LIMIT 1"
    )
      .bind(outcome.buildId)
      .first<{ input_artifact_ids_json: string }>();
    const artifacts = JSON.parse(run!.input_artifact_ids_json) as string[];
    expect(artifacts.some((artifact) => artifact.includes("reference/visual/"))).toBe(true);
  });

  it("the CSS step now receives the identity blueprint fields (issue #43 regression)", async () => {
    const siteGenerationId = await startGeneration(`references/uploads/vc2-${Math.random().toString(36).slice(2)}.png`, true);
    const scripts = createPipelineScripts();
    const prompts: string[] = [];
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: { ...scripts, generate: promptCollecting(scripts, prompts), visionGenerate: promptCollecting(scripts, prompts) },
    });
    expect(outcome.terminal).toBe("RELEASE_READY");
    const cssPrompt = prompts.find((candidate) => candidate.includes("shared stylesheet"))!;
    expect(cssPrompt).toContain('"signatureTraits"');
    expect(cssPrompt).toContain('"homepageRegions"');
    expect(cssPrompt).toContain('"visualThesis"');
    expect(cssPrompt).toContain('"homepageFirstViewport"');
  });

  it("without visual inputs the generation prompts are unchanged (ORIGINAL_DESIGN semantics)", async () => {
    const siteGenerationId = await startGeneration(`references/uploads/vc3-${Math.random().toString(36).slice(2)}.png`, false);
    const scripts = createPipelineScripts();
    const prompts: string[] = [];
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      deps: { ...scripts, generate: promptCollecting(scripts, prompts) },
    });
    expect(outcome.terminal).toBe("RELEASE_READY");
    const homePrompt = prompts.find((candidate) => candidate.includes("page id 'home'"))!;
    expect(homePrompt).not.toContain("REFERENCE VISUAL CONTEXT");
  });
});
