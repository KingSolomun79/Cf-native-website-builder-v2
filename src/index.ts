import { Hono } from "hono";
import type { Env } from "./env.d";
import { processDueEmailDeliveries } from "./domain/form-service";
import { handleKieCallback } from "./routes/internal.kie-callback";
import { submitOnboardingSubmission } from "./routes/v2.onboarding-submit";
import { getSiteGeneration } from "./routes/v2.site-generation-get";
import { createBuildForSiteGeneration } from "./routes/v2.build-create";
import { getBuild } from "./routes/v2.build-get";
import { createRevisionRequest, getRevisionRequest } from "./routes/v2.revision-request";
import { submitForm } from "./routes/v2.form-submit";
import { createApproval } from "./routes/v2.approval-create";
import { rollbackSitePublication } from "./routes/v2.rollback";

// V2-only route table. The V1 product routes (Fluent Forms webhook, jobs,
// contact, reference upload in its V1 shape, GitHub deploy webhook) were
// removed with the migration contraction; no production V1 fallback exists.

const app = new Hono<{ Bindings: Env }>();

app.post("/api/v2/onboarding-submissions", submitOnboardingSubmission);
app.get("/api/v2/site-generations/:siteGenerationId", getSiteGeneration);
app.post("/api/v2/site-generations/:siteGenerationId/builds", createBuildForSiteGeneration);
app.get("/api/v2/builds/:buildId", getBuild);
app.post("/api/v2/builds/:buildId/revision-requests", createRevisionRequest);
app.get("/api/v2/builds/:buildId/revision-requests/latest", getRevisionRequest);
app.post("/api/v2/forms/submit", submitForm);
// Operator release actions: both gated by offline-minted capability tokens
// (issue #29); they deny by default when OPERATOR_CAPABILITY_SECRET is unset.
app.post("/api/v2/build-versions/:buildVersionId/approval", createApproval);
app.post("/api/v2/sites/:siteId/rollback", rollbackSitePublication);

app.post("/api/internal/kie-callback", handleKieCallback);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Bounded server-side retry sweep for transient Email Delivery failures
// (PRD 37): due retries fire on the cron trigger declared in wrangler.jsonc
// so visitors never resubmit. Idempotent per delivery ledger state; the
// per-submission attempt ceiling lives in processDueEmailDeliveries.
export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  const processed = await processDueEmailDeliveries(env);
  if (processed > 0) {
    console.log(`email delivery retry sweep: ${processed} due submissions processed (cron ${event.cron})`);
  }
}

// The handler object must be the default export: beside a default export
// the runtime ignores named exports, so `scheduled` is registered here
// (a bare `export default app` would leave the cron trigger handlerless —
// caught live on the staging deployment).
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> =>
    app.fetch(request, env, ctx),
  scheduled,
};
export { WebsiteBuildWorkflow } from "./workflows/website-build-workflow";
