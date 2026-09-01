import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  runFixCoordinatorStage,
  applyRepairBatch,
  runConfirmationQa,
  runReleaseBlockerFixStage,
  resolveAfterConfirmation,
  classifyTerminalOutcome,
  assertRepairPlanWithinBounds,
  parseFixPlan,
  AutomatedRepairError,
  type FixPlan,
} from "../src/domain/automated-repair";
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport, type QaFinding } from "../src/domain/qa-stages";
import { getReleaseRecord } from "../src/domain/release";
import { generateId } from "../src/lib/crypto";
import type { RawAiGenerate } from "../src/domain/ai-boundary";

// Primary-seam tests for the bounded Automated Repair lifecycle (issue #14).

const env = providedEnv as unknown as Env;

function qaA(overrides: Partial<QaAReport> = {}): QaAReport {
  return {
    version: "1",
    visualScore: 88,
    contentScore: 92,
    fabrication: false,
    hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
    findings: [
      { severity: "P1", domain: "visual", description: "hero collapses to centered stack on mobile", evidenceRef: "qa/home-390.png" },
    ],
    ...overrides,
  };
}

function qaB(overrides: Partial<QaBReport> = {}): QaBReport {
  return {
    version: "1",
    technicalScore: 93,
    gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
    findings: [],
    ...overrides,
  };
}

function fixPlan(overrides: Partial<FixPlan> = {}): FixPlan {
  return {
    version: "1",
    rootCauses: [
      { findingRef: "qa/home-390.png", domain: "visual", rootCause: "hero grid lacks its mobile stacking rule" },
    ],
    repairs: [
      {
        target: "implementation",
        strategy: "css_geometry_crop",
        description: "restore the Blueprint asymmetric split by adding the mobile stacking media query",
      },
    ],
    blueprintReviewRequired: false,
    ...overrides,
  };
}

async function newBuildContext(): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" },
      reference: { screenshotR2Key: `references/uploads/ar-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

function generateFor(plans: { main?: FixPlan; blockerFix?: FixPlan; confirmA: QaAReport; confirmB: QaBReport }): RawAiGenerate {
  return async (_system, user) => {
    if (user.includes("Plan ONE coordinated main Automated Repair batch")) {
      return { content: JSON.stringify(plans.main ?? fixPlan()), provider: "test", model: "test-model-f" };
    }
    if (user.includes("ONE narrow final Automated Repair batch")) {
      return { content: JSON.stringify(plans.blockerFix ?? fixPlan()), provider: "test", model: "test-model-f" };
    }
    if (user.includes("QA-A Confirmation")) {
      return { content: JSON.stringify(plans.confirmA), provider: "test", model: "test-model-f" };
    }
    return { content: JSON.stringify(plans.confirmB), provider: "test", model: "test-model-f" };
  };
}

const PASS_A: QaAReport = {
  version: "1",
  visualScore: 94,
  contentScore: 93,
  fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};
const PASS_B: QaBReport = {
  version: "1",
  technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};

describe("Automated Repair boundaries", () => {
  it("cannot change Business Facts, Reference, Build Mode or the Visual Blueprint", () => {
    // A repair target outside realization fails the versioned schema.
    expect(parseFixPlan({ ...fixPlan(), repairs: [{ target: "blueprint", strategy: "html_structure", description: "x" }] })).toBeNull();
    expect(parseFixPlan({ ...fixPlan(), repairs: [{ target: "business_fact", strategy: "content_remap", description: "x" }] })).toBeNull();

    // Schema-valid plans still cannot smuggle design-origin mutations.
    for (const description of [
      "update the business facts to add a new phone number",
      "replace the reference screenshot with a better one",
      "switch build mode to ORIGINAL_DESIGN",
      "rewrite the visual blueprint color roles",
    ]) {
      expect(() => assertRepairPlanWithinBounds(fixPlan({ repairs: [{ target: "implementation", strategy: "html_structure", description }] }))).toThrow(
        AutomatedRepairError
      );
    }
    expect(() => assertRepairPlanWithinBounds(fixPlan())).not.toThrow();
  });

  it("rejects blueprint-review plans without a reason", () => {
    expect(() => assertRepairPlanWithinBounds(fixPlan({ blueprintReviewRequired: true }))).toThrow(
      /plans must carry a reason/
    );
    expect(() => assertRepairPlanWithinBounds(fixPlan({ blueprintReviewRequired: true, blueprintReviewReason: "contradictory first viewport" }))).not.toThrow();
  });
});

describe("bounded repair lifecycle", () => {
  it("applies one material repair as a NEW immutable Build Version and enforces the ceiling", async () => {
    const context = await newBuildContext();

    const coordinator = await runFixCoordinatorStage(env, {
      ...context,
      buildVersionNumber: 1,
      qaA: qaA(),
      qaB: qaB(),
      generate: generateFor({ confirmA: PASS_A, confirmB: PASS_B }),
    });
    const applied = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: coordinator.plan,
    });

    expect(applied.status).toBe("REPAIR_APPLIED");
    if (applied.status !== "REPAIR_APPLIED") return;
    expect(applied.newBuildVersionNumber).toBe(2);
    expect(applied.newBuildVersionId).not.toBe(context.buildVersionId);

    // The prior version is untouched; the new one is a fresh candidate.
    const versions = await env.DB.prepare("SELECT version_number FROM build_versions WHERE build_id = ? ORDER BY version_number")
      .bind(context.buildId)
      .all<{ version_number: number }>();
    expect((versions.results ?? []).map((row) => row.version_number)).toEqual([1, 2]);
    await expect(
      env.DB.prepare("UPDATE build_versions SET version_number = 99 WHERE id = ?").bind(context.buildVersionId).run()
    ).rejects.toThrow("BUILD_VERSION_IMMUTABLE");

    // Retry ceiling: no second Fix Coordinator batch for this Build.
    await expect(
      applyRepairBatch(env, {
        ...context,
        sourceBuildVersionId: applied.newBuildVersionId,
        kind: "fix_coordinator",
        plan: fixPlan(),
      })
    ).rejects.toMatchObject({ code: "REPAIR_BUDGET_EXHAUSTED" });

    // Storage-level ceiling too.
    await expect(
      env.DB.prepare(
        `INSERT INTO repair_batches (id, build_id, source_build_version_id, kind, plan_json, created_build_version_id, created_at)
         VALUES (?, ?, ?, 'fix_coordinator', '{}', ?, '2026-09-01T00:00:00Z')`
      )
        .bind(generateId(), context.buildId, context.buildVersionId, applied.newBuildVersionId)
        .run()
    ).rejects.toThrow("UNIQUE constraint failed");

    await expect(
      env.DB.prepare("UPDATE repair_batches SET plan_json = '[]' WHERE id = ?").bind(applied.batchId).run()
    ).rejects.toThrow("REPAIR_BATCH_IMMUTABLE");
  });

  it("confirmation evaluates the repaired Build Version and can reach Release Ready for exactly it", async () => {
    const context = await newBuildContext();
    const applied = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan(),
    });
    if (applied.status !== "REPAIR_APPLIED") throw new Error("expected repair applied");

    const confirmation = await runConfirmationQa(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: applied.newBuildVersionId,
      buildVersionNumber: applied.newBuildVersionNumber,
      previousBlockers: qaA().findings,
      generate: generateFor({ confirmA: PASS_A, confirmB: PASS_B }),
    });

    // Confirmation ran against the NEW version id — never the old one.
    const runs = await env.DB.prepare(
      "SELECT DISTINCT stage, build_version_id FROM ai_stage_runs WHERE stage IN ('qa-a-confirmation','qa-b-confirmation')"
    )
      .all<{ stage: string; build_version_id: string }>();
    for (const row of runs.results ?? []) {
      expect(row.build_version_id).toBe(applied.newBuildVersionId);
      expect(row.build_version_id).not.toBe(context.buildVersionId);
    }
    expect(runs.results?.length).toBe(2);

    const resolution = await resolveAfterConfirmation(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: applied.newBuildVersionId,
      confirmation,
    });
    expect(resolution.status).toBe("RELEASE_READY");
    expect(await getReleaseRecord(env, applied.newBuildVersionId)).not.toBeNull();
    expect(await getReleaseRecord(env, context.buildVersionId)).toBeNull();
  });

  it("runs at most one Release Blocker Fix, then escalates to HUMAN_REVIEW_REQUIRED and stops", async () => {
    const context = await newBuildContext();
    const main = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan(),
    });
    if (main.status !== "REPAIR_APPLIED") throw new Error("expected repair applied");

    const stillBlocked = await runConfirmationQa(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      buildVersionNumber: main.newBuildVersionNumber,
      previousBlockers: qaA().findings,
      generate: generateFor({ confirmA: qaA(), confirmB: PASS_B }),
    });

    const afterConfirmation = await resolveAfterConfirmation(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      confirmation: stillBlocked,
    });
    expect(afterConfirmation.status).toBe("RELEASE_BLOCKER_FIX_ALLOWED");
    expect(afterConfirmation.blockers).toHaveLength(1);

    // The single narrow Release Blocker Fix creates version 3.
    const blockerPlan = await runReleaseBlockerFixStage(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      buildVersionNumber: main.newBuildVersionNumber,
      qaA: stillBlocked.qaA,
      qaB: stillBlocked.qaB,
      remainingBlockers: afterConfirmation.blockers,
      generate: generateFor({ confirmA: qaA(), confirmB: PASS_B }),
    });
    const blockerFix = await applyRepairBatch(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      sourceBuildVersionId: main.newBuildVersionId,
      kind: "release_blocker_fix",
      plan: blockerPlan.plan,
    });
    expect(blockerFix.status).toBe("REPAIR_APPLIED");
    if (blockerFix.status !== "REPAIR_APPLIED") return;
    expect(blockerFix.newBuildVersionNumber).toBe(3);

    // Second Release Blocker Fix is forbidden.
    await expect(
      applyRepairBatch(env, {
        siteGenerationId: context.siteGenerationId,
        buildId: context.buildId,
        sourceBuildVersionId: blockerFix.newBuildVersionId,
        kind: "release_blocker_fix",
        plan: fixPlan(),
      })
    ).rejects.toMatchObject({ code: "REPAIR_BUDGET_EXHAUSTED" });

    // Final confirmation still blocked -> terminal HUMAN_REVIEW_REQUIRED.
    const finalConfirmation = await runConfirmationQa(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: blockerFix.newBuildVersionId,
      buildVersionNumber: blockerFix.newBuildVersionNumber,
      previousBlockers: afterConfirmation.blockers,
      generate: generateFor({ confirmA: qaA(), confirmB: PASS_B }),
    });
    const terminal = await resolveAfterConfirmation(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: blockerFix.newBuildVersionId,
      confirmation: finalConfirmation,
    });
    expect(terminal.status).toBe("HUMAN_REVIEW_REQUIRED");
    expect(await getReleaseRecord(env, blockerFix.newBuildVersionId)).toBeNull();

    const events = await env.DB.prepare(
      "SELECT to_state, detail FROM build_workflow_events WHERE build_id = ? AND to_state = 'HUMAN_REVIEW_REQUIRED'"
    )
      .bind(context.buildId)
      .all<{ detail: string }>();
    expect((events.results ?? [])[0]?.detail).toContain("HUMAN_REVIEW_REQUIRED");
  });

  it("Blueprint root defects emit BLUEPRINT_REVIEW_REQUIRED without any repair", async () => {
    const context = await newBuildContext();
    const versionsBefore = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();

    const outcome = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan({
        blueprintReviewRequired: true,
        blueprintReviewReason: "Blueprint first viewport contradicts the frozen Reference Screenshot composition",
      }),
    });

    expect(outcome.status).toBe("BLUEPRINT_REVIEW_REQUIRED");
    const versionsAfter = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_versions WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(versionsAfter!.n).toBe(versionsBefore!.n);

    const batches = await env.DB.prepare("SELECT COUNT(*) AS n FROM repair_batches WHERE build_id = ?")
      .bind(context.buildId)
      .first<{ n: number }>();
    expect(batches!.n).toBe(0);

    const event = await env.DB.prepare(
      "SELECT detail FROM build_workflow_events WHERE build_id = ? AND stage = 'blueprint_review'"
    )
      .bind(context.buildId)
      .first<{ detail: string }>();
    expect(event!.detail).toContain("BLUEPRINT_REVIEW_REQUIRED");
    expect(event!.detail).toContain("contradicts the frozen Reference Screenshot");
  });

  it("distinguishes Degraded from Failed terminal outcomes by useful-partial-result presence", async () => {
    const degraded = await newBuildContext();
    await env.DB.prepare(
      `INSERT INTO build_deployments (id, build_id, build_version_id, role, worker_name, preview_url, artifact_manifest_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, 'preview', 'w', 'https://w.example/', 'hash', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`
    )
      .bind(generateId(), degraded.buildId, degraded.buildVersionId)
      .run();
    const degradedOutcome = await classifyTerminalOutcome(env, degraded);
    expect(degradedOutcome.outcome).toBe("DEGRADED");
    expect(degradedOutcome.rationale).toContain("genuinely useful Preview");

    const failed = await newBuildContext();
    const failedOutcome = await classifyTerminalOutcome(env, failed);
    expect(failedOutcome.outcome).toBe("FAILED");
    expect(failedOutcome.rationale).toContain("No usable candidate");

    for (const context of [degraded, failed]) {
      const state = await env.DB.prepare("SELECT state FROM builds WHERE id = ?")
        .bind(context.buildId)
        .first<{ state: string }>();
      expect(["DEGRADED", "FAILED"]).toContain(state!.state);
    }
  });

  it("carries confirmation blockers forward as the Release Blocker Fix scope", async () => {
    const blockers: QaFinding[] = [
      { severity: "P1", domain: "form", description: "contact form posts cross-origin", evidenceRef: "qa/contact-390.png" },
      { severity: "P0", domain: "visual", description: "mobile identity lost", evidenceRef: "qa/home-390.png" },
    ];
    let seenPrompt = "";
    const context = await newBuildContext();
    await runReleaseBlockerFixStage(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: context.buildVersionId,
      buildVersionNumber: 1,
      qaA: qaA(),
      qaB: qaB(),
      remainingBlockers: blockers,
      generate: async (_system, user) => {
        seenPrompt = user;
        return { content: JSON.stringify(fixPlan()), provider: "test", model: "test-model-f" };
      },
    });
    expect(seenPrompt).toContain("contact form posts cross-origin");
    expect(seenPrompt).toContain("mobile identity lost");
  });
});
