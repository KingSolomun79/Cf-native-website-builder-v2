// V2 build pipeline entry (legacy-cleanup C4/C5): REFERENCE_BOUND builds run
// the SIMPLE design pipeline (src/simple-design/pipeline.ts) — Reference
// Capture → Design Blueprint → Nano Banana images → Website Builder →
// Technical/Truth/Visual QA → optional ONE Repair → Release Ready.
//
// The legacy COMPLEX design chain (Reference Analysis → Visual Blueprint →
// Implementation Contract → realization/craft-repair → Fix Coordinator) was
// removed; there is no runtime pipeline selector any more. ORIGINAL_DESIGN is
// a recognized Build Mode whose runtime is explicitly NOT ENABLED (see
// ./original-design-lock): it terminates HUMAN_REVIEW_REQUIRED here and is
// refused at the lifecycle boundary — never silently routed to REFERENCE_BOUND.
import type { Env } from "../env.d";
import { appendBuildWorkflowEvent } from "./lifecycle";
import type { ReferenceCaptureFn } from "./reference-intake";
import type { ImageGenerationProvider } from "./image-pipeline";
import type { PreviewDeployer } from "./assembly";
import type { QaCaptureFn } from "./qa-evidence";
import type { QaAReportAugmented, QaBReport } from "./qa-stages";
import type { RawAiGenerate } from "./ai-boundary";
import { runSimpleBuildPipeline, type SimplePipelineDeps } from "../simple-design/pipeline";

export interface BuildPipelineDeps {
  generate?: RawAiGenerate;
  imageProvider?: ImageGenerationProvider;
  previewDeployer?: PreviewDeployer;
  /** Built per Preview deployment; defaults to the browser-backed capture. */
  qaCapture?: (previewUrl: string) => QaCaptureFn;
  /** Reference URL capture; defaults to the production browser capture.
   *  Only invoked when the Site Generation carries a Reference URL. */
  capture?: ReferenceCaptureFn;
  /** Multimodal generate seam: used by stages when normalized visual inputs
   *  exist. Defaults to the production vision adapter (real gateway); tests
   *  inject deterministic scripts. */
  visionGenerate?: RawAiGenerate;
  /** Durable step executor (the workflow's WorkflowStep). Each stage runs as
   *  its own step so a mid-flight isolate eviction retries only that stage;
   *  every stage is idempotent (artifact reuse / spend-resume) by design.
   *  Tests use the passthrough default. */
  step?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  /** Durable wait for the image poll loop: the workflow maps this to
   *  step.sleep, so provider waiting pauses the instance instead of occupying
   *  a running step. Defaults to an instant no-op. */
  sleep?: (name: string, ms: number) => Promise<void>;
}

export type PipelineTerminalStatus =
  | "RELEASE_READY"
  | "HUMAN_REVIEW_REQUIRED"
  | "DEGRADED"
  | "FAILED";

export interface BuildPipelineOutcome {
  terminal: PipelineTerminalStatus;
  reasons: string[];
  siteGenerationId: string;
  siteId: string;
  buildId: string;
  releaseReadyBuildVersionId: string | null;
  artifactManifestHash: string | null;
  previewUrl: string | null;
  qaA: QaAReportAugmented | null;
  qaB: QaBReport | null;
  repairApplied: boolean;
}

export async function runBuildPipeline(
  env: Env,
  input: { siteGenerationId: string; buildId: string; deps: BuildPipelineDeps }
): Promise<BuildPipelineOutcome> {
  const generation = await env.DB.prepare("SELECT build_mode FROM site_generations WHERE id = ?")
    .bind(input.siteGenerationId)
    .first<{ build_mode: string }>();
  if (generation?.build_mode !== "REFERENCE_BOUND") {
    await appendBuildWorkflowEvent(env, {
      buildId: input.buildId,
      fromState: "INTAKE_READY",
      toState: "HUMAN_REVIEW_REQUIRED",
      stage: "intake",
      detail: `Build Mode '${generation?.build_mode ?? "unknown"}' is recognized but NOT ENABLED (ORIGINAL_DESIGN's SIMPLE implementation is deferred; REFERENCE_BOUND is the only enabled design path)`,
    });
    return {
      terminal: "HUMAN_REVIEW_REQUIRED",
      reasons: [`Build Mode '${generation?.build_mode ?? "unknown"}' is recognized but NOT ENABLED`],
      siteGenerationId: input.siteGenerationId,
      siteId: "",
      buildId: input.buildId,
      releaseReadyBuildVersionId: null,
      artifactManifestHash: null,
      previewUrl: null,
      qaA: null,
      qaB: null,
      repairApplied: false,
    };
  }

  const simpleDeps: SimplePipelineDeps = {
    ...(input.deps.generate ? { generate: input.deps.generate } : {}),
    ...(input.deps.visionGenerate ? { visionGenerate: input.deps.visionGenerate } : {}),
    ...(input.deps.imageProvider ? { imageProvider: input.deps.imageProvider } : {}),
    ...(input.deps.previewDeployer ? { previewDeployer: input.deps.previewDeployer } : {}),
    ...(input.deps.qaCapture ? { qaCapture: input.deps.qaCapture } : {}),
    ...(input.deps.capture ? { capture: input.deps.capture } : {}),
    ...(input.deps.step ? { step: input.deps.step } : {}),
    ...(input.deps.sleep ? { sleep: input.deps.sleep } : {}),
  };
  return runSimpleBuildPipeline(env, { siteGenerationId: input.siteGenerationId, buildId: input.buildId, deps: simpleDeps }).then(
    (outcome): BuildPipelineOutcome => ({ ...outcome, qaA: null, qaB: null })
  );
}
