import { afterEach, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import type { ClientRow, JobRow, SiteRow } from "../src/types";
import { handleFluentFormsWebhook } from "../src/routes/webhook.fluentforms";
import { submitInput } from "../src/routes/jobs.input-submit";
import { createClient, createJob, createSite, fetchJob, getClientById, getReferenceAsset } from "../src/lib/db";
import { generateId, hmacSha256, nowIso, signApprovalToken } from "../src/lib/crypto";
import { getObject, putObject, referenceUploadStagingKey } from "../src/lib/assets";
import { buildPng } from "./helpers/png";

function runtimeEnv(createWorkflow: ReturnType<typeof vi.fn>): Env {
  return {
    ...(providedEnv as unknown as Env),
    WEBHOOK_SECRET: "test-webhook-secret",
    APPROVAL_SECRET: "test-approval-secret",
    PUBLIC_APP_URL: "https://test.example.com",
    SITE_BUILD_WORKFLOW: { create: createWorkflow } as unknown as Workflow,
    SMTP2GO_API_KEY: "test-smtp",
    INTERNAL_NOTIFICATION_EMAIL: "test@example.com",
  };
}

function stubMail(): void {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    data: { error_code: 0, error: "", email_id: "mail-1" },
  })));
}

function webhookApp(env: Env): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/webhook", handleFluentFormsWebhook);
  return app;
}

function inputApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/jobs/:jobId/input", submitInput);
  return app;
}

function webhookPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    company_name: `Example ${generateId()}`,
    client_email: "owner@example.com",
    website_overall_style: "minimalist-monochrome",
    reference_site_url: "https://example.com/",
    reference_homepage_screenshot: `upload-${generateId()}`,
    ...overrides,
  };
}

async function postWebhook(env: Env, payload: Record<string, unknown>): Promise<Response> {
  const body = JSON.stringify(payload);
  return webhookApp(env).request("https://test.example.com/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-WF-Signature": await hmacSha256(env.WEBHOOK_SECRET, body),
    },
    body,
  }, env);
}

async function createNeedsInputJob(env: Env): Promise<{ jobId: string; clientId: string; clientSlug: string }> {
  const now = nowIso();
  const clientId = generateId();
  const siteId = generateId();
  const jobId = generateId();
  const clientSlug = `client-${generateId().slice(0, 8)}`;
  const client: ClientRow = {
    id: clientId,
    slug: clientSlug,
    company_name: "Manual Input Co",
    client_email: "owner@example.com",
    address_line_1: null,
    address_line_2: null,
    city: null,
    county: null,
    zip_code: null,
    country: null,
    business_type: null,
    business_description: null,
    ideal_client_profile: null,
    logo_url: null,
    preferred_colour_1: null,
    preferred_colour_2: null,
    mode: "light",
    website_overall_style: "minimalist-monochrome",
    facebook_url: null,
    instagram_url: null,
    twitter_url: null,
    linkedin_url: null,
    other_social_url: null,
    extra_information: null,
    whatsapp_number: null,
    reference_site_url: null,
    inspiration_url: null,
    created_at: now,
    updated_at: now,
  };
  const site: SiteRow = {
    id: siteId,
    client_id: clientId,
    current_version_id: null,
    status: "pending",
    revisions_count: 0,
    preview_url: null,
    production_url: null,
    style_key: "minimalist-monochrome",
    style_version: "1.0.0",
    created_at: now,
    updated_at: now,
  };
  const job: JobRow = {
    id: jobId,
    site_id: siteId,
    client_id: clientId,
    job_type: "initial_build",
    status: "needs_input",
    current_step: null,
    error_code: null,
    error_message: null,
    job_validation_errors: null,
    workflow_instance_id: null,
    agent_session_id: null,
    raw_payload_r2_key: null,
    created_at: now,
    updated_at: now,
  };
  await createClient(env.DB, client);
  await createSite(env.DB, site);
  await createJob(env.DB, job);
  return { jobId, clientId, clientSlug };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Fluent Forms reference intake routes", () => {
  it("persists both canonical inputs before queueing and creating the Workflow", async () => {
    stubMail();
    let env: Env;
    const createWorkflow = vi.fn(async (options: { params: { jobId: string; intake: { referenceScreenshotR2Key: string | null } } }) => {
      const asset = await getReferenceAsset(env.DB, options.params.jobId, 1, "homepage_screenshot");
      expect(asset?.r2_key).toBe(options.params.intake.referenceScreenshotR2Key);
      expect(asset ? await getObject(env, asset.r2_key) : null).not.toBeNull();
      return { id: "workflow-1" };
    });
    env = runtimeEnv(createWorkflow);
    const uploadId = `upload-${generateId()}`;
    const png = buildPng({ width: 1440, height: 2500 });
    await putObject(env, referenceUploadStagingKey(uploadId), png, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { "original-filename": "homepage.png" },
    });

    const response = await postWebhook(env, webhookPayload({ reference_homepage_screenshot: uploadId }));
    const body = await response.json<{ jobId: string; status: string }>();

    expect(response.status).toBe(202);
    expect(body.status).toBe("queued");
    const job = await fetchJob(env.DB, body.jobId);
    const asset = await getReferenceAsset(env.DB, body.jobId, 1, "homepage_screenshot");
    const client = job ? await getClientById(env.DB, job.client_id) : null;
    expect(job?.status).toBe("queued");
    expect(client?.reference_site_url).toBe("https://example.com/");
    expect(asset).not.toBeNull();
    expect(await getObject(env, asset!.r2_key)).not.toBeNull();
    expect(await getObject(env, referenceUploadStagingKey(uploadId))).toBeNull();
    expect(createWorkflow).toHaveBeenCalledOnce();
    expect(createWorkflow.mock.calls[0][0].params.intake.referenceScreenshotR2Key).toBe(asset!.r2_key);
  });

  it.each([
    ["reference_site_url", { reference_site_url: undefined }],
    ["reference_homepage_screenshot", { reference_homepage_screenshot: undefined }],
  ])("keeps the job in needs_input when %s is missing", async (_field, overrides) => {
    stubMail();
    const createWorkflow = vi.fn();
    const env = runtimeEnv(createWorkflow);
    const response = await postWebhook(env, webhookPayload(overrides));
    const body = await response.json<{ jobId: string; status: string }>();

    expect(response.status).toBe(202);
    expect(body.status).toBe("needs_input");
    expect((await fetchJob(env.DB, body.jobId))?.status).toBe("needs_input");
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it("keeps staging recovery available for an invalid or expired upload id", async () => {
    stubMail();
    const createWorkflow = vi.fn();
    const env = runtimeEnv(createWorkflow);
    const response = await postWebhook(env, webhookPayload({ reference_homepage_screenshot: `missing-${generateId()}` }));
    const body = await response.json<{ jobId: string }>();
    const job = await fetchJob(env.DB, body.jobId);

    expect(response.status).toBe(202);
    expect(job?.status).toBe("needs_input");
    expect(job?.error_code).toBe("REFERENCE_SCREENSHOT_INVALID");
    expect(createWorkflow).not.toHaveBeenCalled();
  });
});

describe("protected reference input form", () => {
  it("persists canonical URL and screenshot before creating the Workflow", async () => {
    let env: Env;
    const createWorkflow = vi.fn(async (options: { params: { jobId: string; intake: { referenceScreenshotR2Key: string | null } } }) => {
      const asset = await getReferenceAsset(env.DB, options.params.jobId, 1, "homepage_screenshot");
      expect(asset?.r2_key).toBe(options.params.intake.referenceScreenshotR2Key);
      expect(asset ? await getObject(env, asset.r2_key) : null).not.toBeNull();
      return { id: "workflow-1" };
    });
    env = runtimeEnv(createWorkflow);
    const { jobId, clientId } = await createNeedsInputJob(env);
    const token = await signApprovalToken(env, { jobId, action: "input", exp: Date.now() + 60_000 });
    const form = new FormData();
    form.set("token", token);
    form.set("referenceSiteUrl", "https://ngongroad.org/");
    form.set("screenshot", new File([buildPng({ width: 1440, height: 2500 })], "homepage.png", { type: "image/png" }));

    const response = await inputApp().request(`https://test.example.com/jobs/${jobId}/input`, { method: "POST", body: form }, env);
    const job = await fetchJob(env.DB, jobId);
    const client = await getClientById(env.DB, clientId);
    const asset = await getReferenceAsset(env.DB, jobId, 1, "homepage_screenshot");

    expect(response.status).toBe(200);
    expect(job?.status).toBe("queued");
    expect(client?.reference_site_url).toBe("https://ngongroad.org/");
    expect(client?.inspiration_url).toBe("https://ngongroad.org/");
    expect(asset).not.toBeNull();
    expect(await getObject(env, asset!.r2_key)).not.toBeNull();
    expect(createWorkflow).toHaveBeenCalledOnce();
  });

  it("rejects a missing token", async () => {
    const env = runtimeEnv(vi.fn());
    const response = await inputApp().request("https://test.example.com/jobs/missing/input", {
      method: "POST",
      body: new FormData(),
    }, env);
    expect(response.status).toBe(401);
  });

  it("rejects a signed token for the wrong action", async () => {
    const env = runtimeEnv(vi.fn());
    const token = await signApprovalToken(env, { jobId: "job-1", action: "approve", exp: Date.now() + 60_000 });
    const form = new FormData();
    form.set("token", token);
    const response = await inputApp().request("https://test.example.com/jobs/job-1/input", { method: "POST", body: form }, env);
    expect(response.status).toBe(403);
  });

  it("rejects missing canonical URL and does not create the Workflow", async () => {
    const createWorkflow = vi.fn();
    const env = runtimeEnv(createWorkflow);
    const { jobId } = await createNeedsInputJob(env);
    const token = await signApprovalToken(env, { jobId, action: "input", exp: Date.now() + 60_000 });
    const form = new FormData();
    form.set("token", token);
    form.set("screenshot", new File([buildPng()], "homepage.png", { type: "image/png" }));

    const response = await inputApp().request(`https://test.example.com/jobs/${jobId}/input`, { method: "POST", body: form }, env);
    expect(response.status).toBe(400);
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it("rejects a corrupt screenshot and does not create the Workflow", async () => {
    const createWorkflow = vi.fn();
    const env = runtimeEnv(createWorkflow);
    const { jobId } = await createNeedsInputJob(env);
    const token = await signApprovalToken(env, { jobId, action: "input", exp: Date.now() + 60_000 });
    const form = new FormData();
    form.set("token", token);
    form.set("referenceSiteUrl", "https://example.com/");
    form.set("screenshot", new File([buildPng({ omitIend: true })], "homepage.png", { type: "image/png" }));

    const response = await inputApp().request(`https://test.example.com/jobs/${jobId}/input`, { method: "POST", body: form }, env);
    expect(response.status).toBe(415);
    expect(createWorkflow).not.toHaveBeenCalled();
  });
});
