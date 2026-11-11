// One-click default Adaptation Contract (operator GO 2026-11-11). Live
// evidence 2026-11-11: a REFERENCE_BOUND intake classified
// SUPPORTED_WITH_LIMITATIONS (heavy_parallax) and, with no contract supplied,
// the reference-capture step retried for ~an hour under the transient
// classification before WORKFLOW_EXECUTION_EXHAUSTED. This suite covers the
// four pieces: the deterministic default contract, the terminal failure
// classification, the marker event the pipeline persists, and the
// operator route + review-page card that turn the marker into a fresh
// generation with the contract injected.

import { describe, expect, it, beforeAll } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import { Hono } from "hono";
import type { Env } from "../src/env.d";
import {
  defaultAdaptationContract,
  validateAdaptationContract,
  type SuitabilityDecision,
} from "../src/domain/reference-evidence-schema";
import { ReferenceIntakeError } from "../src/domain/reference-intake";
import { classifyStageFailure } from "../src/domain/stage-failure";
import { startSiteGeneration, createInitialBuild, appendBuildWorkflowEvent } from "../src/domain/lifecycle";
import { registerAdminApiRoutes } from "../src/routes/admin-api";
import { registerAdminPageRoutes } from "../src/routes/admin-pages";
import { createAccessHarness, type AccessHarness } from "./helpers/access-test";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";

const env = providedEnv as unknown as Env;
const access: AccessHarness = await createAccessHarness("admin-adaptation");

function envWith(): Env {
  // The test project declares no workflow binding: a stub with the exact
  // create/get surface startInitialBuildWorkflowIdempotent consumes.
  const workflowStub = {
    create: async ({ id }: { id: string }) => id,
    get: async (_id: string) => {
      throw new Error("not started");
    },
  };
  return { ...(env as unknown as Env), ...access.envVars, WEBSITE_BUILD_WORKFLOW: workflowStub } as unknown as Env;
}

function referencePayload(): Record<string, unknown> {
  return {
    buildMode: "REFERENCE_BOUND",
    facts: {
      businessName: "Kilifi Palm Villas",
      contactEmail: "stay@kilifipalm.example",
      ...(canonicalStructuredFacts()),
    },
    reference: { url: "https://inspiration.example.com/" },
  };
}

function decisionFor(features: string[]): SuitabilityDecision {
  return {
    suitability: features.length > 0 ? "SUPPORTED_WITH_LIMITATIONS" : "SUPPORTED",
    signals: features.map((feature) => ({
      feature,
      identityDefining: false,
      reason: `detected ${feature}`,
      level: "limitation" as const,
    })),
  };
}

describe("defaultAdaptationContract (operator GO 2026-11-11)", () => {
  it("covers every detected limitation with a curated substitute, so validateAdaptationContract passes by construction", () => {
    const features = ["heavy_parallax", "custom_cursor", "exotic_typography"];
    const contract = defaultAdaptationContract(features);
    expect(contract.version).toBe("operator-default-2026-11-11");
    const validation = validateAdaptationContract(contract, decisionFor(features));
    expect(validation).toEqual({ valid: true });
    const substitutes = contract.acceptedApproximations.map((entry) => entry.replaces);
    expect(substitutes).toEqual(features);
  });

  it("unknown limitation kinds get a safe generic substitute that still satisfies coverage", () => {
    const features = ["some_future_feature"];
    const contract = defaultAdaptationContract(features);
    expect(validateAdaptationContract(contract, decisionFor(features))).toEqual({ valid: true });
    expect(contract.unsupportedFeatures[0].reason).toContain("some_future_feature");
  });

  it("refuses an empty feature list loudly instead of fabricating a contract", () => {
    expect(() => defaultAdaptationContract([])).toThrow(/at least one limitation feature/);
  });
});

describe("ADAPTATION_CONTRACT_REQUIRED failure classification", () => {
  it("is DETERMINISTIC_REVIEW_REQUIRED — no engine retry can supply an operator decision", () => {
    const error = new ReferenceIntakeError(
      "ADAPTATION_CONTRACT_REQUIRED",
      "SUPPORTED_WITH_LIMITATIONS Reference requires a concrete Adaptation Contract before generation continues (features: heavy_parallax)",
      ["heavy_parallax"]
    );
    expect(classifyStageFailure(error)).toBe("DETERMINISTIC_REVIEW_REQUIRED");
  });

  it("the error carries the detected limitation features for surfacing", () => {
    const error = new ReferenceIntakeError("ADAPTATION_CONTRACT_REQUIRED", "msg", ["heavy_parallax", "custom_cursor"]);
    expect(error.limitationFeatures).toEqual(["heavy_parallax", "custom_cursor"]);
  });

  it("other ReferenceIntakeError codes stay on their existing classifications", () => {
    const transient = new ReferenceIntakeError("REFERENCE_CAPTURE_FAILED", "network blip");
    expect(classifyStageFailure(transient)).toBe("TRANSIENT_RETRYABLE");
  });
});

describe("accept-default-adaptations operator route", () => {
  const app = new Hono<{ Bindings: Env }>();
  registerAdminApiRoutes(app);
  const api = (siteId: string, generationId: string) =>
    `/api/admin/sites/${siteId}/generations/${generationId}/accept-default-adaptations`;

  async function seedFailedAdaptationGeneration() {
    const started = await startSiteGeneration(env, { payload: referencePayload() });
    const initial = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await appendBuildWorkflowEvent(env, {
      buildId: initial.buildId,
      buildVersionId: initial.buildVersionId,
      fromState: "REFERENCE_CHECK",
      toState: "FAILED",
      stage: "simple_reference_capture",
      detail:
        "ADAPTATION_CONTRACT_REQUIRED awaiting operator adaptation decisions [adaptation-features: heavy_parallax, custom_cursor]",
    });
    await env.DB.prepare("UPDATE builds SET state = 'FAILED' WHERE id = ?").bind(initial.buildId).run();
    return { started, buildId: initial.buildId };
  }

  beforeAll(() => {
    access.stubFetch();
  });

  it("creates a fresh generation with the default contract injected and starts its workflow", async () => {
    const { started } = await seedFailedAdaptationGeneration();
    const response = await app.request(
      `https://admin-test.example.com${api(started.siteId, started.siteGenerationId)}`,
      { method: "POST", headers: await access.validHeaders() },
      envWith()
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      accepted: { features: string[]; contractVersion: string };
      siteGenerationId: string;
      sequenceNumber: number;
      workflowInstanceId: string;
    };
    expect(body.accepted.features).toEqual(["heavy_parallax", "custom_cursor"]);
    expect(body.accepted.contractVersion).toBe("operator-default-2026-11-11");
    expect(body.siteGenerationId).not.toBe(started.siteGenerationId);
    expect(body.sequenceNumber).toBe(started.sequenceNumber + 1);
    expect(body.workflowInstanceId).toBe(`${body.siteGenerationId}-initial`);

    const newSubmission = await env.DB.prepare(
      "SELECT payload_json FROM onboarding_submissions WHERE id = (SELECT onboarding_submission_id FROM site_generations WHERE id = ?)"
    )
      .bind(body.siteGenerationId)
      .first<{ payload_json: string }>();
    const payload = JSON.parse(newSubmission!.payload_json) as { reference?: { adaptationContract?: { version: string; acceptedApproximations: Array<{ replaces: string }> } } };
    expect(payload.reference?.adaptationContract?.version).toBe("operator-default-2026-11-11");
    expect(payload.reference?.adaptationContract?.acceptedApproximations.map((entry) => entry.replaces)).toEqual([
      "heavy_parallax",
      "custom_cursor",
    ]);
  });

  it("409s cleanly on a second acceptance of the same generation (idempotency guard)", async () => {
    const { started } = await seedFailedAdaptationGeneration();
    const first = await app.request(
      `https://admin-test.example.com${api(started.siteId, started.siteGenerationId)}`,
      { method: "POST", headers: await access.validHeaders() },
      envWith()
    );
    expect(first.status).toBe(201);
    const second = await app.request(
      `https://admin-test.example.com${api(started.siteId, started.siteGenerationId)}`,
      { method: "POST", headers: await access.validHeaders() },
      envWith()
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_ACCEPTED");
  });

  it("404s for a generation without a marker (nothing to accept)", async () => {
    const started = await startSiteGeneration(env, { payload: referencePayload() });
    const response = await app.request(
      `https://admin-test.example.com${api(started.siteId, started.siteGenerationId)}`,
      { method: "POST", headers: await access.validHeaders() },
      envWith()
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MARKER_NOT_FOUND");
  });

  it("denies unauthenticated calls (fail-closed Access guard)", async () => {
    const started = await startSiteGeneration(env, { payload: referencePayload() });
    const response = await app.request(
      `https://admin-test.example.com${api(started.siteId, started.siteGenerationId)}`,
      { method: "POST" },
      envWith()
    );
    expect(response.status).toBe(401);
  });
});

describe("review page renders the adaptation card", () => {
  it("shows detected features and the one-click button for a FAILED marker build", async () => {
    const pageApp = new Hono<{ Bindings: Env }>();
    registerAdminPageRoutes(pageApp);

    const started = await startSiteGeneration(env, { payload: referencePayload() });
    const initial = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await appendBuildWorkflowEvent(env, {
      buildId: initial.buildId,
      buildVersionId: initial.buildVersionId,
      fromState: "REFERENCE_CHECK",
      toState: "FAILED",
      stage: "simple_reference_capture",
      detail: "ADAPTATION_CONTRACT_REQUIRED awaiting operator adaptation decisions [adaptation-features: heavy_parallax]",
    });
    await env.DB.prepare("UPDATE builds SET state = 'FAILED' WHERE id = ?").bind(initial.buildId).run();

    const response = await pageApp.request(
      `https://admin-test.example.com/sites/${started.siteId}`,
      { method: "GET", headers: await access.validHeaders() },
      envWith()
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Inspiration site needs adaptation decisions");
    expect(html).toContain("heavy_parallax");
    expect(html).toContain("Accept default adaptations and retry");
    expect(html).toContain("operator-default-2026-11-11");
  });
});
