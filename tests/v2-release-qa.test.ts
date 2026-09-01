import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import {
  buildStandardEvidenceBundle,
  compareGeometry,
  standardCaptureSpec,
  type GeometryProfile,
  type PageCapture,
  type QaCaptureFn,
} from "../src/domain/qa-evidence";
import {
  evaluateQaARelease,
  evaluateQaBRelease,
  runQaAStage,
  runQaBStage,
  QA_A_HARD_GATE_IDS,
  QA_B_MANDATORY_GATE_IDS,
  type QaAReport,
  type QaBReport,
} from "../src/domain/qa-stages";
import { assignReleaseReady, getReleaseRecord, ReleaseGateError } from "../src/domain/release";
import { getBuildStageArtifact } from "../src/domain/stage-artifacts";
import type { RawAiGenerate } from "../src/domain/ai-boundary";
import type { PageId } from "../src/domain/site-generator";

// Primary-seam tests for standardized evidence, geometry comparison, QA-A/
// QA-B and Release Ready (issue #13).

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
      facts: { businessName: "Rift Valley Roasters", contactEmail: "hi@rvr.example" },
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

describe("geometry comparator", () => {
  it("matches structurally equivalent candidates regardless of pixel content", () => {
    const reference = geometry();
    // Different bytes entirely, near-identical structure within tolerances.
    const candidate = geometry({
      firstViewportHeightRatio: 0.95,
      imageMassRatio: 0.42,
      whitespaceRatio: 0.24,
      sectionHeightRatios: [0.95, 0.62, 0.78, 0.32],
    });
    const comparison = compareGeometry(reference, candidate);
    expect(comparison.similarityScore).toBeGreaterThanOrEqual(75);
    expect(comparison.materialDeviations).toEqual([]);
  });

  it("flags material structural deviations without pixel equality", () => {
    const reference = geometry();
    const reordered = geometry({
      regionOrder: ["intro", "hero", "cta", "services"],
      surfaceSequence: ["ink", "ink", "ink", "ink"],
      dominantAlignment: "center",
      firstViewportHeightRatio: 0.4,
      imageMassRatio: 0.05,
    });
    const comparison = compareGeometry(reference, reordered);
    expect(comparison.similarityScore).toBeLessThan(50);
    const deviationIds = comparison.materialDeviations.map((entry) => entry.split(" ")[0]);
    expect(deviationIds).toEqual(expect.arrayContaining(["region_order", "dominant_alignment", "surface_sequence"]));
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

  it("runs both stages through the canonical prompts with provenance", async () => {
    const context = await newBuildContext();
    const generate: RawAiGenerate = async (_system, user) => {
      if (user.includes("hard composition gate")) {
        return { content: JSON.stringify(qaAReport()), provider: "test", model: "test-model-q" };
      }
      return { content: JSON.stringify(qaBReport()), provider: "test", model: "test-model-q" };
    };
    const qaA = await runQaAStage(env, {
      ...context,
      buildVersionNumber: 1,
      context: {
        businessName: "Rift Valley Roasters",
        geometryComparison: compareGeometry(geometry(), geometry()),
        evidenceSummary: "9 standardized captures",
        signatureTraitIds: ["bp-serif", "bp-asymmetric", "bp-surfaces"],
        adaptationContractQaExceptions: [],
      },
      evidenceR2Key: "evidence/qa-bundle.json",
      generate,
    });
    expect(qaA.provenance.promptId).toBe("qa-a-visual-content");
    expect(qaA.provenance.promptVersion).toBe("v3");

    const qaB = await runQaBStage(env, {
      ...context,
      buildVersionNumber: 1,
      context: {
        formServiceEndpoint: "https://forms.wazibiz.example/api/v2/forms/submit",
        evidenceSummary: "runtime clean",
        preflightPassed: true,
        imageManifestSummary: "2 accepted images bundled",
      },
      evidenceR2Key: "evidence/qa-bundle.json",
      generate,
    });
    expect(qaB.provenance.promptId).toBe("qa-b-browser-technical");
    expect(qaB.provenance.promptVersion).toBe("v3");
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
      geometryComparison: compareGeometry(geometry(), geometry()),
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
