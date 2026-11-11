// Blueprint reuse on revision + bounded improving repair rounds (operator GO
// 2026-11-09). A revision whose note does not request a redesign reuses the
// parent Build's accepted Design Blueprint and Accepted Images instead of
// re-rolling the design authority — live evidence 2026-11-02..06 showed
// regeneration turning careful fix notes into fidelity-0 rebuilds. The repair
// loop runs up to 3 rounds, each on a new immutable Build Version, and stops
// early when the visual score stops improving.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { createRevisionBuild } from "../src/domain/revision";
import { runBuildPipeline } from "../src/domain/build-pipeline";
import { revisionRequestsRedesign } from "../src/simple-design/pipeline";
import { createSimpleScripts } from "./helpers/simple-scripts";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";

const env = providedEnv as unknown as Env;

const CREATIVE_DIRECTION = {
  direction: "Sun-baked editorial minimalism: warm plaster surfaces, oversized serif display type, close-crop photography breaking the container edge",
  audience: "Design-conscious homeowners planning full renovations",
  conversionGoal: "Project enquiries",
  preferredPalette: "Terracotta #C4552D on warm off-white #F7F2EA, ink #26201B",
  tone: "Calm, assured, craft-led",
  avoidances: "No generic three-card feature rows, no purple gradients",
};

function originalPayload(): Record<string, unknown> {
  return {
    buildMode: "ORIGINAL_DESIGN",
    facts: {
      businessName: "Terra & Beam Studio",
      contactEmail: "studio@terrabeam.example",
      businessType: "Architecture and interior renovation studio",
      businessDescription: "A small studio designing warm, modern renovations for family homes.",
      ...(canonicalStructuredFacts()),
    },
    creativeDirection: CREATIVE_DIRECTION,
  };
}

async function startGeneration() {
  return await startSiteGeneration(env, { payload: originalPayload() });
}

describe("revisionRequestsRedesign (operator GO 2026-11-09)", () => {
  it("detects unmistakable redesign language and treats realization fixes as non-redesigns", () => {
    expect(revisionRequestsRedesign("start afresh")).toBe(true);
    expect(revisionRequestsRedesign("Please start over with a different concept")).toBe(true);
    expect(revisionRequestsRedesign("completely different look")).toBe(true);
    expect(revisionRequestsRedesign("Redesign the site")).toBe(true);
    expect(revisionRequestsRedesign(undefined)).toBe(false);
    expect(revisionRequestsRedesign("Fix the horizontal overflow, centre the content in a container, and make the cards equal height")).toBe(false);
    expect(revisionRequestsRedesign("Add a How it works section and an FAQ")).toBe(false);
  });
});

describe("revision blueprint reuse (operator GO 2026-11-09)", () => {
  it("a revision WITHOUT a redesign note reuses the parent Build's accepted blueprint and accepted images — no regeneration call", async () => {
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    const first = await runBuildPipeline(env, { siteGenerationId, buildId: initial.buildId, deps: createSimpleScripts() });
    expect(first.terminal).toBe("RELEASE_READY");

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: {} }, requestNote: "Fix the layout defects from the previous build: centre the content and equalize card heights" },
    });
    const outcome = await runBuildPipeline(env, { siteGenerationId, buildId: revision.buildId, deps: createSimpleScripts() });
    expect(outcome.terminal).toBe("RELEASE_READY");

    // NO blueprint generation ran on the revision build.
    const revisionBlueprintRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage IN ('simple-design-blueprint', 'simple-original-design-blueprint')"
    )
      .bind(revision.buildId)
      .first<{ n: number }>();
    expect(revisionBlueprintRuns!.n).toBe(0);

    // The reuse is recorded as a canonical workflow event.
    const events = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'simple_design_blueprint'"
    )
      .bind(revision.buildId)
      .all<{ detail: string }>();
    expect(events.results.some((event) => event.detail.includes("Reused the parent Build's accepted Design Blueprint"))).toBe(true);

    // The revision's version carries the SAME blueprint artifact as the
    // parent's (identical content checksum; values live in R2).
    const blueprintRows = await env.DB.prepare(
      `SELECT v.build_id AS build_id, a.checksum AS checksum
       FROM build_versions v
       JOIN build_stage_artifacts a ON a.build_version_id = v.id AND a.kind = 'design_blueprint'
       WHERE v.build_id IN (?, ?) AND v.version_number = 1`
    )
      .bind(initial.buildId, revision.buildId)
      .all<{ build_id: string; checksum: string }>();
    const parentBlueprint = blueprintRows.results.find((row) => row.build_id === initial.buildId)?.checksum;
    const revisionBlueprint = blueprintRows.results.find((row) => row.build_id === revision.buildId)?.checksum;
    expect(parentBlueprint).toBeTruthy();
    expect(revisionBlueprint).toBe(parentBlueprint);

    // Accepted Images transferred to the revision's version (no KIE re-spend).
    const imageCounts = await env.DB.prepare(
      `SELECT v.build_id AS build_id, COUNT(i.slot_id) AS n
       FROM build_versions v
       LEFT JOIN accepted_images i ON i.build_version_id = v.id
       WHERE v.build_id IN (?, ?) AND v.version_number = 1
       GROUP BY v.build_id`
    )
      .bind(initial.buildId, revision.buildId)
      .all<{ build_id: string; n: number }>();
    const parentImages = imageCounts.results.find((row) => row.build_id === initial.buildId)?.n ?? 0;
    const revisionImages = imageCounts.results.find((row) => row.build_id === revision.buildId)?.n ?? 0;
    expect(parentImages).toBeGreaterThan(0);
    expect(revisionImages).toBe(parentImages);
  });

  it("an explicit redesign note regenerates the blueprint WITH the note riding the call", async () => {
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    await runBuildPipeline(env, { siteGenerationId, buildId: initial.buildId, deps: createSimpleScripts() });

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: {} }, requestNote: "start afresh: a completely different design direction" },
    });

    const capturedPrompts: string[] = [];
    const base = createSimpleScripts();
    const deps = {
      ...base,
      generate: (async (system: string, user: string, attempt: number) => {
        capturedPrompts.push(user);
        return base.generate!(system, user, attempt);
      }) as typeof base.generate,
    };
    const outcome = await runBuildPipeline(env, { siteGenerationId, buildId: revision.buildId, deps });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const revisionBlueprintRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-original-design-blueprint'"
    )
      .bind(revision.buildId)
      .first<{ n: number }>();
    expect(revisionBlueprintRuns!.n).toBeGreaterThan(0);

    const blueprintPrompt = capturedPrompts.find((prompt) => prompt.includes("Invent the Original Design Blueprint"));
    expect(blueprintPrompt).toBeDefined();
    expect(blueprintPrompt!).toContain("HUMAN REVISION INSTRUCTION");
    expect(blueprintPrompt!).toContain("start afresh");
  });
});

describe("bounded improving repair rounds (operator GO 2026-11-09)", () => {
  it("improving rounds continue until release: 70 → 85 → 91 releases after TWO repair rounds on THREE versions", async () => {
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: initial.buildId,
      deps: createSimpleScripts({ visualQaOverallSequence: [70, 85, 91] }),
    });
    expect(outcome.terminal).toBe("RELEASE_READY");

    const versions = await env.DB.prepare(
      "SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
    )
      .bind(initial.buildId)
      .all<{ version_number: number }>();
    expect(versions.results.map((version) => version.version_number)).toEqual([1, 2, 3]);

    const repairRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-site-repair'"
    )
      .bind(initial.buildId)
      .first<{ n: number }>();
    expect(repairRuns!.n).toBe(2);

    const events = await env.DB.prepare(
      "SELECT stage, detail FROM build_workflow_events WHERE build_id = ? ORDER BY created_at, id"
    )
      .bind(initial.buildId)
      .all<{ stage: string; detail: string }>();
    expect(events.results.some((event) => event.stage === "simple_repair" && event.detail.includes("Repair round 1/3 applied"))).toBe(true);
    expect(events.results.some((event) => event.stage === "simple_repair" && event.detail.includes("Repair round 2/3 applied"))).toBe(true);
    expect(events.results.some((event) => event.stage === "simple_final_qa" && event.detail.includes("Final QA passed after repair round 2"))).toBe(true);
  });

  it("a non-improving round stops the loop after ONE round — HUMAN_REVIEW_REQUIRED, no third call", async () => {
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: initial.buildId,
      deps: createSimpleScripts({ visualQaOverallSequence: [70, 70] }),
    });
    expect(outcome.terminal).toBe("HUMAN_REVIEW_REQUIRED");

    const repairRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-site-repair'"
    )
      .bind(initial.buildId)
      .first<{ n: number }>();
    expect(repairRuns!.n).toBe(1);

    const events = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'simple_final_qa'"
    )
      .bind(initial.buildId)
      .all<{ detail: string }>();
    expect(events.results.some((event) => event.detail.includes("did not improve (70 → 70)"))).toBe(true);
  });

  it("the repair brief carries the structural-defect rule and every routed page's render (multimodal sight)", async () => {
    const repairPrompts: string[] = [];
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });
    const outcome = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: initial.buildId,
      deps: createSimpleScripts({ visualQaOverallSequence: [70, 93], captureRepairPrompts: repairPrompts }),
    });
    expect(outcome.terminal).toBe("RELEASE_READY");
    expect(repairPrompts.length).toBe(1);
    const prompt = repairPrompts[0];
    expect(prompt).toContain("STRUCTURAL REPAIR REQUIRED");
    expect(prompt).toContain("visual fidelity is 70");
    expect(prompt).toContain("CANDIDATE home desktop current render");
    expect(prompt).toContain("CANDIDATE about desktop current render");
    expect(prompt).toContain("CANDIDATE services desktop current render");
    expect(prompt).toContain("CANDIDATE contact desktop current render");
    expect(prompt).toContain("never a CSS-only patch for an HTML-structure defect");
  });
});

describe("engine-restart resume safety (found live 2026-11-11, build c1bdb659)", () => {
  it("a resumed invocation whose steps replay from cache WITHOUT executing keeps ORIGINAL_DESIGN visual QA on the original-design path (no REFERENCE_BOUND misbranch)", async () => {
    const { siteGenerationId } = await startGeneration();
    const initial = await createInitialBuild(env, { siteGenerationId });

    // Engine-faithful step cache: records each SUCCEEDED step's output; a
    // resumed invocation replays recorded outputs without running callbacks
    // (exactly what the Cloudflare Workflows engine does after a restart).
    const stepCache = new Map<string, unknown>();
    const recordingStep = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
      const result = await fn();
      stepCache.set(name, result);
      return result;
    };
    const replayingStep = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
      if (stepCache.has(name)) return stepCache.get(name) as T;
      const result = await fn();
      stepCache.set(name, result);
      return result;
    };

    // Invocation 1: transient crash INSIDE the builder step (engine-style:
    // the step failed, so it is NOT cached; everything before it is). The
    // pipeline rethrows the transient error exactly as the workflow instance
    // would die.
    const crashingScripts = createSimpleScripts();
    const originalGenerate = crashingScripts.generate!;
    let crashed = false;
    const crashing: typeof crashingScripts = {
      ...crashingScripts,
      generate: async (system, user, attempt) => {
        if (user.includes("Realize the \"home\" page")) {
          crashed = true;
          throw new Error("simulated isolate eviction mid-builder");
        }
        return originalGenerate(system, user, attempt);
      },
    };
    await expect(
      runBuildPipeline(env, { siteGenerationId, buildId: initial.buildId, deps: { ...crashing, step: recordingStep as never } })
    ).rejects.toThrow("simulated isolate eviction mid-builder");
    expect(crashed).toBe(true);

    // Invocation 2 (same Build — the resumed instance): intake/blueprint
    // steps replay from cache WITHOUT their callbacks running. Pre-fix, the
    // ORIGINAL_DESIGN intake callback was the ONLY place creativeContext was
    // set, so visual QA misbranched to REFERENCE_BOUND and threw "requires
    // Reference visual inputs"; post-fix the context derives outside the
    // cached step on every invocation and the build releases.
    const resumed = await runBuildPipeline(env, {
      siteGenerationId,
      buildId: initial.buildId,
      deps: { ...createSimpleScripts(), step: replayingStep as never },
    });
    expect(resumed.terminal).toBe("RELEASE_READY");

    const visualRuns = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ? AND stage = 'simple-original-design-visual-qa'"
    )
      .bind(initial.buildId)
      .first<{ n: number }>();
    expect(visualRuns!.n).toBeGreaterThan(0);
  });
});
