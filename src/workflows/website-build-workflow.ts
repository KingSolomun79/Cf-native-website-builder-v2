// Primary V2 lifecycle orchestrator (issue #4, PRD section 23; full pipeline
// wiring landed with issue #30).
//
// WebsiteBuildWorkflow owns the V2 lifecycle. The first step creates the
// initial Build and its immutable Build Version from one Site Generation (or
// adopts an existing Build — e.g. a Revision Request Build — when buildId is
// supplied); the pipeline step then drives that Build's current version
// through the canonical REFERENCE_BOUND stages to its terminal state:
// Release Ready, HUMAN_REVIEW_REQUIRED, DEGRADED or FAILED. Helper services
// do the bounded work; this class sequences them durably.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../env.d";
import type { InitialBuildCreated } from "../domain/lifecycle";
import type { BuildPipelineDeps } from "../domain/build-pipeline";

export interface WebsiteBuildParams {
  siteGenerationId: string;
  /** Existing Build (e.g. a Revision Request Build) instead of creating the initial one. */
  buildId?: string;
}

export interface WebsiteBuildResult {
  buildId: string;
  buildVersionId?: string;
  terminal?: string;
  releaseReadyBuildVersionId?: string | null;
  artifactManifestHash?: string | null;
  previewUrl?: string | null;
  reasons?: string[];
}

export class WebsiteBuildWorkflow extends WorkflowEntrypoint<Env, WebsiteBuildParams> {
  /** Test seam: deterministic provider scripts for the pipeline step. The
   *  production runtime never sets it — the real provider defaults apply. */
  pipelineDeps?: BuildPipelineDeps;

  async run(event: WorkflowEvent<WebsiteBuildParams>, step: WorkflowStep): Promise<WebsiteBuildResult> {
    const { siteGenerationId, buildId } = event.payload;

    const created = await step.do<InitialBuildCreated | { buildId: string }>(
      "1.0 resolve Build and immutable Build Version 1",
      async () => {
        if (buildId) return { buildId };
        const { createInitialBuild } = await import("../domain/lifecycle");
        return createInitialBuild(this.env, { siteGenerationId });
      }
    );

    const outcome = await step.do<WebsiteBuildResult>(
      "2.0 run REFERENCE_BOUND pipeline to terminal state",
      async () => {
        const { runBuildPipeline } = await import("../domain/build-pipeline");
        const result = await runBuildPipeline(this.env, {
          siteGenerationId,
          buildId: created.buildId,
          // Every pipeline stage executes as its own durable step: a mid-flight
          // isolate eviction retries only that stage, and each stage is
          // idempotent (frozen-artifact reuse / KIE spend-resume).
          deps: {
            ...(this.pipelineDeps ?? {}),
            step: async <T,>(name: string, fn: () => Promise<T>) => (await step.do(name, () => fn() as never)) as T,
          },
        });
        return {
          buildId: result.buildId,
          buildVersionId: result.releaseReadyBuildVersionId ?? undefined,
          terminal: result.terminal,
          releaseReadyBuildVersionId: result.releaseReadyBuildVersionId,
          artifactManifestHash: result.artifactManifestHash,
          previewUrl: result.previewUrl,
          reasons: result.reasons,
        };
      }
    );

    return outcome;
  }
}
