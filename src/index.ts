import { Hono } from "hono";
import type { Env } from "./env.d";
import { processDueEmailDeliveries } from "./domain/form-service";
import { processDueAdminNotifications } from "./domain/admin-notifications";
import { reconcileWorkflowTerminations } from "./domain/workflow-reconciliation";
import {
  cleanupDisposableDeployments,
  pruneDisposableBuildArtifacts,
  SWEEP_MAX_DELETIONS,
  SWEEP_MAX_VERSION_PRUNES,
} from "./domain/retention";
import { handleKieCallback } from "./routes/internal.kie-callback";
import { submitOnboardingSubmission } from "./routes/v2.onboarding-submit";
import { submitClientIntake, preflightClientIntake } from "./routes/public-client-intake";
import { registerAdminApiRoutes } from "./routes/admin-api";
import { registerAdminPageRoutes } from "./routes/admin-pages";
import { getSiteGeneration } from "./routes/v2.site-generation-get";
import { createBuildForSiteGeneration } from "./routes/v2.build-create";
import { startBuildPipeline } from "./routes/v2.pipeline-start";
import { getBuild } from "./routes/v2.build-get";
import { createRevisionRequest, getRevisionRequest } from "./routes/v2.revision-request";
import { submitForm } from "./routes/v2.form-submit";
import { createApproval } from "./routes/v2.approval-create";
import { createPublication } from "./routes/v2.publication-create";
import { rollbackSitePublication } from "./routes/v2.rollback";
import {
  getBenchmarkRun,
  recordBenchmarkRunEndpoint,
  runBenchmarkFreeze,
  runBenchmarkPreflight,
  runBenchmarkStart,
} from "./routes/v2.benchmark-driver";
import { backfillSiteAddresses } from "./routes/v2.site-address-backfill";

// V2-only route table. The V1 product routes (Fluent Forms webhook, jobs,
// contact, reference upload in its V1 shape, GitHub deploy webhook) were
// removed with the migration contraction; no production V1 fallback exists.

const app = new Hono<{ Bindings: Env }>();

app.post("/api/v2/onboarding-submissions", submitOnboardingSubmission);
app.get("/api/v2/site-generations/:siteGenerationId", getSiteGeneration);
app.post("/api/v2/site-generations/:siteGenerationId/builds", createBuildForSiteGeneration);
app.post("/api/v2/builds/:buildId/pipeline", startBuildPipeline);
app.get("/api/v2/builds/:buildId", getBuild);
app.post("/api/v2/builds/:buildId/revision-requests", createRevisionRequest);
app.get("/api/v2/builds/:buildId/revision-requests/latest", getRevisionRequest);
app.post("/api/v2/forms/submit", submitForm);
// Operator release actions: all gated by offline-minted, action-bound
// capability tokens (issues #29 and #31); they deny by default when
// OPERATOR_CAPABILITY_SECRET is unset.
app.post("/api/v2/build-versions/:buildVersionId/approval", createApproval);
app.post("/api/v2/build-versions/:buildVersionId/publication", createPublication);
app.post("/api/v2/sites/:siteId/rollback", rollbackSitePublication);

// Operator benchmark driver (issues #18-#22): executes the FROZEN #17 harness
// one case at a time through the PRODUCTION durable workflow engine and real
// providers — seed the run, then record its append-only outcome row once the
// pipeline reaches a terminal state. Every endpoint requires an offline-minted
// "benchmark" capability bound to the exact caseId; it is never public and can
// never publish.
app.post("/api/v2/operator/benchmarks/:caseId/freeze", runBenchmarkFreeze);
app.post("/api/v2/operator/benchmarks/:caseId/preflight", runBenchmarkPreflight);
app.post("/api/v2/operator/benchmarks/:caseId/run", runBenchmarkStart);
app.post("/api/v2/operator/benchmarks/:caseId/record", recordBenchmarkRunEndpoint);
app.get("/api/v2/operator/benchmarks/runs/:runId", getBenchmarkRun);

// Operator Site-Address backfill (issue #48): gives every legacy Site
// identity its one stable public Site Address — dry-run report first, then
// idempotent allocation. Requires an offline-minted
// "site-address-backfill" capability; never public, never a release action.
app.post("/api/v2/operator/site-addresses/backfill", backfillSiteAddresses);

app.post("/api/internal/kie-callback", handleKieCallback);

// PUBLIC client intake (operator GO 2026-09-12): persists a mutable Intake
// Draft — never a Site Generation. Protected by Turnstile + origin allowlist +
// hashed-IP rate limiting, NOT by WEBHOOK_SECRET. The OPTIONS preflight exists
// for the wazibiz.ke browser mapper only (allowlisted origins, integration GO
// 2026-09-13).
app.post("/api/public/client-intakes", submitClientIntake);
app.on("OPTIONS", "/api/public/client-intakes", preflightClientIntake);

// Operator admin APIs + dashboard pages (Cloudflare Access-gated).
registerAdminApiRoutes(app);
registerAdminPageRoutes(app);

// The experiment benchmark driver route (/api/v2/exp/benchmark-driver) was
// retired with the post-rollout hardening (2026-09-12): the rollout condition
// "keep the driver until production smoke succeeds" was met — production
// smoke generated a site to RELEASE READY. The driver's scripts and evidence
// remain in repository history.

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// Bounded server-side retry sweep for transient Email Delivery failures
// (PRD 37): due retries fire on the cron trigger declared in wrangler.jsonc
// so visitors never resubmit. Idempotent per delivery ledger state; the
// per-submission attempt ceiling lives in processDueEmailDeliveries.
//
// The same sweep also reconciles workflow terminal failures (issue #56): a
// Build whose workflow instance the platform reports errored/terminated while
// the Build is still non-terminal is failed exactly once with an audit event.
// Resource kills cannot run catch/finally in the dying invocation, so this
// external status check is the guarantee that no Build stays non-terminal
// forever. Bounded per run; reuses the existing cron (no new scheduler).
//
// It also runs the issue #16 retention lifecycle sweep (failed/superseded
// preview deployments, expired non-rollback published deployments, bulky
// artifacts of dead versions) under the same bounded/idempotent rules.
export async function scheduled(event: ScheduledController, env: Env): Promise<void> {
  try {
    const processed = await processDueEmailDeliveries(env);
    if (processed > 0) {
      console.log(`email delivery retry sweep: ${processed} due submissions processed (cron ${event.cron})`);
    }
  } catch (error) {
    console.error(`(error) email_retry_sweep_failed { message: '${(error as Error).message.replace(/'/g, "")}' }`);
  }
  try {
    const processed = await processDueAdminNotifications(env);
    if (processed > 0) {
      console.log(`admin notification sweep: ${processed} due notifications processed (cron ${event.cron})`);
    }
  } catch (error) {
    console.error(`(error) admin_notification_sweep_failed { message: '${(error as Error).message.replace(/'/g, "")}' }`);
  }
  try {
    const summary = await reconcileWorkflowTerminations(env);
    if (summary.examined > 0 || summary.errors > 0) {
      console.log(
        `(info) workflow_reconciliation_sweep { examined: ${summary.examined}, reconciled: ${summary.reconciled}, skipped: ${summary.skipped}, errors: ${summary.errors} }`
      );
    }
  } catch (error) {
    console.error(`(error) workflow_reconciliation_sweep_failed { message: '${(error as Error).message.replace(/'/g, "")}' }`);
  }
  // Retention lifecycle sweep (issue #16): dispose failed/superseded Preview
  // Deployments, expired non-rollback published deployments, and the bulky
  // artifacts of dead Build Versions. Bounded per run (deletion/version caps,
  // candidate LIMITs) and resumable: each item re-reads canonical protection
  // state immediately before deletion, operational failures are logged and
  // left for the next trigger, and compact Build Records / publication /
  // rollback state are never touched. Uses the existing cron — no scheduler.
  try {
    const report = await cleanupDisposableDeployments(env, { maxDeletions: SWEEP_MAX_DELETIONS });
    if (report.deletedWorkers.length > 0 || report.failedWorkers.length > 0) {
      console.log(
        `(info) retention_deployment_sweep { deleted: ${report.deletedWorkers.length}, protected: ${report.protectedWorkers.length}, failed: ${report.failedWorkers.length} }`
      );
    }
  } catch (error) {
    console.error(`(error) retention_deployment_sweep_failed { message: '${(error as Error).message.replace(/'/g, "")}' }`);
  }
  try {
    const report = await pruneDisposableBuildArtifacts(env, { maxVersions: SWEEP_MAX_VERSION_PRUNES });
    if (report.prunedVersions.length > 0 || report.failedVersions.length > 0) {
      console.log(
        `(info) retention_artifact_sweep { pruned_versions: ${report.prunedVersions.length}, pruned_keys: ${report.prunedArtifactKeys.length}, benchmark_protected: ${report.benchmarkProtectedKeys.length}, failed: ${report.failedVersions.length} }`
      );
    }
  } catch (error) {
    console.error(`(error) retention_artifact_sweep_failed { message: '${(error as Error).message.replace(/'/g, "")}' }`);
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
// Sandbox deploy-compatibility export: the sandbox Worker's account still
// carries a V1-era Durable Object namespace backed by the class `WebsiteAgent`,
// and the Cloudflare API rejects any new script version that stops exporting a
// class an existing DO namespace depends on (error 10064). This empty stub
// satisfies that export contract without implementing anything: no V2 route
// reaches the namespace. Removing it requires a DO-namespace migration on the
// sandbox Worker — deliberately not part of this cleanup.
export { WebsiteAgent } from "./exp-compat-website-agent";
