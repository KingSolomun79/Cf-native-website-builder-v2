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
import { QA_A_HARD_GATE_IDS, QA_B_MANDATORY_GATE_IDS, type QaAReport, type QaBReport, type QaFinding, type QaAConfirmationReport, type QaBConfirmationReport } from "../src/domain/qa-stages";
import { getReleaseRecord } from "../src/domain/release";
import { generateId } from "../src/lib/crypto";
import { AiStageSchemaInvalidError, type RawAiGenerate } from "../src/domain/ai-boundary";

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

function generateFor(plans: { main?: FixPlan; blockerFix?: FixPlan; confirmA: QaAConfirmationReport; confirmB: QaBConfirmationReport }): RawAiGenerate {
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

const PASS_CONFIRM_A: QaAConfirmationReport = {
  version: "1",
  visualScore: 94,
  contentScore: 93,
  fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};
const PASS_CONFIRM_B: QaBConfirmationReport = {
  version: "1",
  technicalScore: 95,
  gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [],
};

// A prior blocker the confirmation still finds present (status ACTIVE).
const STILL_ACTIVE_A: QaAConfirmationReport = {
  version: "1",
  visualScore: 88,
  contentScore: 92,
  fabrication: false,
  hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
  findings: [
    { severity: "P1", domain: "visual", description: "hero collapses to centered stack on mobile", evidenceRef: "qa/home-390.png", status: "ACTIVE" },
  ],
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
      generate: generateFor({ confirmA: PASS_CONFIRM_A, confirmB: PASS_CONFIRM_B }),
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
      generate: generateFor({ confirmA: PASS_CONFIRM_A, confirmB: PASS_CONFIRM_B }),
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
      generate: generateFor({ confirmA: STILL_ACTIVE_A, confirmB: PASS_CONFIRM_B }),
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
      generate: generateFor({ confirmA: STILL_ACTIVE_A, confirmB: PASS_CONFIRM_B }),
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
      generate: generateFor({ confirmA: STILL_ACTIVE_A, confirmB: PASS_CONFIRM_B }),
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

// Issue #38: confirmation resolution semantics. Confirmation QA is evaluating
// whether the PREVIOUS blockers remain active after repair — a finding that
// verifiably re-reports a fixed prior defect (original severity retained,
// status RESOLVED) is a resolution record, not an active Release Blocker.
describe("confirmation resolution semantics (issue #38)", () => {
  function resolvedPriorP1A(): QaAConfirmationReport {
    return {
      version: "1",
      visualScore: 93,
      contentScore: 92,
      fabrication: false,
      hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
      findings: [
        {
          severity: "P1",
          domain: "FIRST_VIEWPORT",
          description:
            "Previously identified first-viewport height ratio defect is resolved on the new Build Version. Hero region now completes within one viewport at ratio ~0.93 (reference 0.9, tolerance 0.15).",
          evidenceRef: "qa/home-1440-first.png",
          status: "RESOLVED",
        },
      ],
    };
  }

  function resolvedPriorP0B(): QaBConfirmationReport {
    return {
      version: "1",
      technicalScore: 93,
      gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
      findings: [
        {
          severity: "P0",
          domain: "form",
          description: "Previously identified form contract defect is fixed: the contact form now posts to the central Form Service endpoint.",
          evidenceRef: "qa/contact-390.png",
          status: "RESOLVED",
        },
      ],
    };
  }

  // Consumes BOTH repair batches (the production terminal state of the #30
  // revision) so the final confirmation is the last automation step.
  async function consumeFullRepairBudget(context: { siteGenerationId: string; buildId: string; buildVersionId: string }) {
    const main = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan(),
    });
    if (main.status !== "REPAIR_APPLIED") throw new Error("expected main repair applied");
    const blockerPlan = await runReleaseBlockerFixStage(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      buildVersionNumber: main.newBuildVersionNumber,
      qaA: qaA(),
      qaB: qaB(),
      remainingBlockers: qaA().findings,
      generate: async () => ({ content: JSON.stringify(fixPlan()), provider: "test", model: "test-model-f" }),
    });
    const blockerFix = await applyRepairBatch(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      sourceBuildVersionId: main.newBuildVersionId,
      kind: "release_blocker_fix",
      plan: blockerPlan.plan,
    });
    if (blockerFix.status !== "REPAIR_APPLIED") throw new Error("expected blocker fix applied");
    return blockerFix;
  }

  it("resolved prior P0/P1 notes with original severity reach Release Ready (production regression)", async () => {
    const context = await newBuildContext();
    const blockerFix = await consumeFullRepairBudget(context);

    const confirmation = await runConfirmationQa(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: blockerFix.newBuildVersionId,
      buildVersionNumber: blockerFix.newBuildVersionNumber,
      previousBlockers: qaA().findings,
      generate: generateFor({ confirmA: resolvedPriorP1A(), confirmB: resolvedPriorP0B() }),
    });
    const resolution = await resolveAfterConfirmation(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: blockerFix.newBuildVersionId,
      confirmation,
    });

    expect(resolution.status).toBe("RELEASE_READY");
    expect(resolution.reasons).toEqual([]);
    expect(resolution.blockers).toHaveLength(0);
    expect(resolution.resolved).toHaveLength(2);
    expect(await getReleaseRecord(env, blockerFix.newBuildVersionId)).not.toBeNull();
    expect(await getReleaseRecord(env, context.buildVersionId)).toBeNull();
  });

  it("still-active prior blockers and new P0/P1 findings remain blockers", async () => {
    const context = await newBuildContext();
    const main = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan(),
    });
    if (main.status !== "REPAIR_APPLIED") throw new Error("expected repair applied");

    // QA-A: the prior P1 is still present; QA-B: a NEW P0 discovered during
    // confirmation — both ACTIVE, both must block.
    const confirmation = await runConfirmationQa(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      buildVersionNumber: main.newBuildVersionNumber,
      previousBlockers: qaA().findings,
      generate: generateFor({
        confirmA: STILL_ACTIVE_A,
        confirmB: {
          version: "1",
          technicalScore: 91,
          gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
          findings: [
            { severity: "P0", domain: "form", description: "new cross-origin form post introduced by the repair", evidenceRef: "qa/contact-390.png", status: "ACTIVE" },
          ],
        },
      }),
    });
    const resolution = await resolveAfterConfirmation(env, {
      siteGenerationId: context.siteGenerationId,
      buildId: context.buildId,
      buildVersionId: main.newBuildVersionId,
      confirmation,
    });

    expect(resolution.status).toBe("RELEASE_BLOCKER_FIX_ALLOWED");
    expect(resolution.blockers).toHaveLength(2);
    expect(resolution.resolved).toHaveLength(0);
    expect(resolution.reasons).toContain("1 P0 finding(s)");
    expect(resolution.reasons).toContain("1 P1 finding(s)");
    expect(await getReleaseRecord(env, main.newBuildVersionId)).toBeNull();
  });

  it("ambiguous confirmation output without resolution status fails closed", async () => {
    const context = await newBuildContext();
    const main = await applyRepairBatch(env, {
      ...context,
      sourceBuildVersionId: context.buildVersionId,
      kind: "fix_coordinator",
      plan: fixPlan(),
    });
    if (main.status !== "REPAIR_APPLIED") throw new Error("expected repair applied");

    // Legacy production shape: a P1 resolution note with NO structured
    // status. This is schema-invalid for confirmation reports; after the one
    // structural repair attempt it must fail the stage — never silently
    // become a Release Ready.
    const legacyShape = {
      version: "1",
      visualScore: 94,
      contentScore: 93,
      fabrication: false,
      hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
      findings: [
        { severity: "P1", domain: "FIRST_VIEWPORT", description: "Previously identified defect is resolved", evidenceRef: "qa/home-1440-first.png" },
      ],
    };
    let confirmationCalls = 0;
    await expect(
      runConfirmationQa(env, {
        siteGenerationId: context.siteGenerationId,
        buildId: context.buildId,
        buildVersionId: main.newBuildVersionId,
        buildVersionNumber: main.newBuildVersionNumber,
        previousBlockers: qaA().findings,
        generate: async (_system, user) => {
          if (user.includes("QA-A Confirmation")) {
            confirmationCalls += 1;
            return { content: JSON.stringify(legacyShape), provider: "test", model: "test-model-f" };
          }
          return { content: JSON.stringify(PASS_CONFIRM_B), provider: "test", model: "test-model-f" };
        },
      })
    ).rejects.toBeInstanceOf(AiStageSchemaInvalidError);
    expect(confirmationCalls).toBe(2);
    expect(await getReleaseRecord(env, main.newBuildVersionId)).toBeNull();
  });
});
