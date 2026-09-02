import { beforeAll, describe, expect, it, vi } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { Env } from "../src/env.d";
import { submitOnboardingSubmission } from "../src/routes/v2.onboarding-submit";
import { createRevisionRequest, getRevisionRequest } from "../src/routes/v2.revision-request";
import { WebsiteBuildWorkflow } from "../src/workflows/website-build-workflow";
import {
  createNextBuildVersion,
  getSiteGenerationView,
  startSiteGeneration,
} from "../src/domain/lifecycle";
import {
  RevisionError,
  createRevisionBuild,
  getEffectiveBusinessFacts,
  getRevisionRequestView,
} from "../src/domain/revision";
import { generateId, hmacSha256 } from "../src/lib/crypto";

// Primary-seam tests for the Revision Request / Fact Update lifecycle (issue #5).

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
  app.post("/api/v2/builds/:buildId/revision-requests", createRevisionRequest);
  app.get("/api/v2/builds/:buildId/revision-requests/latest", getRevisionRequest);
  return app;
}

function submissionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buildMode: "REFERENCE_BOUND",
    facts: {
      businessName: "Rift Valley Roasters",
      contactEmail: "hello@riftvalleyroasters.example",
      businessType: "coffee roastery",
      phoneNumber: "+254 700 111 222",
      city: "Nakuru",
      country: "Kenya",
    },
    reference: {
      url: "https://reference.example.com/",
      screenshotR2Key: "references/uploads/abc123.png",
    },
    ...overrides,
  };
}

async function postJson(
  app: Hono<{ Bindings: Env }>,
  env: Env,
  path: string,
  body: unknown
): Promise<Response> {
  const raw = JSON.stringify(body);
  return app.request(
    `https://test.example.com${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "X-Signature": await hmacSha256(env.WEBHOOK_SECRET, raw) },
      body: raw,
    },
    env
  );
}

async function createInitialBuildViaWorkflow(env: Env): Promise<{
  siteGenerationId: string;
  buildId: string;
  buildVersionId: string;
}> {
  const submission = await startSiteGeneration(env, { payload: submissionPayload() });
  const workflow = Object.assign(Object.create(WebsiteBuildWorkflow.prototype), { env }) as WebsiteBuildWorkflow;
  const step = { do: async (_name: string, a: unknown, b?: unknown) => await (typeof b === "function" ? (b as () => Promise<unknown>) : (a as () => Promise<unknown>))() } as unknown as WorkflowStep;
  const event = { payload: { siteGenerationId: submission.siteGenerationId } } as unknown as WorkflowEvent<{
    siteGenerationId: string;
  }>;
  const result = (await workflow.run(event, step)) as { buildId: string; buildVersionId: string };
  return { siteGenerationId: submission.siteGenerationId, ...result };
}

describe("Revision Request and Fact Update lifecycle", () => {
  let env: Env;
  let app: Hono<{ Bindings: Env }>;

  beforeAll(() => {
    env = runtimeEnv();
    app = v2App(env);
  });

  it("creates a NEW Build (not a new Build Version) that preserves Reference and Build Mode", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    const response = await postJson(app, env, `/api/v2/builds/${initial.buildId}/revision-requests`, {
      revisionRequest: {
        changes: { facts: { phoneNumber: "+254 700 999 888" } },
        requestNote: "New phone number",
      },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      revisionRequestId: string;
      buildId: string;
      buildVersionNumber: number;
      factUpdateCount: number;
    };
    expect(body.buildId).not.toBe(initial.buildId);
    expect(body.buildVersionNumber).toBe(1);
    expect(body.factUpdateCount).toBe(1);

    const revisionBuild = await env.DB.prepare("SELECT * FROM builds WHERE id = ?")
      .bind(body.buildId)
      .first<{ kind: string; parent_build_id: string; site_generation_id: string; state: string }>();
    expect(revisionBuild!.kind).toBe("revision");
    expect(revisionBuild!.parent_build_id).toBe(initial.buildId);
    expect(revisionBuild!.site_generation_id).toBe(initial.siteGenerationId);
    expect(revisionBuild!.state).toBe("INTAKE_READY");

    // The parent Build keeps exactly its own versions — no version was added.
    const parentVersions = await env.DB.prepare(
      "SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
    )
      .bind(initial.buildId)
      .all<{ version_number: number }>();
    expect((parentVersions.results ?? []).map((row) => row.version_number)).toEqual([1]);

    // Read model exposes the Fact Update.
    const view = await getRevisionRequestView(env, body.buildId);
    expect(view!.parentBuildId).toBe(initial.buildId);
    expect(view!.factUpdates).toEqual([{ field: "phoneNumber", value: "+254 700 999 888" }]);
  });

  it("stores Fact Updates for the new lineage while the historical submission stays unchanged", async () => {
    const initial = await createInitialBuildViaWorkflow(env);
    const submissionBefore = await env.DB.prepare(
      "SELECT fact_snapshot_json FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(initial.siteGenerationId)
      .first<{ fact_snapshot_json: string }>();

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: { phoneNumber: "+254 700 777 000", city: "Naivasha" } } },
    });

    const submissionAfter = await env.DB.prepare(
      "SELECT fact_snapshot_json FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(initial.siteGenerationId)
      .first<{ fact_snapshot_json: string }>();
    expect(submissionAfter!.fact_snapshot_json).toBe(submissionBefore!.fact_snapshot_json);

    const effective = await getEffectiveBusinessFacts(env, revision.buildId);
    expect(effective.facts.phoneNumber).toBe("+254 700 777 000");
    expect(effective.facts.city).toBe("Naivasha");
    expect(effective.facts.businessName).toBe("Rift Valley Roasters");

    // The parent Build's effective facts are untouched.
    const parentFacts = await getEffectiveBusinessFacts(env, initial.buildId);
    expect(parentFacts.facts.phoneNumber).toBe("+254 700 111 222");
    expect(parentFacts.facts.city).toBe("Nakuru");
  });

  it("keeps Fact Updates effective in later Revision Requests until explicitly changed again", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    const first = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: { phoneNumber: "+254 700 123 456" } } },
    });
    const second = await createRevisionBuild(env, {
      parentBuildId: first.buildId,
      payload: { changes: { facts: { city: "Eldoret" } } },
    });
    const secondFacts = await getEffectiveBusinessFacts(env, second.buildId);
    expect(secondFacts.facts.phoneNumber).toBe("+254 700 123 456");
    expect(secondFacts.facts.city).toBe("Eldoret");
    expect(secondFacts.lineage.map((entry) => entry.kind)).toEqual(["initial", "revision", "revision"]);

    const third = await createRevisionBuild(env, {
      parentBuildId: second.buildId,
      payload: { changes: { facts: { phoneNumber: "+254 700 000 111" } } },
    });
    const thirdFacts = await getEffectiveBusinessFacts(env, third.buildId);
    expect(thirdFacts.facts.phoneNumber).toBe("+254 700 000 111");
    expect(thirdFacts.facts.city).toBe("Eldoret");
  });

  it("rejects Reference or Build Mode changes from the Revision Request path", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    await expect(
      createRevisionBuild(env, {
        parentBuildId: initial.buildId,
        payload: { changes: { facts: {} }, buildMode: "ORIGINAL_DESIGN" },
      })
    ).rejects.toMatchObject({ code: "DESIGN_ORIGIN_IMMUTABLE" });

    await expect(
      createRevisionBuild(env, {
        parentBuildId: initial.buildId,
        payload: { changes: { facts: {}, reference: { url: "https://other.example.com/" } } },
      })
    ).rejects.toMatchObject({ code: "DESIGN_ORIGIN_IMMUTABLE" });

    await expect(
      createRevisionBuild(env, {
        parentBuildId: initial.buildId,
        payload: { changes: { facts: { url: "https://sneaky.example.com/" } } },
      })
    ).rejects.toMatchObject({ code: "DESIGN_ORIGIN_IMMUTABLE" });

    const routeResponse = await postJson(app, env, `/api/v2/builds/${initial.buildId}/revision-requests`, {
      revisionRequest: { changes: { facts: { city: "Kisumu" } }, reference: { screenshotR2Key: "x.png" } },
    });
    expect(routeResponse.status).toBe(422);
    const routeBody = (await routeResponse.json()) as { error: { code: string } };
    expect(routeBody.error.code).toBe("DESIGN_ORIGIN_IMMUTABLE");

    // Nothing was written.
    const builds = await env.DB.prepare("SELECT COUNT(*) AS n FROM builds WHERE site_generation_id = ?")
      .bind(initial.siteGenerationId)
      .first<{ n: number }>();
    expect(builds!.n).toBe(1);
  });

  it("rejects Fact Updates that would invalidate the Business Facts snapshot", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    await expect(
      createRevisionBuild(env, {
        parentBuildId: initial.buildId,
        payload: { changes: { facts: { businessName: null } } },
      })
    ).rejects.toMatchObject({ code: "FACT_UPDATE_INVALID" });

    await expect(
      createRevisionBuild(env, { parentBuildId: initial.buildId, payload: { changes: { facts: { city: 42 } } } })
    ).rejects.toMatchObject({ code: "REVISION_INVALID" });

    await expect(
      createRevisionBuild(env, { parentBuildId: generateId(), payload: { changes: { facts: {} } } })
    ).rejects.toMatchObject({ code: "BUILD_NOT_FOUND" });
  });

  it("distinguishes Revision Request from Automated Repair and Site Generation replacement", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    // Automated Repair: new immutable Build Version INSIDE the same Build.
    const repair = await createNextBuildVersion(env, {
      buildId: initial.buildId,
      cause: "automated_repair",
      detail: "bounded Automated Repair batch",
    });
    expect(repair.buildId).toBe(initial.buildId);
    expect(repair.buildVersionNumber).toBe(2);

    // Revision Request: new Build with its own version 1.
    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: { phoneNumber: "+254 700 555 000" } } },
    });
    expect(revision.buildId).not.toBe(initial.buildId);
    expect(revision.buildVersionNumber).toBe(1);

    const repairVersions = await env.DB.prepare(
      "SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number"
    )
      .bind(initial.buildId)
      .all<{ version_number: number }>();
    expect((repairVersions.results ?? []).map((row) => row.version_number)).toEqual([1, 2]);

    // Site Generation replacement: new generation from a fresh submission,
    // never reachable through the revision path.
    const replacement = await startSiteGeneration(env, {
      siteId: (await env.DB.prepare("SELECT site_id FROM site_generations WHERE id = ?")
        .bind(initial.siteGenerationId)
        .first<{ site_id: string }>())!.site_id,
      payload: submissionPayload({ buildMode: "ORIGINAL_DESIGN", reference: undefined }),
    });
    expect(replacement.siteGenerationId).not.toBe(initial.siteGenerationId);
    expect(replacement.sequenceNumber).toBe(2);

    const view = await getSiteGenerationView(env, initial.siteGenerationId);
    expect(view!.builds.map((build) => build.kind)).toEqual(["initial", "revision"]);
  });

  it("enforces Fact Update and Revision Request immutability at the storage boundary", async () => {
    const initial = await createInitialBuildViaWorkflow(env);
    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { changes: { facts: { city: "Mombasa" } } },
    });

    const factUpdate = await env.DB.prepare("SELECT id FROM fact_updates WHERE build_id = ?")
      .bind(revision.buildId)
      .first<{ id: string }>();

    await expect(
      env.DB.prepare("UPDATE fact_updates SET value_json = '\"Nairobi\"' WHERE id = ?").bind(factUpdate!.id).run()
    ).rejects.toThrow("FACT_UPDATE_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM fact_updates WHERE id = ?").bind(factUpdate!.id).run()
    ).rejects.toThrow("FACT_UPDATE_IMMUTABLE");

    await expect(
      env.DB.prepare("UPDATE revision_requests SET request_note = 'x' WHERE id = ?")
        .bind(revision.revisionRequestId)
        .run()
    ).rejects.toThrow("REVISION_REQUEST_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM revision_requests WHERE id = ?").bind(revision.revisionRequestId).run()
    ).rejects.toThrow("REVISION_REQUEST_IMMUTABLE");
  });

  it("serves the latest Revision Request over the route and 404s for plain Builds", async () => {
    const initial = await createInitialBuildViaWorkflow(env);

    const missing = await app.request(
      `https://test.example.com/api/v2/builds/${initial.buildId}/revision-requests/latest`, {}, env
    );
    expect(missing.status).toBe(404);

    const revision = await createRevisionBuild(env, {
      parentBuildId: initial.buildId,
      payload: { requestNote: "Tighten homepage headline" },
    });
    const found = await app.request(
      `https://test.example.com/api/v2/builds/${revision.buildId}/revision-requests/latest`, {}, env
    );
    expect(found.status).toBe(200);
    const body = (await found.json()) as { requestNote: string | null; factUpdates: unknown[] };
    expect(body.requestNote).toBe("Tighten homepage headline");
    expect(body.factUpdates).toEqual([]);
  });

  it("rejects unsigned revision intake", async () => {
    const initial = await createInitialBuildViaWorkflow(env);
    const response = await app.request(
      `https://test.example.com/api/v2/builds/${initial.buildId}/revision-requests`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revisionRequest: { changes: { facts: {} } } }),
      },
      env
    );
    expect(response.status).toBe(401);
    expect(RevisionError.name).toBe("RevisionError");
  });
});
