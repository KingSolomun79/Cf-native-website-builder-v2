import { Hono } from "hono";
import type { Env } from "./env.d";
import { handleFluentFormsWebhook } from "./routes/webhook.fluentforms";
import { getJob } from "./routes/jobs.get";
import { approveJob } from "./routes/jobs.approve";
import { rejectJob } from "./routes/jobs.reject";
import { reviseJob } from "./routes/jobs.revise";
import { showReviseForm } from "./routes/jobs.revise-form";
import { showInputForm } from "./routes/jobs.input";
import { submitInput } from "./routes/jobs.input-submit";
import { uploadReferenceScreenshot } from "./routes/reference.upload";
import { submitContact } from "./routes/contact.submit";
import { handleKieCallback } from "./routes/internal.kie-callback";
import { runDeploySmokeTest } from "./routes/internal.deploy-smoke";
import { handleGithubDeployCallback } from "./routes/webhook.github";
import { handleCandidateValidation } from "./lib/candidate-validation";

const app = new Hono<{ Bindings: Env }>();

app.post("/api/webhooks/fluentforms", handleFluentFormsWebhook);
app.post("/api/webhooks/github", handleGithubDeployCallback);

app.post("/api/reference/upload", uploadReferenceScreenshot);

app.get("/api/jobs/:jobId", getJob);
app.get("/api/jobs/:jobId/approve", approveJob);
app.post("/api/jobs/:jobId/approve", approveJob);
app.get("/api/jobs/:jobId/reject", rejectJob);
app.post("/api/jobs/:jobId/reject", rejectJob);
app.post("/api/jobs/:jobId/revise", reviseJob);
app.get("/api/jobs/:jobId/revise-form", showReviseForm);
app.get("/api/jobs/:jobId/input", showInputForm);
app.post("/api/jobs/:jobId/input", submitInput);

app.post("/api/internal/kie-callback", handleKieCallback);
app.post("/api/internal/deploy-smoke", runDeploySmokeTest);
app.post("/api/internal/candidate-validation", handleCandidateValidation);

app.post("/api/contact", submitContact);

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
export { SiteBuildWorkflow } from "./workflows/site-build-workflow";
export { WebsiteAgent } from "./agents/website-agent";
