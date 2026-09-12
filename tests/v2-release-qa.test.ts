import { canonicalStructuredFacts } from "./helpers/canonical-facts";
import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  buildStandardEvidenceBundle,
  standardCaptureSpec,
  type GeometryProfile,
  type PageCapture,
  type QaCaptureFn,
} from "../src/domain/qa-evidence";
import {
  evaluateQaARelease,
  evaluateQaBRelease,
  QA_A_HARD_GATE_IDS,
  QA_B_MANDATORY_GATE_IDS,
  QaAConfirmationReportSchema,
  QaBConfirmationReportSchema,
  QaAReportSchema,
  type QaAReport,
  type QaBReport,
  type QaAConfirmationReport,
  type QaBConfirmationReport,
} from "../src/domain/qa-stages";
import { Value } from "@sinclair/typebox/value";
import { assignReleaseReady, getReleaseRecord, ReleaseGateError } from "../src/domain/release";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { PageId } from "../src/domain/site-contracts";

// Primary-seam tests for standardized evidence, release-gate evaluation and
// Release Ready (issue #13); the legacy QA-A/QA-B LLM stages were removed with
// the legacy pipeline (the SIMPLE pipeline owns visual/truth/technical QA).

const env = providedEnv as unknown as Env;

function geometry(overrides: Partial<GeometryProfile> = {}): GeometryProfile {
  return {
    regionOrder: ["hero", "intro", "services", "cta"],
    firstViewportHeightRatio: 0.92,
    sectionHeightRatios: [0.92, 0.6, 0.8, 0.3],
    imageMassRatio: 0.38,
    containerWidthRatio: 0.83,
    columnRatios: [5 / 7],
    dominantAlignment: "asymmetric",
    surfaceSequence: ["paper", "paper", "ink", "paper"],
    whitespaceRatio: 0.22,
    ...overrides,
  };
}

function qaAReport(overrides: Partial<QaAReport> = {}): QaAReport {
  return {
    version: "1",
    visualScore: 93,
    contentScore: 92,
    fabrication: false,
    hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
    findings: [
      { severity: "P3", domain: "polish", description: "tracking letter-spacing could be tighter", evidenceRef: "qa/home-1440-first.png" },
    ],
    ...overrides,
  };
}

function qaBReport(overrides: Partial<QaBReport> = {}): QaBReport {
  return {
    version: "1",
    technicalScore: 94,
    gates: QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true })),
    findings: [],
    ...overrides,
  };
}

async function newBuildContext(): Promise<{ siteGenerationId: string; buildId: string; buildVersionId: string }> {
  const started = await startSiteGeneration(env, {
    payload: {
      buildMode: "REFERENCE_BOUND",
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" , ...(canonicalStructuredFacts()) },
      reference: { screenshotR2Key: `references/uploads/qa-${Math.random().toString(36).slice(2)}.png` },
    },
  });
  const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
  return { siteGenerationId: started.siteGenerationId, buildId: created.buildId, buildVersionId: created.buildVersionId };
}

function captureFn(profile: (page: PageId, width: number) => GeometryProfile): QaCaptureFn {
  return async (spec) =>
    spec.map((entry) => ({
      page: entry.page,
      viewportWidth: entry.viewportWidth,
      fullPageScreenshot: new TextEncoder().encode(`PNG-${entry.page}-${entry.viewportWidth}-${Math.random()}`),
      ...(entry.firstViewport ? { firstViewportScreenshot: new TextEncoder().encode(`PNG-${entry.page}-${entry.viewportWidth}-first`) } : {}),
      geometry: profile(entry.page, entry.viewportWidth),
      runtime: { consoleErrors: [], failedRequests: [] },
    })) as PageCapture[];
}

describe("standardized QA evidence", () => {
  it("captures the standard matrix: home at 1440/768/390 with first viewports, inner pages at 1440/390", async () => {
    const spec = standardCaptureSpec();
    expect(spec.filter((entry) => entry.page === "home").map((entry) => entry.viewportWidth)).toEqual([1440, 768, 390]);
    expect(spec.filter((entry) => entry.page === "home").every((entry) => entry.firstViewport)).toBe(true);
    for (const page of ["about", "services", "contact"] as PageId[]) {
      expect(spec.filter((entry) => entry.page === page).map((entry) => entry.viewportWidth)).toEqual([1440, 390]);
    }
    expect(spec.length).toBe(9);

    const context = await newBuildContext();
    const bundle = await buildStandardEvidenceBundle(env, {
      ...context,
      buildVersionNumber: 1,
      capture: captureFn(() => geometry()),
    });
    expect(bundle.bundle.captures).toHaveLength(9);
    const homeCaptures = bundle.bundle.captures.filter((capture) => capture.page === "home");
    expect(homeCaptures.every((capture) => capture.hasFirstViewport)).toBe(true);

    const stored = await getBuildStageArtifact(env, context.buildVersionId, "qa_evidence_bundle");
    expect(stored).not.toBeNull();
  });
});

describe("QA-A / QA-B release evaluation", () => {
  it("hard composition-gate failure cannot be averaged away by high scores", () => {
    const verdict = evaluateQaARelease(
      qaAReport({
        visualScore: 97,
        contentScore: 96,
        hardGates: QA_A_HARD_GATE_IDS.map((id, index) => ({ id, passed: index !== 0 })),
      })
    );
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("FIRST_VIEWPORT_MATERIALLY_CORRECT");

    const scoreFailure = evaluateQaARelease(qaAReport({ visualScore: 85 }));
    expect(scoreFailure.releaseReady).toBe(false);
    expect(scoreFailure.reasons[0]).toContain("visual fidelity 85");

    const p1Failure = evaluateQaAReportWithP1();
    expect(p1Failure.releaseReady).toBe(false);
    expect(p1Failure.blockers).toHaveLength(1);
    expect(p1Failure.polish).toHaveLength(1);

    const fabrication = evaluateQaARelease(qaAReport({ fabrication: true }));
    expect(fabrication.releaseReady).toBe(false);
    expect(fabrication.reasons.join(" ")).toContain("fabricated");
  });

  function evaluateQaAReportWithP1() {
    return evaluateQaARelease(
      qaAReport({
        findings: [
          { severity: "P1", domain: "visual", description: "mobile hero collapses to centered stack", evidenceRef: "qa/home-390.png" },
          { severity: "P2", domain: "polish", description: "letter-spacing", evidenceRef: "qa/home-1440.png" },
        ],
      })
    );
  }

  it("QA-B fails on technical score, P1 findings and mandatory gates", () => {
    expect(evaluateQaBRelease(qaBReport({ technicalScore: 80 })).releaseReady).toBe(false);
    expect(
      evaluateQaBRelease(
        qaBReport({
          findings: [{ severity: "P1", domain: "form", description: "form posts cross-origin", evidenceRef: "qa/contact-390.png" }],
        })
      ).releaseReady
    ).toBe(false);
    const gateFailure = evaluateQaBRelease(
      qaBReport({ gates: QA_B_MANDATORY_GATE_IDS.map((id, index) => ({ id, passed: index !== 3 })) })
    );
    expect(gateFailure.releaseReady).toBe(false);
    expect(gateFailure.reasons.join(" ")).toContain("RESPONSIVE_MECHANICS");
    expect(evaluateQaBRelease(qaBReport()).releaseReady).toBe(true);
  });
});

describe("confirmation resolution status semantics (issue #38)", () => {
  const passingGatesA = QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true }));
  const passingGatesB = QA_B_MANDATORY_GATE_IDS.map((id) => ({ id, passed: true }));

  function confirmA(overrides: Partial<QaAConfirmationReport> = {}): QaAConfirmationReport {
    return {
      version: "1", visualScore: 93, contentScore: 92, fabrication: false,
      hardGates: passingGatesA, findings: [], ...overrides,
    };
  }
  function confirmB(overrides: Partial<QaBConfirmationReport> = {}): QaBConfirmationReport {
    return { version: "1", technicalScore: 93, gates: passingGatesB, findings: [], ...overrides };
  }
  function finding(severity: "P0" | "P1", status: "ACTIVE" | "RESOLVED", description: string) {
    return { severity, domain: "FIRST_VIEWPORT", description, evidenceRef: "qa/home-1440-first.png", status };
  }

  it("A+B: resolved historical P0/P1 notes with original severity are not blockers", () => {
    const verdictA = evaluateQaARelease(
      confirmA({ findings: [finding("P1", "RESOLVED", "prior first-viewport defect")] })
    );
    expect(verdictA.releaseReady).toBe(true);
    expect(verdictA.blockers).toHaveLength(0);
    expect(verdictA.resolved).toHaveLength(1);
    expect(verdictA.polish).toHaveLength(0);

    const verdictB = evaluateQaBRelease(
      confirmB({ findings: [finding("P0", "RESOLVED", "prior form contract defect")] })
    );
    expect(verdictB.releaseReady).toBe(true);
    expect(verdictB.blockers).toHaveLength(0);
    expect(verdictB.resolved).toHaveLength(1);
  });

  it("C+D: still-active P0/P1 remain blockers", () => {
    const verdictA = evaluateQaARelease(
      confirmA({ findings: [finding("P1", "ACTIVE", "prior first-viewport defect still present")] })
    );
    expect(verdictA.releaseReady).toBe(false);
    expect(verdictA.blockers).toHaveLength(1);
    expect(verdictA.reasons).toContain("1 P1 finding(s)");

    const verdictB = evaluateQaBRelease(
      confirmB({ findings: [finding("P0", "ACTIVE", "prior form contract defect still present")] })
    );
    expect(verdictB.releaseReady).toBe(false);
    expect(verdictB.blockers).toHaveLength(1);
    expect(verdictB.reasons).toContain("1 P0 finding(s)");
  });

  it("E+F: new P0/P1 defects discovered during confirmation are active blockers", () => {
    const verdictA = evaluateQaARelease(
      confirmA({ findings: [finding("P1", "ACTIVE", "new defect discovered during confirmation")] })
    );
    expect(verdictA.releaseReady).toBe(false);
    expect(verdictA.blockers).toHaveLength(1);

    const verdictB = evaluateQaBRelease(
      confirmB({ findings: [finding("P0", "ACTIVE", "new defect discovered during confirmation")] })
    );
    expect(verdictB.releaseReady).toBe(false);
    expect(verdictB.blockers).toHaveLength(1);
  });

  it("G: the exact production resolution note (original P1 severity retained) is not counted", () => {
    const verdict = evaluateQaARelease(
      confirmA({
        findings: [
          finding(
            "P1",
            "RESOLVED",
            "Previously identified first-viewport height ratio defect is resolved on the new Build Version. Hero region now completes within one viewport at ratio ~0.93 (reference 0.9, tolerance 0.15)."
          ),
        ],
      })
    );
    expect(verdict.releaseReady).toBe(true);
    expect(verdict.blockers).toHaveLength(0);
    expect(verdict.resolved).toHaveLength(1);
  });

  it("fresh QA semantics are unchanged: findings without status still block as before", () => {
    const freshP1: QaAReport = {
      version: "1", visualScore: 93, contentScore: 92, fabrication: false,
      hardGates: passingGatesA,
      findings: [{ severity: "P1", domain: "visual", description: "active defect", evidenceRef: "qa/home-390.png" }],
    };
    const verdict = evaluateQaARelease(freshP1);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.blockers).toHaveLength(1);
    expect(verdict.resolved).toHaveLength(0);
    expect(verdict.polish).toHaveLength(0);
  });

  it("ambiguous or missing resolution state fails closed at the schema boundary", () => {
    const legacyNote = {
      severity: "P1" as const, domain: "FIRST_VIEWPORT",
      description: "Previously identified defect is resolved", evidenceRef: "qa/home-1440-first.png",
    };
    // Confirmation findings REQUIRE the structured status: a legacy-shape
    // note without status (exactly what production emitted) is schema-invalid
    // and takes the repair/fail path — never silently treated as resolved.
    expect(
      Value.Check(QaAConfirmationReportSchema, {
        version: "1", visualScore: 93, contentScore: 92, fabrication: false,
        hardGates: passingGatesA, findings: [legacyNote],
      })
    ).toBe(false);
    // An unknown status value is equally invalid (no natural-language parsing).
    expect(
      Value.Check(QaBConfirmationReportSchema, {
        version: "1", technicalScore: 93, gates: passingGatesB,
        findings: [{ ...legacyNote, status: "resolved" }],
      })
    ).toBe(false);
    // The fresh QA-A schema still forbids the status field entirely.
    expect(
      Value.Check(QaAReportSchema, {
        version: "1", visualScore: 93, contentScore: 92, fabrication: false,
        hardGates: passingGatesA,
        findings: [{ ...legacyNote, status: "RESOLVED" }],
      })
    ).toBe(false);
  });
});

describe("Release Ready assignment", () => {
  it("assigns Release Ready only to the exact Build Version that passed every gate", async () => {
    const context = await newBuildContext();
    const result = await assignReleaseReady(env, {
      ...context,
      qaA: qaAReport(),
      qaB: qaBReport(),
      qaBuildVersionId: context.buildVersionId,
      geometryComparison: {
        status: "MEASURED",
        metrics: [],
        similarityScore: 0.93,
        measuredCoverage: 1,
        materialDeviations: [],
      },
      evidenceR2Keys: ["evidence/qa-bundle.json"],
    });
    expect(result.releaseReady).toBe(true);

    const record = await getReleaseRecord(env, context.buildVersionId);
    expect(record!.buildVersionId).toBe(context.buildVersionId);
    expect(record!.qaAVisualScore).toBe(93);
    expect(record!.qaBTechnicalScore).toBe(94);

    // Exact findings stored with categorization.
    const report = await getBuildStageArtifact<{ releaseBlockers: unknown[]; nonBlockingPolish: unknown[] }>(
      env, context.buildVersionId, "qa_report"
    );
    expect(report!.value.releaseBlockers).toEqual([]);
    expect(report!.value.nonBlockingPolish).toHaveLength(1);

    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ? ORDER BY created_at")
      .bind(context.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).toContain("RELEASE_READY");

    // Idempotence: the exact version cannot be re-assigned.
    await expect(
      assignReleaseReady(env, { ...context, qaA: qaAReport(), qaB: qaBReport(), qaBuildVersionId: context.buildVersionId })
    ).rejects.toMatchObject({ code: "RELEASE_ALREADY_ASSIGNED" });
  });

  it("rejects Release Ready when any gate fails and stores the categorized findings", async () => {
    const hardGateFail = await newBuildContext();
    const failed = await assignReleaseReady(env, {
      ...hardGateFail,
      qaA: qaAReport({
        visualScore: 96,
        hardGates: QA_A_HARD_GATE_IDS.map((id, index) => ({ id, passed: index !== 4 })),
        findings: [
          { severity: "P1", domain: "visual", description: "mobile loses asymmetric identity", evidenceRef: "qa/home-390.png" },
          { severity: "P3", domain: "polish", description: "spacing", evidenceRef: "qa/home-1440.png" },
        ],
      }),
      qaB: qaBReport({ technicalScore: 91 }),
      qaBuildVersionId: hardGateFail.buildVersionId,
    });
    expect(failed.releaseReady).toBe(false);
    expect(failed.reasons.join(" ")).toContain("MOBILE_PRESERVES_VISUAL_IDENTITY");
    expect(failed.blockers).toHaveLength(1);
    expect(failed.polish).toHaveLength(1);

    expect(await getReleaseRecord(env, hardGateFail.buildVersionId)).toBeNull();
    const events = await env.DB.prepare("SELECT to_state FROM build_workflow_events WHERE build_id = ?")
      .bind(hardGateFail.buildId)
      .all<{ to_state: string }>();
    expect((events.results ?? []).map((event) => event.to_state)).not.toContain("RELEASE_READY");

    const report = await getBuildStageArtifact<{ releaseBlockers: QaAReport["findings"]; nonBlockingPolish: QaAReport["findings"] }>(
      env, hardGateFail.buildVersionId, "qa_report"
    );
    expect(report!.value.releaseBlockers[0].severity).toBe("P1");
  });

  it("refuses QA reports produced for a different Build Version", async () => {
    const target = await newBuildContext();
    const other = await newBuildContext();
    await expect(
      assignReleaseReady(env, {
        ...target,
        qaA: qaAReport(),
        qaB: qaBReport(),
        qaBuildVersionId: other.buildVersionId,
      })
    ).rejects.toMatchObject({ code: "QA_NOT_FOR_THIS_VERSION", name: "ReleaseGateError" });
    expect(ReleaseGateError.name).toBe("ReleaseGateError");
  });
});
