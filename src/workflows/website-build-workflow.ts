// Primary V2 lifecycle orchestrator (issue #4, PRD section 23).
//
// WebsiteBuildWorkflow owns the V2 lifecycle. Issue #4 lands the backbone: the
// first step creates the initial Build and its immutable Build Version from one
// Site Generation. The canonical pipeline stages (REFERENCE_CHECK through
// RELEASE_READY) land with issues #7-#15 as individual steps under this same
// workflow; helper services do the bounded work and this class sequences them.

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import type { Env } from "../env.d";
import type { InitialBuildCreated } from "../domain/lifecycle";

export interface WebsiteBuildParams {
  siteGenerationId: string;
}

export class WebsiteBuildWorkflow extends WorkflowEntrypoint<Env, WebsiteBuildParams> {
  async run(event: WorkflowEvent<WebsiteBuildParams>, step: WorkflowStep) {
    const { siteGenerationId } = event.payload;

    const created = await step.do<InitialBuildCreated>(
      "1.0 create initial Build and immutable Build Version 1",
      async () => {
        const { createInitialBuild } = await import("../domain/lifecycle");
        return createInitialBuild(this.env, { siteGenerationId });
      }
    );

    // Later issues (#7-#15) append the REFERENCE_BOUND pipeline steps here:
    // REFERENCE_CHECK -> ... -> RELEASE_READY, each advancing the canonical
    // state through appendBuildWorkflowEvent.

    return { buildId: created.buildId, buildVersionId: created.buildVersionId };
  }
}
