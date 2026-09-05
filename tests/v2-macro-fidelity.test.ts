import { describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import { startSiteGeneration, createInitialBuild } from "../src/domain/lifecycle";
import { runQaAStage, QA_A_HARD_GATE_IDS, type QaAReport } from "../src/domain/qa-stages";
import { compareGeometry, geometryFromRegions, evaluateReferenceMacroFidelity, type GeometryProfile } from "../src/domain/qa-evidence";
import { evaluateQaARelease } from "../src/domain/qa-stages";

// Issue #44 — independent direct reference fidelity: a hard, non-averageable
// REFERENCE_MACRO_FIDELITY gate compares reference evidence directly with the
// candidate; an unmeasured reference fails closed; invented hard-gate ids are
// a QA stage failure.

const fullCandidate: GeometryProfile = {
  regionOrder: ["hero", "gallery", "services", "footer-cta"],
  firstViewportHeightRatio: 0.92,
  sectionHeightRatios: [1, 0.8, 0.9, 0.5],
  imageMassRatio: 0.3,
  containerWidthRatio: 0.8,
  columnRatios: [5 / 7],
  dominantAlignment: "asymmetric",
  surfaceSequence: ["paper", "ink", "paper"],
  whitespaceRatio: 0.2,
};

function measuredReference(): GeometryProfile {
  return geometryFromRegions(
    [
      { id: "hero", height: 855, viewportHeightRatio: 0.95 },
      { id: "gallery", height: 720, viewportHeightRatio: 0.8 },
      { id: "services", height: 810, viewportHeightRatio: 0.9 },
      { id: "footer-cta", height: 450, viewportHeightRatio: 0.5 },
    ],
    0.28
  );
}

const env = providedEnv as unknown as Env;

describe("REFERENCE_MACRO_FIDELITY gate (issue #44)", () => {
  it("PASS when all measured comparisons hold", () => {
    const gate = evaluateReferenceMacroFidelity(compareGeometry(measuredReference(), fullCandidate));
    expect(gate.verdict).toBe("PASS");
    expect(gate.gateId).toBe("REFERENCE_MACRO_FIDELITY");
  });

  it("FAIL with the material deviations when the candidate drifts from the measured reference", () => {
    const drifted = { ...fullCandidate, firstViewportHeightRatio: 0.4, regionOrder: ["services", "gallery", "hero", "footer-cta"] };
    const gate = evaluateReferenceMacroFidelity(compareGeometry(measuredReference(), drifted));
    expect(gate.verdict).toBe("FAIL");
    expect(gate.materialDeviations.length).toBeGreaterThanOrEqual(2);
    expect(gate.reason).toContain("deviates materially");
  });

  it("FAILS CLOSED on INSUFFICIENT_REFERENCE_EVIDENCE — an unmeasured reference can never pass", () => {
    const empty = compareGeometry(geometryFromRegions([], null), fullCandidate);
    expect(empty.status).toBe("INSUFFICIENT_REFERENCE_EVIDENCE");
    const gate = evaluateReferenceMacroFidelity(empty);
    expect(gate.verdict).toBe("FAIL");
    expect(gate.reason).toContain("INSUFFICIENT_REFERENCE_EVIDENCE");
  });

  it("is non-averageable: a failing macro gate blocks release even at visual 94", () => {
    const report: QaAReport = {
      version: "1",
      visualScore: 94,
      contentScore: 95,
      fabrication: false,
      hardGates: [
        ...QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: true })),
        { id: "REFERENCE_MACRO_FIDELITY", passed: false },
      ],
      findings: [],
    };
    const verdict = evaluateQaARelease(report);
    expect(verdict.releaseReady).toBe(false);
    expect(verdict.reasons.join(" ")).toContain("REFERENCE_MACRO_FIDELITY");
  });
});

describe("QA-A hard-gate enumeration integrity (issue #44)", () => {
  it("rejects a QA-A report that invents, omits or duplicates hard gates", async () => {
    const screenshotKey = `references/uploads/mf-${Math.random().toString(36).slice(2)}.png`;
    await putObjectForTest(screenshotKey);
    const started = await startSiteGeneration(env, {
      payload: {
        buildMode: "REFERENCE_BOUND",
        facts: { businessName: "Gate Integrity Co", contactEmail: "gi@integrity.example" },
        reference: { screenshotR2Key: screenshotKey, url: "https://meridian-atelier.example.com/" },
      },
    });
    const created = await createInitialBuild(env, { siteGenerationId: started.siteGenerationId });
    const scripts = await import("./helpers/pipeline-scripts");
    const base = scripts.createPipelineScripts();

    const invented = (report: QaAReport): QaAReport => ({
      ...report,
      hardGates: [{ id: "SIGNATURE_TRAITS_PRESERVED", passed: true }, ...report.hardGates.slice(1)],
    });
    // An invented gate id is rejected at the SCHEMA layer since the output
    // contract enumerates the canonical literals (production retest
    // 2026-09-05): the model sees its violation in the structural repair
    // attempt instead of a terminal enumeration error.
    await expect(
      runQaAStage(env, {
        buildId: created.buildId,
        siteGenerationId: started.siteGenerationId,
        buildVersionId: created.buildVersionId,
        buildVersionNumber: 1,
        context: {
          businessName: "Gate Integrity Co",
          geometryComparison: compareGeometry(measuredReference(), fullCandidate),
          evidenceSummary: "test",
          signatureTraitIds: ["bp-typography"],
          canonicalRegions: [{ order: 1, id: "r1", purpose: "hero" }],
          firstViewportRegionIds: ["r1"],
          adaptationContractQaExceptions: [],
        },
        evidenceR2Key: "qa/evidence.json",
        generate: async (system, user, attempt) => {
          const response = await base.generate!(system, user, attempt);
          return { ...response, content: JSON.stringify(invented(JSON.parse(response.content) as QaAReport)) };
        },
      })
    ).rejects.toThrow();

    // The enumeration-integrity check stays the exactly-once backstop for
    // schema-valid but duplicated sets.
    const duplicated = (report: QaAReport): QaAReport => ({
      ...report,
      hardGates: [...report.hardGates, { ...report.hardGates[0] }],
    });
    await expect(
      runQaAStage(env, {
        buildId: created.buildId,
        siteGenerationId: started.siteGenerationId,
        buildVersionId: created.buildVersionId,
        buildVersionNumber: 1,
        context: {
          businessName: "Gate Integrity Co",
          geometryComparison: compareGeometry(measuredReference(), fullCandidate),
          evidenceSummary: "test",
          signatureTraitIds: ["bp-typography"],
          canonicalRegions: [{ order: 1, id: "r1", purpose: "hero" }],
          firstViewportRegionIds: ["r1"],
          adaptationContractQaExceptions: [],
        },
        evidenceR2Key: "qa/evidence.json",
        generate: async (system, user, attempt) => {
          const response = await base.generate!(system, user, attempt);
          return { ...response, content: JSON.stringify(duplicated(JSON.parse(response.content) as QaAReport)) };
        },
      })
    ).rejects.toThrow(/hard-gate enumeration invalid/);
  });
});

async function putObjectForTest(key: string): Promise<void> {
  const { putObject } = await import("../src/lib/assets");
  const { buildPng } = await import("./helpers/png");
  await putObject(env, key, new Uint8Array(buildPng({ width: 1440, height: 3200 })));
}
