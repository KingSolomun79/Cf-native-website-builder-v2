// Admin review QA-outcome surfacing (operator GO 2026-11-09): a Build that
// ended in HUMAN_REVIEW_REQUIRED because QA FAILED after the ONE repair must
// be distinguishable in the review read model from a passing build. The
// read model derives the verdict from the canonical workflow events the
// pipeline already writes — no new lifecycle state is invented.

import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { appendBuildWorkflowEvent } from "../src/domain/lifecycle";
import { getAdminSiteReview } from "../src/domain/admin-review";
import { canonicalStructuredFacts } from "./helpers/canonical-facts";

const env = providedEnv as unknown as Env;

function originalPayload(): Record<string, unknown> {
  return {
    buildMode: "ORIGINAL_DESIGN",
    facts: {
      businessName: "Growth Bridge Media",
      contactEmail: "john@growthbridge.example",
      businessType: "Media marketing agency",
      businessDescription: "A media marketing agency supporting business owners to get quality leads.",
      ...(canonicalStructuredFacts()),
    },
    creativeDirection: {
      direction: "Dark editorial command-deck with cyan accents",
      audience: "Nairobi business owners",
      conversionGoal: "WhatsApp enquiries",
      preferredPalette: "Deep navy with cyan",
      tone: "Confident, precise",
      avoidances: "No generic SaaS cards",
    },
  };
}

async function seedBuildWithEvents(events: Array<{ fromState: string; toState: string; stage: string; detail: string }>) {
  const started = await startSiteGeneration(env, { payload: originalPayload() });
  const initial = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  for (const event of events) {
    await appendBuildWorkflowEvent(env, {
      buildId: initial.buildId,
      buildVersionId: initial.buildVersionId,
      fromState: event.fromState,
      toState: event.toState,
      stage: event.stage,
      detail: event.detail,
    });
  }
  const review = await getAdminSiteReview(env, started.siteId);
  expect(review).not.toBeNull();
  const build = review!.generations[0].builds[0];
  return build;
}

describe("admin review QA-outcome read model (operator GO 2026-11-09)", () => {
  it("a failed final QA exposes status failed, the visual score and the pipeline's reasons", async () => {
    const build = await seedBuildWithEvents([
      {
        fromState: "CONFIRMATION",
        toState: "HUMAN_REVIEW_REQUIRED",
        stage: "simple_final_qa",
        detail:
          "Final QA still failing after the ONE repair: visual fidelity 84 < 90; 3 P1 finding(s); hard composition gate(s) failed: FIRST_VIEWPORT_MATERIALLY_CORRECT, PAGE_SILHOUETTE_REGION_ORDER",
      },
    ]);
    expect(build.state).toBe("HUMAN_REVIEW_REQUIRED");
    expect(build.qaOutcome).not.toBeNull();
    expect(build.qaOutcome!.status).toBe("failed");
    expect(build.qaOutcome!.visualScore).toBe(84);
    expect(build.qaOutcome!.reasons).toContain("visual fidelity 84 < 90");
    expect(build.qaOutcome!.reasons.some((reason) => reason.includes("FIRST_VIEWPORT_MATERIALLY_CORRECT"))).toBe(true);
    expect(build.scoreSummary).toBe("visual 84");
  });

  it("a first-pass QA failure (pre-repair) is surfaced the same way", async () => {
    const build = await seedBuildWithEvents([
      {
        fromState: "QA_EVIDENCE",
        toState: "QA",
        stage: "simple_qa",
        detail:
          "SIMPLE QA found: visual fidelity 85 < 90; 3 P1 finding(s); hard composition gate(s) failed: MOBILE_PRESERVES_VISUAL_IDENTITY",
      },
    ]);
    expect(build.qaOutcome!.status).toBe("failed");
    expect(build.qaOutcome!.visualScore).toBe(85);
    expect(build.qaOutcome!.reasons[0]).toBe("visual fidelity 85 < 90");
  });

  it("a passing QA exposes status passed with no reasons", async () => {
    const build = await seedBuildWithEvents([
      {
        fromState: "CONFIRMATION",
        toState: "RELEASE_READY",
        stage: "simple_final_qa",
        detail: "Final QA passed after the ONE repair (visual 91)",
      },
    ]);
    expect(build.qaOutcome!.status).toBe("passed");
    expect(build.qaOutcome!.reasons).toEqual([]);
    expect(build.qaOutcome!.visualScore).toBe(91);
  });

  it("builds with no QA events report a null outcome, not a silent pass", async () => {
    const build = await seedBuildWithEvents([]);
    expect(build.qaOutcome).toBeNull();
  });

  it("the review page HTML renders the QA FAILED box for a failed human-review build", async () => {
    const { registerAdminPageRoutes } = await import("../src/routes/admin-pages");
    const { createAccessHarness } = await import("./helpers/access-test");
    const access = await createAccessHarness("admin-review-qa");
    access.stubFetch();
    const { Hono } = await import("hono");
    const app = new Hono<{ Bindings: Env }>();
    registerAdminPageRoutes(app);

    const started = await startSiteGeneration(env, { payload: originalPayload() });
    const initial = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    await appendBuildWorkflowEvent(env, {
      buildId: initial.buildId,
      buildVersionId: initial.buildVersionId,
      fromState: "CONFIRMATION",
      toState: "HUMAN_REVIEW_REQUIRED",
      stage: "simple_final_qa",
      detail:
        "Final QA still failing after the ONE repair: visual fidelity 84 < 90; 3 P1 finding(s); hard composition gate(s) failed: FIRST_VIEWPORT_MATERIALLY_CORRECT",
    });

    const response = await app.request(
      `https://admin-test.example.com/sites/${started.siteId}`,
      { method: "GET", headers: await access.validHeaders() },
      { ...(env as unknown as Env), ...access.envVars } as unknown as Env
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("QA FAILED");
    expect(html).toContain("automation could not reach release quality");
    expect(html).toContain("visual fidelity 84 &lt; 90");
    expect(html).toContain("HUMAN_REVIEW_REQUIRED (QA FAILED)");
  });
});
