// Deterministic stage-failure containment tests (issue #62).
//
// The 2026-09-06/07 production forensic incidents (raw REST evidence,
// .tmp-wedge-forensics/) showed deterministic assembly-validation failures
// (ORPHANED_CLASS, FABRICATED_TRUST_ENTITY) burning the full Workflow retry
// budget — 8 engine attempts over compounding delays — while re-loading the
// same frozen repair artifacts and re-deriving the same findings. The rule
// under test (#62 §7-§17):
//
//   internal authorized repair exhausted + same immutable inputs
//   + deterministic blocker remains = do not invoke Workflow retry
//
//   candidate exists -> HUMAN_REVIEW_REQUIRED with the precise findings (§8)
//   no candidate     -> Build FAILED (§9)
//   invariant violation -> NonRetryableError at the engine boundary (§10)
//   transient provider failures stay retryable (§17)

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import { startSiteGeneration } from "../src/domain/lifecycle";
import { runBuildPipeline, type BuildPipelineDeps } from "../src/domain/build-pipeline";
import { classifyStageFailure } from "../src/domain/stage-failure";
import { toWorkflowStepError, WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import { StageExecutionInProgressError, StageExecutionCollisionError } from "../src/domain/stage-execution";
import { StageArtifactError } from "../src/domain/stage-artifacts";
import { ImageBudgetExceededError } from "../src/domain/image-pipeline";
import { SiteGenerationValidationError } from "../src/domain/site-generator";
import { VisualBlueprintError } from "../src/domain/visual-blueprint";
import { AiStageSchemaInvalidError, type RawAiGenerate } from "../src/domain/ai-boundary";
import { VisionGatewayError } from "../src/lib/ai-gateway";
import { persistPipelineScreenshot, createPipelineScripts } from "./helpers/pipeline-scripts";

const env = providedEnv as unknown as Env;

// ---------------------------------------------------------------------------
// §5/§11: the explicit classification table.
// ---------------------------------------------------------------------------

describe("stage-failure classification (issue #62 §5)", () => {
  it("classifies post-repair deterministic validation failures as DETERMINISTIC_REVIEW_REQUIRED", () => {
    const findings = [{ id: "ORPHANED_CLASS", detail: "about: narrow-narrative" }];
    expect(classifyStageFailure(new SiteGenerationValidationError(findings))).toEqual("DETERMINISTIC_REVIEW_REQUIRED");
    expect(
      classifyStageFailure(new VisualBlueprintError("BLUEPRINT_IDENTITY_ERASURE", "trait erased"))
    ).toEqual("DETERMINISTIC_REVIEW_REQUIRED");
    expect(
      classifyStageFailure(new AiStageSchemaInvalidError("website-generator", "run-1", []))
    ).toEqual("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("classifies integrity/spend violations as TERMINAL_INVARIANT", () => {
    expect(classifyStageFailure(new StageExecutionCollisionError("claim corruption"))).toEqual("TERMINAL_INVARIANT");
    expect(classifyStageFailure(new ImageBudgetExceededError(3.0, 0.15, 3.0))).toEqual("TERMINAL_INVARIANT");
    expect(
      classifyStageFailure(new StageArtifactError("REPAIR_ARTIFACT_MISMATCH", "fingerprint mismatch"))
    ).toEqual("TERMINAL_INVARIANT");
  });

  it("keeps transient and unknown failures retryable (§17) — never routed to review", () => {
    expect(classifyStageFailure(new StageExecutionInProgressError("k", "2026-01-01T00:00:00.000Z"))).toEqual(
      "TRANSIENT_RETRYABLE"
    );
    expect(classifyStageFailure(new Error("temporary Zhipu outage: 503"))).toEqual("TRANSIENT_RETRYABLE");
    expect(classifyStageFailure(new VisionGatewayError([]))).toEqual("TRANSIENT_RETRYABLE");
    expect(classifyStageFailure(null)).toEqual("TRANSIENT_RETRYABLE");
  });

  it("maps non-transient classes to NonRetryableError at the engine boundary and leaves transients untouched", () => {
    const findings = [{ id: "ORPHANED_CLASS", detail: "about: narrow-narrative" }];
    expect(toWorkflowStepError(new SiteGenerationValidationError(findings))).toBeInstanceOf(NonRetryableError);
    expect(toWorkflowStepError(new AiStageSchemaInvalidError("website-generator", "run-1", []))).toBeInstanceOf(
      NonRetryableError
    );
    expect(toWorkflowStepError(new StageExecutionCollisionError("mismatch"))).toBeInstanceOf(NonRetryableError);
    const transient = new StageExecutionInProgressError("k", "2026-01-01T00:00:00.000Z");
    expect(toWorkflowStepError(transient)).toBe(transient);
    const ordinary = new Error("provider 503");
    expect(toWorkflowStepError(ordinary)).toBe(ordinary);
  });
});

// ---------------------------------------------------------------------------
// Pipeline-level regression fixtures (§13/§14): the exact production sequence
//   initial generation -> ONE bounded assembly repair -> same deterministic
//   blocker -> HUMAN_REVIEW_REQUIRED, Workflow stage retries = 0.
// ---------------------------------------------------------------------------

async function startGeneration(screenshotKey: string): Promise<string> {
  await persistPipelineScreenshot(env, screenshotKey);
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Pipeline Wiring Smoke Business", contactEmail: "ops@wazibizwebsites.example" },
      reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
    },
  });
  return started.siteGenerationId;
}

/** Injects a deterministic assembly-validation blocker into the generated
 *  'about' page — reproducing the 2026-09-07 production case, where the SAME
 *  finding re-appeared after the informed assembly repair because the repair
 *  regenerated against the same immutable inputs. */
function scriptsWithAssemblyBlocker(kind: "orphan-class" | "fabricated-trust"): BuildPipelineDeps {
  const base = createPipelineScripts();
  const generate: RawAiGenerate = async (system, user) => {
    const result = await base.generate!(system, user);
    if (user.includes("page id 'about'")) {
      const page = JSON.parse(result.content) as { html: string };
      // narrow-narrative: the verbatim production ORPHANED_CLASS finding.
      const injection =
        kind === "orphan-class"
          ? '<section class="narrow-narrative"><p>Narrative.</p></section>'
          : '<section aria-label="Our clients"><ul><li>Glap Thon</li></ul></section>';
      page.html = page.html.replace("</main>", `${injection}</main>`);
      return { ...result, content: JSON.stringify(page) };
    }
    return result;
  };
  return { ...base, generate };
}

/** Counts step invocations: with passthrough steps there is no engine to
 *  retry, so the count pins the domain behavior — a step that THREW would
 *  surface as the pipeline's outer-catch FAILED; a step that RETURNS the
 *  deterministic-review marker never re-enters. */
function countingStep(scripted: BuildPipelineDeps, counts: Map<string, number>): BuildPipelineDeps {
  return {
    ...scripted,
    step: async <T,>(name: string, fn: () => Promise<T>) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return fn();
    },
  };
}

async function workflowEventRows(buildId: string): Promise<Array<{ to_state: string; stage: string; detail: string }>> {
  const { results } = await env.DB.prepare(
    "SELECT to_state, stage, detail FROM build_workflow_events WHERE build_id = ?1 ORDER BY created_at"
  )
    .bind(buildId)
    .all<{ to_state: string; stage: string; detail: string }>();
  return results;
}

describe("deterministic assembly failures stop without Workflow retries (issue #62)", () => {
  // §13: the frozen production case — ORPHANED_CLASS on 'about:
  // narrow-narrative' — must end at HUMAN_REVIEW_REQUIRED with ZERO workflow
  // stage retries caused by the finding. The validator must NOT be made to
  // pass.
  it("post-repair ORPHANED_CLASS -> HUMAN_REVIEW_REQUIRED, generate step entered exactly once (§13)", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/det-orphan.png");
    const counts = new Map<string, number>();
    const deps = countingStep(scriptsWithAssemblyBlocker("orphan-class"), counts);

    const outcome = await runBuildPipeline(env, { siteGenerationId, deps });

    expect(outcome.terminal).toEqual("HUMAN_REVIEW_REQUIRED");
    expect(outcome.releaseReadyBuildVersionId).toBeNull();
    const reasons = outcome.reasons.join("\n");
    expect(reasons).toContain("ORPHANED_CLASS");
    expect(reasons).toContain("narrow-narrative");

    // The bounded repair RAN (initial generation + one informed assembly
    // repair for 'about') and still failed: the generate step shows ONE
    // durable-step execution — the finding caused zero Workflow retries.
    expect(counts.get("pipeline: generate site (v1)")).toEqual(1);
    // Domain visibility: the precise finding is on the Build's event ledger
    // and the Build sits non-terminal at HUMAN_REVIEW_REQUIRED.
    expect(outcome.buildId).toBeDefined();
    const events = await workflowEventRows(outcome.buildId);
    const reviewEvent = events.find((event) => event.stage === "site_generation" && event.to_state === "HUMAN_REVIEW_REQUIRED");
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent!.detail).toContain("ORPHANED_CLASS");
    const buildRow = await env.DB.prepare("SELECT state FROM builds WHERE id = ?1").bind(outcome.buildId).first<{ state: string }>();
    expect(buildRow?.state).toEqual("HUMAN_REVIEW_REQUIRED");

    // The candidate is retained for review: the generated 'about' artifacts
    // (base + the one authorized assembly repair) exist as immutable stage
    // artifacts of the version.
    const versionRow = await env.DB.prepare("SELECT id FROM build_versions WHERE build_id = ?1 ORDER BY version_number LIMIT 1")
      .bind(outcome.buildId)
      .first<{ id: string }>();
    const artifacts = await env.DB.prepare(
      "SELECT subkey FROM build_stage_artifacts WHERE build_version_id = ?1 AND kind = 'generated_page' ORDER BY subkey"
    )
      .bind(versionRow!.id)
      .all<{ subkey: string }>();
    const subkeys = artifacts.results.map((row) => row.subkey);
    expect(subkeys).toContain("about");
    expect(subkeys).toContain("about.assembly-repair-1");
  });

  // §14: fabrication after bounded repair must not cause repeated engine
  // attempts; the blocker is preserved with the retained candidate.
  it("post-repair FABRICATED_TRUST_ENTITY -> HUMAN_REVIEW_REQUIRED, blocker preserved (§14)", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/det-fabrication.png");
    const counts = new Map<string, number>();
    const deps = countingStep(scriptsWithAssemblyBlocker("fabricated-trust"), counts);

    const outcome = await runBuildPipeline(env, { siteGenerationId, deps });

    expect(outcome.terminal).toEqual("HUMAN_REVIEW_REQUIRED");
    const reasons = outcome.reasons.join("\n");
    expect(reasons).toContain("FABRICATED_TRUST_ENTITY");
    expect(reasons).toContain("Glap Thon"); // the fabricated entity stays named as the blocker
    expect(counts.get("pipeline: generate site (v1)")).toEqual(1);

    const events = await workflowEventRows(outcome.buildId);
    const reviewEvent = events.find((event) => event.stage === "site_generation" && event.to_state === "HUMAN_REVIEW_REQUIRED");
    expect(reviewEvent).toBeDefined();
    expect(reviewEvent!.detail).toContain("FABRICATED_TRUST_ENTITY");
    const buildRow = await env.DB.prepare("SELECT state FROM builds WHERE id = ?1").bind(outcome.buildId).first<{ state: string }>();
    expect(buildRow?.state).toEqual("HUMAN_REVIEW_REQUIRED");
  });
});

// ---------------------------------------------------------------------------
// §9/§16: schema-invalid output after the boundary's own structural repair is
// exhausted has NO candidate -> Build FAILED, and the engine retry budget is
// never an unofficial second model-repair budget. Proven at the WORKFLOW
// level with a policy-faithful engine: the classification converts INSIDE the
// step closure so NonRetryableError reaches the engine on the throwing
// attempt.
// ---------------------------------------------------------------------------

type StepConfig = { retries?: { limit?: number; delay?: unknown; backoff?: string }; timeout?: string | number };

class PolicyFaithfulEngine {
  readonly attempts = new Map<string, number>();

  async do(name: string, a: unknown, b?: unknown): Promise<unknown> {
    const hasConfig = typeof b === "function";
    const fn = (hasConfig ? b : a) as () => Promise<unknown>;
    const config = (hasConfig ? a : undefined) as StepConfig | undefined;
    const attempt = (this.attempts.get(name) ?? 0) + 1;
    this.attempts.set(name, attempt);
    try {
      return await fn();
    } catch (error) {
      // Documented platform contract: NonRetryableError fails the step
      // immediately; anything else retries up to the configured limit.
      if (error instanceof NonRetryableError) throw error;
      const limit = config?.retries?.limit ?? 5;
      if (attempt >= limit) throw error;
      return await this.do(name, a, b);
    }
  }

  sleep(): Promise<void> {
    return Promise.resolve();
  }
}

describe("schema-invalid AI output after internal repair exhaustion (issue #62 §9/§16)", () => {
  it("no Workflow retry burn: engine sees NonRetryableError on attempt 1; Build = FAILED; exactly 2 model attempts", async () => {
    const siteGenerationId = await startGeneration("references/pipeline/det-schema-invalid.png");
    const base = createPipelineScripts();
    let cssCalls = 0;
    const generate: RawAiGenerate = async (system, user) => {
      if (user.includes("shared stylesheet")) {
        cssCalls += 1;
        // Schema-invalid on BOTH boundary attempts (initial + targeted
        // structural repair): no artifact is persisted, so no candidate.
        return { content: JSON.stringify({ css: 12345 }), provider: "script", model: "glm-5.3-flash" };
      }
      return base.generate!(system, user);
    };

    const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
    workflow.pipelineDeps = { ...base, generate };
    const engine = new PolicyFaithfulEngine();
    const event = { payload: { siteGenerationId }, instanceId: "wf-det-schema-invalid" } as unknown as WorkflowEvent<{ siteGenerationId: string }>;

    const result = (await workflow.run(event, engine as unknown as WorkflowStep)) as {
      buildId: string;
      terminal: string;
      reasons: string[];
    };

    // §9: no useful candidate -> FAILED, domain-visibly.
    expect(result.terminal).toEqual("FAILED");
    expect(result.reasons.join(" ")).toContain("schema-invalid");
    const buildRow = await env.DB.prepare("SELECT state FROM builds WHERE id = ?1")
      .bind(result.buildId)
      .first<{ state: string }>();
    expect(buildRow?.state).toEqual("FAILED");

    // §16: the engine retry budget did NOT become a second model budget —
    // exactly the boundary's own 2 attempts ran (1 initial + 1 structural
    // repair), and the generate STEP was attempted exactly once.
    expect(engine.attempts.get("pipeline: generate site (v1)")).toEqual(1);
    expect(cssCalls).toEqual(2);
    const runs = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_stage_runs WHERE build_id = ?1 AND stage = 'website-generator' AND outcome = 'invalid'"
    )
      .bind(result.buildId)
      .first<{ n: number }>();
    expect(runs?.n).toEqual(2);
  });
});
