import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import { submitOnboardingSubmission } from "../src/routes/v2.onboarding-submit";
import { getSiteGeneration } from "../src/routes/v2.site-generation-get";
import { createBuildForSiteGeneration } from "../src/routes/v2.build-create";
import { getBuild } from "../src/routes/v2.build-get";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import {
  appendBuildWorkflowEvent,
  createInitialBuild,
  getSiteGenerationView,
  LifecycleError,
} from "../src/domain/lifecycle";
import { generateId, hmacSha256 } from "../src/lib/crypto";
import { createPipelineScripts, persistPipelineScreenshot } from "./helpers/pipeline-scripts";

// Primary-seam tests for the V2 domain lifecycle backbone (issue #4):
// Onboarding Submission -> Site Generation -> Build -> immutable Build Version.

function runtimeEnv(createWorkflow: ReturnType<typeof vi.fn> = vi.fn()): Env {
  return {
    ...(providedEnv as unknown as Env),
    WEBHOOK_SECRET: "test-webhook-secret",
    WEBSITE_BUILD_WORKFLOW: { create: createWorkflow } as unknown as Workflow,
  };
}

function v2App(env: Env): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/v2/onboarding-submissions", submitOnboardingSubmission);
  app.get("/api/v2/site-generations/:siteGenerationId", getSiteGeneration);
  app.post("/api/v2/site-generations/:siteGenerationId/builds", createBuildForSiteGeneration);
  app.get("/api/v2/builds/:buildId", getBuild);
  return app;
}

function submissionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildMode: "REFERENCE_BOUND",
    facts: {
      businessName: "Rift Valley Roasters",
      contactEmail: "hello@riftvalleyroasters.example",
      businessType: "coffee roastery",
      businessDescription: "Small-batch coffee roasting for cafes and homes.",
      city: "Nakuru",
      country: "Kenya",
    },
    reference: {
      url: "https://meridian-atelier.example.com/",
      screenshotR2Key: "references/uploads/abc123.png",
    },
    ...overrides,
  };
}

async function postJson(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  path: string,
  body: unknown,
  options: { sign?: boolean } = { sign: true }
): Promise<Response> {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.sign !== false) {
    headers["X-Signature"] = await hmacSha256(env.WEBHOOK_SECRET, raw);
  }
  return app.request(`https://test.example.com${path}`, { method: "POST", headers, body: raw }, env);
}

async function postSubmission(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  overrides: Record<string, unknown> = {},
  envelope: Record<string, unknown> = {}
): Promise<Response> {
  return postJson(app, env, "/api/v2/onboarding-submissions", {
    submission: submissionPayload(overrides),
    ...envelope,
  });
}

// Screenshot+URL submission with a persisted Reference PNG so the workflow's
// full pipeline (issue #30 wiring) runs without live browser/provider calls.
// The URL supplies measured capture evidence (issue #39: dimensions-only
// evidence is INSUFFICIENT by design); the capture itself comes from the
// scripted deps.
async function postScreenshotSubmission(app: Hono<{ Bindings: Env }>, env: Env): Promise<string> {
  const key = `references/lifecycle/${generateId()}.png`;
  await persistPipelineScreenshot(env, key);
  const response = await postSubmission(app, env, { reference: { screenshotR2Key: key, url: "https://meridian-atelier.example.com/" } });
  const body = (await response.json()) as { siteGenerationId: string };
  return body.siteGenerationId;
}

// Executes the real WebsiteBuildWorkflow step bodies synchronously — the
// workflow is the primary boundary, so the seam under test is its run() body.
// Deterministic pipeline scripts stand in for the real providers (the
// pipeline service itself is covered by tests/v2-build-pipeline.test.ts).
async function runWebsiteBuildWorkflow(env: Env, siteGenerationId: string): Promise<{ buildId: string; buildVersionId: string }> {
  const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
  workflow.pipelineDeps = createPipelineScripts();
  const step = {
    do: async (_name: string, a: unknown, b?: unknown) => await (typeof b === "function" ? (b as () => Promise<unknown>) : (a as () => Promise<unknown>))(),
  } as unknown as WorkflowStep;
  const event = { payload: { siteGenerationId } } as unknown as WorkflowEvent<{ siteGenerationId: string }>;
  return (await workflow.run(event, step)) as { buildId: string; buildVersionId: string };
}

describe("V2 domain lifecycle backbone", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;
  let createWorkflow: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    createWorkflow = vi.fn(async () => ({ id: `wf-${generateId()}` }));
    env = runtimeEnv(createWorkflow);
    app = v2App(env);
  });

  it("creates Business, Site, immutable Onboarding Submission and exactly one Site Generation from a fresh submission", async () => {
    const response = await postSubmission(app, env);
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      businessId: string;
      siteId: string;
      onboardingSubmissionId: string;
      siteGenerationId: string;
      buildMode: string;
      sequenceNumber: number;
    };
    expect(body.buildMode).toBe("REFERENCE_BOUND");
    expect(body.sequenceNumber).toBe(1);
    expect(body.businessId).toBeTruthy();
    expect(body.siteId).toBeTruthy();
    expect(body.onboardingSubmissionId).not.toBe(body.siteGenerationId);

    const view = await getSiteGenerationView(env, body.siteGenerationId);
    expect(view).not.toBeNull();
    expect(view!.siteGeneration.siteId).toBe(body.siteId);
    expect(view!.siteGeneration.businessId).toBe(body.businessId);
    expect(view!.siteGeneration.onboardingSubmissionId).toBe(body.onboardingSubmissionId);
    expect(view!.submission.buildMode).toBe("REFERENCE_BOUND");
    expect(view!.submission.facts.businessName).toBe("Rift Valley Roasters");
    expect(view!.submission.reference?.url).toBe("https://meridian-atelier.example.com/");
    expect(view!.submission.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(view!.builds).toEqual([]);
  });

  it("starts a replacement Site Generation on the same stable Site from a later submission, leaving the earlier submission untouched", async () => {
    const first = ((await (await postSubmission(app, env)).json()) as { siteId: string; onboardingSubmissionId: string; siteGenerationId: string });

    const second = await postSubmission(app, env, { buildMode: "ORIGINAL_DESIGN", reference: undefined }, { siteId: first.siteId });
    expect(second.status).toBe(201);

    const secondBody = (await second.json()) as { siteId: string; sequenceNumber: number; siteGenerationId: string };
    expect(secondBody.siteId).toBe(first.siteId);
    expect(secondBody.sequenceNumber).toBe(2);

    const firstView = await getSiteGenerationView(env, first.siteGenerationId);
    expect(firstView!.submission.id).toBe(first.onboardingSubmissionId);
    expect(firstView!.submission.buildMode).toBe("REFERENCE_BOUND");
    expect(firstView!.siteGeneration.sequenceNumber).toBe(1);
  });

  it("creates the first Build and initial immutable Build Version through the primary workflow boundary", async () => {
    const siteGenerationId = await postScreenshotSubmission(app, env);

    const start = await postJson(app, env, `/api/v2/site-generations/${siteGenerationId}/builds`, {});
    expect(start.status).toBe(202);
    const startBody = (await start.json()) as { workflowInstanceId: string };
    expect(startBody.workflowInstanceId).toMatch(/^wf-/);
    expect(createWorkflow).toHaveBeenCalledWith({ params: { siteGenerationId } });

    const result = await runWebsiteBuildWorkflow(env, siteGenerationId);
    expect(result.buildId).toBeTruthy();
    expect(result.buildVersionId).toBeTruthy();

    const buildResponse = await app.request(`https://test.example.com/api/v2/builds/${result.buildId}`, {}, env);
    expect(buildResponse.status).toBe(200);
    const buildView = (await buildResponse.json()) as {
      build: { kind: string; state: string; siteGenerationId: string };
      versions: Array<{ versionNumber: number }>;
      workflowEvents: Array<{ toState: string; stage: string }>;
    };
    expect(buildView.build.kind).toBe("initial");
    // The workflow now carries the Build through the full pipeline (issue #30
    // wiring); with the deterministic scripts the terminal state is
    // RELEASE_READY for exactly Build Version 1.
    expect(buildView.build.state).toBe("RELEASE_READY");
    expect(buildView.build.siteGenerationId).toBe(siteGenerationId);
    expect(buildView.versions).toEqual([expect.objectContaining({ versionNumber: 1 })]);
    expect(buildView.workflowEvents[0]).toEqual(
      expect.objectContaining({ toState: "INTAKE_READY", stage: "intake" })
    );

    const generationResponse = await app.request(
      `https://test.example.com/api/v2/site-generations/${siteGenerationId}`, {}, env
    );
    const generationView = (await generationResponse.json()) as { builds: Array<{ kind: string; versions: Array<{ versionNumber: number }> }> };
    expect(generationView.builds).toHaveLength(1);
    expect(generationView.builds[0].kind).toBe("initial");
    expect(generationView.builds[0].versions).toEqual([expect.objectContaining({ versionNumber: 1 })]);
  });

  it("rejects a second initial Build for the same Site Generation and reports 409 from the route", async () => {
    const siteGenerationId = await postScreenshotSubmission(app, env);
    await runWebsiteBuildWorkflow(env, siteGenerationId);

    await expect(createInitialBuild(env, { siteGenerationId })).rejects.toMatchObject({
      code: "INITIAL_BUILD_ALREADY_EXISTS",
    });

    const retry = await postJson(app, env, `/api/v2/site-generations/${siteGenerationId}/builds`, {});
    expect(retry.status).toBe(409);
  });

  it("enforces Onboarding Submission immutability at the storage boundary", async () => {
    const submission = ((await (await postSubmission(app, env)).json()) as { onboardingSubmissionId: string });

    await expect(
      env.DB.prepare("UPDATE onboarding_submissions SET payload_json = '{}' WHERE id = ?")
        .bind(submission.onboardingSubmissionId)
        .run()
    ).rejects.toThrow("ONBOARDING_SUBMISSION_IMMUTABLE");

    await expect(
      env.DB.prepare("DELETE FROM onboarding_submissions WHERE id = ?")
        .bind(submission.onboardingSubmissionId)
        .run()
    ).rejects.toThrow("ONBOARDING_SUBMISSION_IMMUTABLE");
  });

  it("enforces Build Version immutability at the storage boundary", async () => {
    const siteGenerationId = await postScreenshotSubmission(app, env);
    const result = await runWebsiteBuildWorkflow(env, siteGenerationId);

    await expect(
      env.DB.prepare("UPDATE build_versions SET version_number = 99 WHERE id = ?")
        .bind(result.buildVersionId)
        .run()
    ).rejects.toThrow("BUILD_VERSION_IMMUTABLE");

    await expect(
      env.DB.prepare("DELETE FROM build_versions WHERE id = ?")
        .bind(result.buildVersionId)
        .run()
    ).rejects.toThrow("BUILD_VERSION_IMMUTABLE");
  });

  it("rejects invalid cross-entity relationships", async () => {
    // Unknown Site identity.
    const unknownSite = await postSubmission(app, env, {}, { siteId: generateId() });
    expect(unknownSite.status).toBe(404);

    // Unknown Site Generation cannot start a Build.
    const unknownGeneration = await postJson(app, env, `/api/v2/site-generations/${generateId()}/builds`, {});
    expect(unknownGeneration.status).toBe(404);
    await expect(createInitialBuild(env, { siteGenerationId: generateId() })).rejects.toMatchObject({
      code: "GENERATION_NOT_FOUND",
    });

    // A Build Version from one Build cannot be attached to another Build's events.
    const first = await runWebsiteBuildWorkflow(env, await postScreenshotSubmission(app, env));
    const second = await runWebsiteBuildWorkflow(env, await postScreenshotSubmission(app, env));
    await expect(
      appendBuildWorkflowEvent(env, {
        buildId: second.buildId,
        buildVersionId: first.buildVersionId,
        toState: "REFERENCE_CHECK",
        stage: "reference_check",
      })
    ).rejects.toMatchObject({ code: "BUILD_VERSION_MISMATCH" });

    // Unknown Build cannot receive workflow events.
    await expect(
      appendBuildWorkflowEvent(env, {
        buildId: generateId(),
        toState: "REFERENCE_CHECK",
        stage: "reference_check",
      })
    ).rejects.toMatchObject({ code: "BUILD_NOT_FOUND" });
  });

  it("rejects unsigned and malformed intake", async () => {
    const unsigned = await postJson(app, env, "/api/v2/onboarding-submissions", { submission: submissionPayload() }, { sign: false });
    expect(unsigned.status).toBe(401);

    const invalidPayload = await postSubmission(app, env, { facts: { businessName: "" } });
    expect(invalidPayload.status).toBe(400);
    const invalidBody = (await invalidPayload.json()) as { error: { code: string } };
    expect(invalidBody.error.code).toBe("SUBMISSION_INVALID");

    const noReference = await postSubmission(app, env, { reference: {} });
    expect(noReference.status).toBe(400);

    const badMode = await postSubmission(app, env, { buildMode: "MOOD_BOARD" });
    expect(badMode.status).toBe(400);
  });

  it("exposes only canonical V2 lifecycle vocabulary on the observable seams", async () => {
    const siteGenerationId = await postScreenshotSubmission(app, env);
    const build = await runWebsiteBuildWorkflow(env, siteGenerationId);

    const generationResponse = await app.request(
      `https://test.example.com/api/v2/site-generations/${siteGenerationId}`, {}, env
    );
    const buildResponse = await app.request(`https://test.example.com/api/v2/builds/${build.buildId}`, {}, env);
    const observableJson = `${await generationResponse.text()}\n${await buildResponse.text()}`;

    for (const canonical of ["siteGenerationId", "onboardingSubmissionId", "buildMode", "INTAKE_READY", "versions", "workflowEvents"]) {
      expect(observableJson).toContain(canonical);
    }
    // V1 concepts must not appear anywhere in the V2 lifecycle representation.
    for (const v1Term of ["client_id", "clientId", "clientSlug", "job_id", "jobId", "jobType", "waiting_approval", "site_version", "siteVersion", "style_key"]) {
      expect(observableJson).not.toContain(v1Term);
    }
  });
});
