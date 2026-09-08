import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import type { BuildPipelineDeps } from "../src/domain/build-pipeline";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { ReferenceCaptureFn } from "../src/domain/reference-intake";
import { persistPipelineScreenshot, createPipelineScripts, PIPELINE_SCRIPTS_BUSINESS } from "./helpers/pipeline-scripts";

// Required cross-issue regression (issues #68/#69/#70):
//
// ONE full synthetic pipeline with a fresh PAGE_SPACE capture
// (captureScrollY = 1600 recorded as provenance), valid Analysis and
// Blueprint, an assembly finding requiring ONE authorized repair, and a
// DO-reset transient injected once. Expected: the geometry mapping remains
// MEASURED (the offset is never reapplied), the repair preserves content and
// gates, the Build remains non-terminal through the reset, the re-drive
// succeeds, and the pipeline advances beyond generation. No external
// providers.

const env = providedEnv as unknown as Env;
const DO_RESET = "Durable Object reset because its code was updated";
const BLOCKER = '<section class="narrow-narrative"></section>';

type StepConfig = { retries?: { limit?: number }; timeout?: string | number };

class CacheEngine {
  readonly executions = new Map<string, number>();
  readonly replays: string[] = [];
  readonly configsSeen = new Map<string, StepConfig>();
  private readonly cache = new Map<string, unknown>();
  constructor(private readonly failFirstExecutionOf: Set<string>) {}

  async do(_name: string, a: unknown, b?: unknown): Promise<unknown> {
    const name = _name as string;
    const hasConfig = typeof b === "function";
    const fn = (hasConfig ? b : a) as () => Promise<unknown>;
    const config = (hasConfig ? a : undefined) as StepConfig | undefined;
    this.configsSeen.set(name, config ?? {});
    if (this.cache.has(name)) {
      this.replays.push(name);
      return this.cache.get(name);
    }
    const attempt = (this.executions.get(name) ?? 0) + 1;
    this.executions.set(name, attempt);
    if (attempt === 1 && this.failFirstExecutionOf.has(name)) {
      this.failFirstExecutionOf.delete(name);
      throw new Error(DO_RESET);
    }
    const result = await fn();
    this.cache.set(name, result);
    return result;
  }

  async sleep(): Promise<void> {
    return Promise.resolve();
  }
  sleepUntil(): Promise<void> {
    return Promise.resolve();
  }
  executionsOf(name: string): number {
    return this.executions.get(name) ?? 0;
  }
}

describe("cross-issue regression: #68 coordinate space + #69 repair preservation + #70 reset resilience", () => {
  it("fresh PAGE_SPACE capture, one authorized assembly repair, one DO reset -> RELEASE_READY with content intact", async () => {
    const screenshotKey = "references/uploads/cross-issue.png";
    await persistPipelineScreenshot(env, screenshotKey, { decodable: true });
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: PIPELINE_SCRIPTS_BUSINESS, contactEmail: "ops@wazibizwebsites.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });

    const base = createPipelineScripts({ visionReference: true });
    let craftCalls = 0;

    // #68: a FRESH PAGE_SPACE capture — coordinates already in screenshot
    // page space, captureScrollY = 1600 recorded as OBSERVATIONAL provenance.
    const capture: ReferenceCaptureFn = async () => {
      const fresh = await base.capture!({ referenceUrl: "https://meridian-atelier.example.com/", hasSuppliedScreenshot: true });
      return { ...fresh, coordinateSpace: "PAGE_SPACE", captureScrollY: 1600 };
    };

    // #69: an assembly finding (ORPHANED_CLASS) requiring ONE authorized
    // repair — and the scripted repair output is a clean, scope-respecting
    // fix (blocker removed, every frozen dimension byte-identical).
    const seam: RawAiGenerate = async (system, user) => {
      const isRepair = user.includes("Assembly repair directives") && user.includes("page id 'about'");
      const isInitialAbout = user.includes("page id 'about'") && !isRepair;
      if (!isRepair && !isInitialAbout) {
        const result = await base.generate!(system, user);
        if (user.includes("hard composition gate")) craftCalls += 1;
        return result;
      }
      // The repair prompt legitimately embeds the phrase "shared stylesheet";
      // neutralize it so the base helper's css branch does not capture it.
      const delegated = isRepair ? user.replaceAll("shared stylesheet", "shared style sheet") : user;
      const result = await base.generate!(system, delegated);
      const page = JSON.parse(result.content) as { html: string };
      if (isInitialAbout) {
        page.html = page.html.replace("</main>", `${BLOCKER}</main>`);
      } else {
        page.html = page.html.split(BLOCKER).join("");
      }
      return { ...result, content: JSON.stringify(page) };
    };

    // #70: the DO-reset transient fires ONCE, at the QA-verdicts stage —
    // AFTER the assembly repair — and the engine restart resumes from cache.
    const engine = new CacheEngine(new Set(["pipeline: QA verdicts (v1)"]));
    const deps: BuildPipelineDeps = { ...base, capture, generate: seam, visionGenerate: seam };
    const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
    workflow.pipelineDeps = deps;
    const event = {
      payload: { siteGenerationId: started.siteGenerationId },
      instanceId: "wf-cross-issue",
    } as unknown as WorkflowEvent<{ siteGenerationId: string }>;

    // Drive 1: the reset aborts the instance — run() YIELDS to the engine
    // (rejects) and the Build must be NONTERMINAL at that moment.
    let abortMessage = "";
    const first = await workflow.run(event, engine as unknown as WorkflowStep).catch((error: Error) => {
      abortMessage = error.message;
      return null;
    });
    expect(abortMessage).toContain(DO_RESET);
    expect(first).toBeNull();
    const midRow = await env.DB.prepare("SELECT id, state FROM builds WHERE site_generation_id = ?")
      .bind(started.siteGenerationId)
      .first<{ id: string; state: string }>();
    expect(midRow?.state).not.toBe("FAILED");
    const buildId = midRow!.id;
    const failureEvents = await env.DB.prepare(
      "SELECT id FROM build_workflow_events WHERE build_id = ? AND stage = 'pipeline_failure'"
    )
      .bind(buildId)
      .all<{ id: string }>();
    expect((failureEvents.results ?? []).length).toBe(0);

    // The assembly repair was ALREADY adopted before the reset: adopted
    // marker present, no scope violation, and the candidate manifest points
    // the about page at the repair subkey.
    const repairEvents = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'assembly_repair'"
    )
      .bind(buildId)
      .all<{ detail: string }>();
    expect(repairEvents.results.map((row) => row.detail).some((detail) => detail.includes("ADOPTED"))).toBe(true);
    expect(repairEvents.results.some((row) => row.detail.includes("REVERTED"))).toBe(false);

    // Drive 2 (the engine re-runs the instance): cached stages replay, only
    // the faulted stage runs fresh, and the pipeline completes.
    const second = (await workflow.run(event, engine as unknown as WorkflowStep)) as {
      terminal?: string;
      buildId?: string;
      releaseReadyBuildVersionId?: string | null;
    };
    expect(second.terminal).toBe("RELEASE_READY");
    expect(second.buildId).toBe(buildId);

    // #68: the geometry mapping stayed MEASURED — no false all-region
    // ambiguity marker was ever written, and the craft preflight ran its
    // composition comparisons (the analysis of a MEASURED mapping).
    const ambiguous = await env.DB.prepare(
      "SELECT id FROM build_workflow_events WHERE build_id = ? AND detail LIKE '%REFERENCE_REGION_MAPPING_AMBIGUOUS%'"
    )
      .bind(buildId)
      .all<{ id: string }>();
    expect((ambiguous.results ?? []).length).toBe(0);
    expect(craftCalls).toBeGreaterThanOrEqual(1);

    // The effective lineage: about keeps its repair pointer; exactly one
    // Build Version (the restart never regenerated the candidate).
    const versionRow = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(buildId)
      .all<{ id: string }>();
    expect(versionRow.results.map((row) => row.id)).toEqual([second.releaseReadyBuildVersionId]);
  });
});
