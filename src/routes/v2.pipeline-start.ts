import { Context } from "hono";
import type { Env } from "../env.d";
import { verifyWebhookSignature } from "../lib/crypto";

// Starts the primary WebsiteBuildWorkflow for ONE existing Build (issue #30
// production wiring). The initial path is POST /api/v2/site-generations/:id/
// builds; this route covers Builds created outside that path — a Revision
// Request Build (issue #5) — so a second candidate runs the same supported
// pipeline to Release Ready. HMAC-gated like every operator intake route; it
// never writes lifecycle rows itself.

export async function startBuildPipeline(c: Context<{ Bindings: Env }>): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  if (!(await verifyWebhookSignature(c.env.WEBHOOK_SECRET, rawBody, signature ?? null))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const buildId = c.req.param("buildId") as string;
  const build = await c.env.DB.prepare(
    "SELECT b.id, b.state, b.site_generation_id AS siteGenerationId FROM builds b WHERE b.id = ?"
  )
    .bind(buildId)
    .first<{ id: string; state: string; siteGenerationId: string }>();
  if (!build) {
    return c.json({ error: "Build not found" }, 404);
  }

  const terminalStates = new Set(["RELEASE_READY", "APPROVED", "PUBLISHING", "PUBLISHED", "HUMAN_REVIEW_REQUIRED", "DEGRADED", "FAILED"]);
  if (terminalStates.has(build.state)) {
    return c.json(
      { error: { code: "BUILD_ALREADY_TERMINAL", message: `Build ${buildId} is already in terminal state '${build.state}'; start a new Build instead` } },
      409
    );
  }

  const instance = await c.env.WEBSITE_BUILD_WORKFLOW.create({
    params: { siteGenerationId: build.siteGenerationId, buildId: build.id },
  });

  return c.json({ buildId, siteGenerationId: build.siteGenerationId, workflowInstanceId: instance.id }, 202);
}
