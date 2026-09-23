// Admin draft review/edit + Validate & Generate (operator GO 2026-09-12):
// the admin edits the mutable draft, chooses the Build Mode, and the ONE
// idempotent Validate & Generate action constructs the canonical immutable
// Onboarding Submission and starts the existing pipeline. The client never
// chooses the Build Mode and never creates generations.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import { submitClientIntake } from "../src/routes/public-client-intake";
import {
  patchDraft,
  uploadDraftReferenceScreenshot,
  validateAndGenerateDraft,
  regenerateDraft,
  getDraft,
  listDrafts,
} from "../src/routes/admin-api";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { createAccessHarness, type AccessHarness } from "./helpers/access-test";

function runtimeEnv(createWorkflow: ReturnType<typeof vi.fn> = vi.fn()): Env {
  // Registry-backed workflow double matching the REAL binding contract the
  // idempotent starter relies on: get(id) throws when the instance does not
  // exist, create({ id }) registers it. A retry with the same deterministic
  // id therefore converges on the existing instance (Step 5 crash-safety).
  const instances = new Map<string, { id: string }>();
  const binding = {
    create: async (options: { id?: string; params: { siteGenerationId: string } }) => {
      const instance = await (createWorkflow as (options: unknown) => Promise<{ id: string }>)(options);
      instances.set(options?.id ?? instance.id, instance);
      return instance;
    },
    get: async (id: string) => {
      const instance = instances.get(id);
      if (!instance) throw new Error(`workflow instance ${id} not found`);
      return instance;
    },
  };
  return {
    ...(providedEnv as unknown as Env),
    ...access.envVars,
    WEBHOOK_SECRET: "test-webhook-secret",
    // Dedicated client-intake Turnstile secret (split from the generated-sites
    // Form Service secret, operator GO 2026-09-13).
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    CLIENT_INTAKE_TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    SITE_BUCKET: (providedEnv as unknown as Env).SITE_BUCKET,
    WEBSITE_BUILD_WORKFLOW: binding as unknown as Workflow,
  };
}

function fullApp(env: Env): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/api/public/client-intakes", submitClientIntake);
  app.get("/api/admin/intake-drafts", listDrafts);
  app.patch("/api/admin/intake-drafts/:draftId", patchDraft);
  app.get("/api/admin/intake-drafts/:draftId", getDraft);
  app.post("/api/admin/intake-drafts/:draftId/reference-screenshot", uploadDraftReferenceScreenshot);
  app.post("/api/admin/intake-drafts/:draftId/validate-and-generate", validateAndGenerateDraft);
  app.post("/api/admin/intake-drafts/:draftId/regenerate", regenerateDraft);
  return app;
}

// Unique team domain per file keeps the guard's per-host cert cache isolated.
const access: AccessHarness = await createAccessHarness("admin-drafts");
// Filled in beforeAll with a genuinely signed Access assertion (the guard
// cryptographically verifies every admin request — no presence-only mode).
const ACCESS_HEADERS: Record<string, string> = {};
const ORIGIN = "https://wazibiz.ke";

async function createDraftViaPublicForm(env: Env, businessName: string): Promise<string> {
  const app = fullApp(env);
  const response = await app.request("https://test.example.com/api/public/client-intakes", {
    method: "POST",
    // Unique remote address per draft: the public intake rate limiter is keyed
    // by hashed IP over shared test storage.
    headers: { "content-type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": crypto.randomUUID() },
    body: JSON.stringify({
      submitter: { name: "Admin Flow Tester", email: "flow@submitter.example" },
      business: {
        businessName,
        contactEmail: `hello@${businessName.toLowerCase().replace(/[^a-z]/g, "")}.example`,
        businessDescription: "Test brief for the admin conversion flow.",
        ...canonicalStructuredFacts(),
      },
      designPreferences: { direction: "Warm editorial minimalism" },
      turnstileToken: "valid-token",
    }),
  }, env);
  expect(response.status).toBe(201);
  const body = (await response.json()) as { draftId: string };
  return body.draftId;
}

// A minimal decodable PNG for the screenshot upload path.
function tinyPngBase64(): string {
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
}

beforeAll(async () => {
  // The team certs URL is served the harness JWKS; every other URL (Turnstile
  // siteverify) succeeds deterministically for the public-intake setup path.
  access.stubFetch();
  ACCESS_HEADERS["Cf-Access-Jwt-Assertion"] = await access.signToken();
});

describe("admin draft review, edit and conversion", () => {
  it("denies admin APIs without the Cloudflare Access assertion", async () => {
    const env = runtimeEnv();
    const app = fullApp(env);
    const response = await app.request("https://test.example.com/api/admin/intake-drafts", { method: "GET" }, env);
    expect(response.status).toBe(401);
  });

  it("edits the draft before conversion (marking it IN REVIEW) and keeps submitter data private", async () => {
    const env = runtimeEnv();
    const draftId = await createDraftViaPublicForm(env, "Edit Flow Interiors");
    const app = fullApp(env);

    const patched = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({
        business: {
          businessName: "Edit Flow Interiors",
          contactEmail: "hello@editflowinteriors.example",
          businessDescription: "Admin-corrected description.",
          ...canonicalStructuredFacts(),
        },
        adminNotes: "Call the submitter Tuesday — NOT a public contact.",
        markInReview: true,
      }),
    }, env);
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as { draft: { status: string; payload: { business: { businessDescription: string } }; adminNotes: string | null } };
    expect(body.draft.status).toBe("IN_REVIEW");
    expect(body.draft.payload.business.businessDescription).toBe("Admin-corrected description.");
    expect(body.draft.adminNotes).toContain("NOT a public contact");

    // No generation is linked to THIS draft by an admin edit (pre-canonical).
    const draftAfter = await env.DB.prepare(
      "SELECT converted_site_generation_id, converted_onboarding_submission_id FROM client_intake_drafts WHERE id = ?"
    )
      .bind(draftId)
      .first<{ converted_site_generation_id: string | null; converted_onboarding_submission_id: string | null }>();
    expect(draftAfter).toMatchObject({ converted_site_generation_id: null, converted_onboarding_submission_id: null });
  });

  it("Validate & Generate as ORIGINAL_DESIGN builds the canonical payload, starts the workflow and links the draft", async () => {
    const createWorkflow = vi.fn(async () => ({ id: "w-od-instance" }));
    const env = runtimeEnv(createWorkflow);
    const draftId = await createDraftViaPublicForm(env, "Original Mode Atelier");
    const app = fullApp(env);

    const response = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({
        buildMode: "ORIGINAL_DESIGN",
        creativeDirection: {
          direction: "Gallery-clean warm minimalism with generous whitespace",
          preferredPalette: "Bone #F5F1E8, ink #23211C, moss #7A8450",
        },
      }),
    }, env);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      siteId: string;
      onboardingSubmissionId: string;
      siteGenerationId: string;
      workflowInstanceId: string;
    };
    expect(body.siteGenerationId).toBeTruthy();
    // Exactly-once start (Step 5): the instance id is deterministic per generation.
    expect(createWorkflow).toHaveBeenCalledWith({
      id: `${body.siteGenerationId}-initial`,
      params: { siteGenerationId: body.siteGenerationId },
    });

    // Canonical submission: mode + facts + creativeDirection; NO reference.
    const submission = await env.DB.prepare("SELECT payload_json, fact_snapshot_json FROM onboarding_submissions WHERE id = ?")
      .bind(body.onboardingSubmissionId)
      .first<{ payload_json: string; fact_snapshot_json: string }>();
    const payload = JSON.parse(submission!.payload_json) as Record<string, unknown>;
    expect(payload.buildMode).toBe("ORIGINAL_DESIGN");
    expect(payload.creativeDirection).toMatchObject({ direction: "Gallery-clean warm minimalism with generous whitespace" });
    expect(payload.reference).toBeUndefined();
    const facts = JSON.parse(submission!.fact_snapshot_json) as Record<string, unknown>;
    expect(facts.services).toHaveLength(3);
    expect((facts.businessHours as Record<string, unknown>).monday).toMatchObject({ status: "OPEN" });

    // Draft linked + immutable.
    const draftRow = await env.DB.prepare(
      "SELECT status, converted_site_generation_id, converted_build_mode FROM client_intake_drafts WHERE id = ?"
    )
      .bind(draftId)
      .first<{ status: string; converted_site_generation_id: string; converted_build_mode: string }>();
    expect(draftRow?.status).toBe("GENERATION_STARTED");
    expect(draftRow?.converted_site_generation_id).toBe(body.siteGenerationId);
    expect(draftRow?.converted_build_mode).toBe("ORIGINAL_DESIGN");

    // Post-conversion edits are rejected (immutability boundary).
    const edit = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ adminNotes: "too late" }),
    }, env);
    expect(edit.status).toBe(409);
  });

  it("repeated Validate & Generate is idempotent and refuses a different Build Mode", async () => {
    const createWorkflow = vi.fn(async () => ({ id: "w-idem-instance" }));
    const env = runtimeEnv(createWorkflow);
    const draftId = await createDraftViaPublicForm(env, "Idempotent Mode Studio");
    const app = fullApp(env);
    const generateBody = {
      buildMode: "ORIGINAL_DESIGN",
      creativeDirection: { direction: "Industrial honest-materials system" },
    };

    const first = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify(generateBody),
    }, env);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { siteGenerationId: string };

    const second = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify(generateBody),
    }, env);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { siteGenerationId: string; alreadyConverted: boolean };
    expect(secondBody.alreadyConverted).toBe(true);
    expect(secondBody.siteGenerationId).toBe(firstBody.siteGenerationId);
    expect(createWorkflow).toHaveBeenCalledTimes(1);

    const generations = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM site_generations g JOIN client_intake_drafts d ON d.converted_site_generation_id = g.id WHERE d.id = ?"
    )
      .bind(draftId)
      .first<{ n: number }>();
    expect(generations?.n).toBe(1);

    const modeChange = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "REFERENCE_BOUND", referenceUrl: "https://reference.example.com/" }),
    }, env);
    expect(modeChange.status).toBe(409);
  });

  it("Validate & Generate as REFERENCE_BOUND carries the Reference and never the client's creative preferences", async () => {
    const createWorkflow = vi.fn(async () => ({ id: "w-rb-instance" }));
    const env = runtimeEnv(createWorkflow);
    const draftId = await createDraftViaPublicForm(env, "Reference Mode Works");
    const app = fullApp(env);

    const response = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({
        buildMode: "REFERENCE_BOUND",
        referenceUrl: "https://reference.example.com/inspiration",
      }),
    }, env);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { onboardingSubmissionId: string };
    const submission = await env.DB.prepare("SELECT payload_json FROM onboarding_submissions WHERE id = ?")
      .bind(body.onboardingSubmissionId)
      .first<{ payload_json: string }>();
    const payload = JSON.parse(submission!.payload_json) as Record<string, unknown>;
    expect(payload.buildMode).toBe("REFERENCE_BOUND");
    expect(payload.reference).toMatchObject({ url: "https://reference.example.com/inspiration" });
    expect(payload.creativeDirection).toBeUndefined();
  });

  it("stores an uploaded Reference screenshot in R2 and records the exact key on the draft", async () => {
    const env = runtimeEnv();
    const draftId = await createDraftViaPublicForm(env, "Screenshot Upload Co");
    const app = fullApp(env);

    const response = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/reference-screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ filename: "reference.png", contentBase64: tinyPngBase64() }),
    }, env);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { referenceScreenshotR2Key: string };
    expect(body.referenceScreenshotR2Key).toContain(`reference-screenshots/drafts/${draftId}/`);

    const stored = await env.SITE_BUCKET.get(body.referenceScreenshotR2Key);
    expect(stored).not.toBeNull();

    const draftResponse = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}`, {
      headers: ACCESS_HEADERS,
    }, env);
    const draftBody = (await draftResponse.json()) as { draft: { payload: { referenceScreenshotR2Key: string } } };
    expect(draftBody.draft.payload.referenceScreenshotR2Key).toBe(body.referenceScreenshotR2Key);

    // Non-image content is rejected.
    const rejected = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/reference-screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ filename: "not-image.png", contentBase64: Buffer.from("plain text, not an image").toString("base64") }),
    }, env);
    expect(rejected.status).toBe(400);
  });

  it("rejects ORIGINAL_DESIGN conversion when the draft carries Reference input, and REFERENCE_BOUND without any reference", async () => {
    const env = runtimeEnv();
    const app = fullApp(env);
    const draftId = await createDraftViaPublicForm(env, "Cross Mode Guard Co");

    // Give the draft a reference URL, then try ORIGINAL_DESIGN: rejected.
    await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ referenceUrl: "https://reference.example.com/page" }),
    }, env);
    const asOriginal = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "ORIGINAL_DESIGN", creativeDirection: { direction: "x" } }),
    }, env);
    expect(asOriginal.status).toBe(400);

    // REFERENCE_BOUND with the reference REMOVED but no screenshot: rejected.
    await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ referenceUrl: null }),
    }, env);
    const asReference = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "REFERENCE_BOUND" }),
    }, env);
    expect(asReference.status).toBe(400);
  });

  it("a workflow start failure marks the draft but a retry heals without a second generation", async () => {
    // First attempt: workflow creation throws AFTER the conversion markers
    // commit (Step 5 ordering) — the draft is marked, the generation exists,
    // and the API surfaces a retryable WORKFLOW_START_FAILED (502).
    const failing = runtimeEnv(vi.fn(async () => { throw new Error("binding unavailable"); }));
    const draftId = await createDraftViaPublicForm(failing, "Healable Start Studio");
    const app = fullApp(failing);
    const generateBody = { buildMode: "ORIGINAL_DESIGN", creativeDirection: { direction: "Calm procedural clarity" } };

    const failed = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify(generateBody),
    }, failing);
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("WORKFLOW_START_FAILED");

    const draftRow = await failing.DB.prepare(
      "SELECT status, converted_site_generation_id FROM client_intake_drafts WHERE id = ?"
    )
      .bind(draftId)
      .first<{ status: string; converted_site_generation_id: string }>();
    expect(draftRow?.status).toBe("GENERATION_STARTED");
    expect(draftRow?.converted_site_generation_id).toBeTruthy();

    // Retry with a healthy binding: the SAME generation is used — no second
    // Site Generation, no second Business — and the workflow starts.
    const healthy = runtimeEnv(vi.fn(async () => ({ id: "w-healed-instance" })));
    const retry = await fullApp(healthy).request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify(generateBody),
    }, healthy);
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { alreadyConverted: boolean; workflowInstanceId: string; siteGenerationId: string };
    expect(retryBody.alreadyConverted).toBe(true);
    // The healed start reuses the DETERMINISTIC instance id for the generation.
    expect(retryBody.workflowInstanceId).toBe(`${draftRow?.converted_site_generation_id}-initial`);
    expect(retryBody.siteGenerationId).toBe(draftRow?.converted_site_generation_id);

    const generations = await healthy.DB.prepare(
      "SELECT COUNT(*) AS n FROM site_generations g JOIN client_intake_drafts d ON d.converted_site_generation_id = g.id WHERE d.id = ?"
    )
      .bind(draftId)
      .first<{ n: number }>();
    expect(generations?.n).toBe(1);
  });

  it("recovery regeneration creates a fresh submission + generation on the SAME site after a terminal gate", async () => {
    const { createInitialBuild, appendBuildWorkflowEvent } = await import("../src/domain/lifecycle");
    const env = runtimeEnv(vi.fn(async () => ({ id: "w-recovery-instance" })));
    const draftId = await createDraftViaPublicForm(env, "Recovery Path Studio");
    const app = fullApp(env);

    // Convert once (REFERENCE_BOUND with a reference URL).
    const first = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "REFERENCE_BOUND", referenceUrl: "https://reference.example.com/original" }),
    }, env);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { siteId: string; siteGenerationId: string; onboardingSubmissionId: string };
    const submissionsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM onboarding_submissions WHERE site_id = ?").bind(firstBody.siteId).first<{ n: number }>();

    // The gated terminal state that opens recovery (canonical event writer).
    const initial = await createInitialBuild(env, { siteGenerationId: firstBody.siteGenerationId });
    await appendBuildWorkflowEvent(env, {
      buildId: initial.buildId,
      fromState: "CONFIRMATION",
      toState: "HUMAN_REVIEW_REQUIRED",
      stage: "simple_final_qa",
      detail: "Final QA still failing after the ONE pre-QA repair: visual fidelity 86 < 90",
    });

    const recovery = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: "{}",
    }, env);
    expect(recovery.status).toBe(201);
    const body = (await recovery.json()) as {
      recovered: { siteId: string; siteGenerationId: string; healedWorkflowStart: boolean; workflowInstanceId: string };
    };
    expect(body.recovered.siteId).toBe(firstBody.siteId);
    expect(body.recovered.siteGenerationId).not.toBe(firstBody.siteGenerationId);
    expect(body.recovered.healedWorkflowStart).toBe(false);
    expect(body.recovered.workflowInstanceId).toBe(`${body.recovered.siteGenerationId}-initial`);

    // Fresh immutable submission, SAME site, sequence 2; the original is untouched.
    const submissionsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM onboarding_submissions WHERE site_id = ?").bind(firstBody.siteId).first<{ n: number }>();
    expect(submissionsAfter!.n).toBe(submissionsBefore!.n + 1);
    const sequence = await env.DB.prepare("SELECT sequence_number FROM site_generations WHERE id = ?").bind(body.recovered.siteGenerationId).first<{ sequence_number: number }>();
    expect(sequence?.sequence_number).toBe(2);
    const original = await env.DB.prepare("SELECT payload_json FROM onboarding_submissions WHERE id = ?").bind(firstBody.onboardingSubmissionId).first<{ payload_json: string }>();
    expect(JSON.parse(original!.payload_json)).toMatchObject({ buildMode: "REFERENCE_BOUND" });

    // The draft's recovery pointer governs the NEW generation; original provenance stays.
    const draftRow = await env.DB.prepare(
      "SELECT converted_site_generation_id, recovered_site_generation_id FROM client_intake_drafts WHERE id = ?"
    )
      .bind(draftId)
      .first<{ converted_site_generation_id: string; recovered_site_generation_id: string }>();
    expect(draftRow?.converted_site_generation_id).toBe(firstBody.siteGenerationId);
    expect(draftRow?.recovered_site_generation_id).toBe(body.recovered.siteGenerationId);
  });

  it("recovery regeneration is refused while the latest build is not terminally failed", async () => {
    const { createInitialBuild } = await import("../src/domain/lifecycle");
    const env = runtimeEnv(vi.fn(async () => ({ id: "w-running-instance" })));
    const draftId = await createDraftViaPublicForm(env, "Still Running Studio");
    const app = fullApp(env);

    const first = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "REFERENCE_BOUND", referenceUrl: "https://reference.example.com/running" }),
    }, env);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { siteGenerationId: string };

    // A build that exists but has NOT terminally failed (INTAKE_READY) blocks recovery.
    await createInitialBuild(env, { siteGenerationId: firstBody.siteGenerationId });
    const refused = await app.request(`https://test.example.com/api/admin/intake-drafts/${draftId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: "{}",
    }, env);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe("RECOVERY_CONFLICT");
  });

  it("recovery regeneration heals a governed generation whose workflow never started", async () => {
    const env = runtimeEnv(vi.fn(async () => ({ id: "w-heal-recovery-instance" })));
    const draftId = await createDraftViaPublicForm(env, "Heal Recovery Studio");
    const app = fullApp(env);

    // Convert with a FAILING workflow start: generation exists, no builds.
    const failing = runtimeEnv(vi.fn(async () => { throw new Error("binding down"); }));
    const failed = await fullApp(failing).request(`https://test.example.com/api/admin/intake-drafts/${draftId}/validate-and-generate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: JSON.stringify({ buildMode: "REFERENCE_BOUND", referenceUrl: "https://reference.example.com/heal" }),
    }, failing);
    expect(failed.status).toBe(502);

    const healthy = runtimeEnv(vi.fn(async () => ({ id: "w-heal-recovery-instance" })));
    const healed = await fullApp(healthy).request(`https://test.example.com/api/admin/intake-drafts/${draftId}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json", ...ACCESS_HEADERS },
      body: "{}",
    }, healthy);
    expect(healed.status).toBe(201);
    const body = (await healed.json()) as { recovered: { healedWorkflowStart: boolean; siteGenerationId: string } };
    expect(body.recovered.healedWorkflowStart).toBe(true);

    // NO second generation was stacked on top of the healed one.
    const generations = await healthy.DB.prepare(
      "SELECT COUNT(*) AS n FROM site_generations g JOIN client_intake_drafts d ON COALESCE(d.recovered_site_generation_id, d.converted_site_generation_id) = g.id WHERE d.id = ?"
    )
      .bind(draftId)
      .first<{ n: number }>();
    expect(generations?.n).toBe(1);
  });
});
