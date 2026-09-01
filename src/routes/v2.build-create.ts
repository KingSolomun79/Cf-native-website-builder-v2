import { Context } from "hono";
import type { Env } from "../env.d";
import { getSiteGenerationView } from "../domain/lifecycle";

// Starts the primary WebsiteBuildWorkflow for one Site Generation (issue #4).
// The workflow's first step creates the initial Build and the immutable Build
// Version — this route never writes lifecycle rows itself. Requires the same
// HMAC signature as the intake route so only the operator platform can start a
// Build.

import { verifyWebhookSignature } from "../lib/crypto";

export async function createBuildForSiteGeneration(c: Context<{ Bindings: Env }>): Promise<Response> {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  if (!(await verifyWebhookSignature(c.env.WEBHOOK_SECRET, rawBody, signature ?? null))) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const siteGenerationId = c.req.param("siteGenerationId") as string;
  const view = await getSiteGenerationView(c.env, siteGenerationId);
  if (!view) {
    return c.json({ error: "Site Generation not found" }, 404);
  }

  if (view.builds.some((build) => build.kind === "initial")) {
    return c.json(
      { error: { code: "INITIAL_BUILD_ALREADY_EXISTS", message: "This Site Generation already has its initial Build" } },
      409
    );
  }

  const instance = await c.env.WEBSITE_BUILD_WORKFLOW.create({
    params: { siteGenerationId },
  });

  return c.json({ siteGenerationId, workflowInstanceId: instance.id }, 202);
}
