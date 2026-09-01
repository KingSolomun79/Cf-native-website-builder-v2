import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  benchmarkCaseById,
  evidenceChecksumOf,
  screenshotChecksumOf,
  freezeBenchmarkCases,
  getBenchmarkSuiteStatus,
} from "../src/domain/benchmark";
import { runBenchmarkCase } from "../src/domain/benchmark-runner";
import { createGoldenScripts } from "./helpers/benchmark-golden";
import { getFrozenReferenceEvidence } from "../src/domain/reference-intake";
import { QA_A_HARD_GATE_IDS } from "../src/domain/qa-stages";

// Benchmark Site 5 end-to-end validation (issue #22): the frozen
// difficult-but-supported responsive/motion case runs the autonomous pipeline
// under its SUPPORTED_WITH_LIMITATIONS classification and frozen Adaptation
// Contract; complete PASS/failure evidence is persisted without manual
// source edits.

const env = providedEnv as unknown as Env;
const CASE_ID = "bench-responsive-motion";

describe("Benchmark Site 5 — difficult but supported responsive/motion", () => {
  let caseDefinition: ReturnType<typeof benchmarkCaseById>;

  beforeAll(async () => {
    await freezeBenchmarkCases(env);
    caseDefinition = benchmarkCaseById(CASE_ID);
  });

  it("uses the frozen inputs from #17 unchanged, including the Adaptation Contract", async () => {
    const row = await env.DB.prepare("SELECT * FROM benchmark_cases WHERE id = ?")
      .bind(CASE_ID)
      .first<{ archetype: string; evidence_checksum: string; screenshot_checksum: string; adaptation_contract_json: string }>();
    expect(row!.archetype).toBe("difficult but supported responsive/motion reference");
    expect(row!.evidence_checksum).toBe(await evidenceChecksumOf(caseDefinition.evidence));
    expect(row!.screenshot_checksum).toBe(await screenshotChecksumOf(caseDefinition.evidence));
    const contract = JSON.parse(row!.adaptation_contract_json!) as { acceptedApproximations: Array<{ replaces: string }> };
    expect(contract.acceptedApproximations.map((entry) => entry.replaces)).toEqual(["heavy_parallax", "complex_slider"]);
    expect(caseDefinition.evidence.motionObservations.map((observation) => observation.kind)).toEqual([
      "heavy_parallax", "complex_slider",
    ]);
  });

  it("traverses the autonomous pipeline to Release Ready under the frozen Adaptation Contract", async () => {
    const outcome = await runBenchmarkCase(env, { caseId: CASE_ID, deps: createGoldenScripts(caseDefinition) });

    expect(outcome.pass).toBe(true);
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.imageSpendUsd).toBeLessThanOrEqual(3.0);

    // The frozen evidence package records SUPPORTED_WITH_LIMITATIONS plus
    // the accepted Adaptation Contract.
    const frozen = await getFrozenReferenceEvidence(env, outcome.siteGenerationId);
    expect(frozen!.suitability).toBe("SUPPORTED_WITH_LIMITATIONS");
    expect(frozen!.adaptationContract!.qaExceptions).toContain("parallax depth reduced to one layer");

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; manual_source_edits: number; qa_summary_json: string; provenance_json: string }>();
    expect(run!.status).toBe("pass");
    expect(run!.manual_source_edits).toBe(0);

    const qaSummary = JSON.parse(run!.qa_summary_json!) as { hardGates: Array<{ id: string; passed: boolean }>; visualScore: number };
    expect(qaSummary.visualScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.hardGates.map((gate) => gate.id).sort()).toEqual([...QA_A_HARD_GATE_IDS].sort());

    // The declared limitations flow into the Blueprint as declared
    // limitations and the motion regions survive into the generated site.
    const homeArtifact = await env.DB.prepare(
      "SELECT artifact_r2_key FROM build_stage_artifacts WHERE build_version_id = ? AND kind = 'generated_page' AND subkey = 'home'"
    )
      .bind(outcome.buildVersionId)
      .first<{ artifact_r2_key: string }>();
    const stored = await env.SITE_BUCKET.get(homeArtifact!.artifact_r2_key);
    const page = JSON.parse(await new Response(stored!.body).text()) as { html: string };
    expect(page.html).toContain('data-region="split-hero"');
    expect(page.html).toContain('data-region="motion-showcase"');
    expect(page.html).toContain("data-reveal"); // declared single-layer approximation present as the reveal behavior

    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string }>;
    expect(provenance.some((entry) => entry.stage === "qa-a-visual-content")).toBe(true);

    // All five benchmark cases have now produced at least one PASS: the 3/5
    // shape for the #23 proof gate is satisfied by the suite, not by
    // swapping this difficult case.
    const suite = await getBenchmarkSuiteStatus(env);
    expect(suite.perCase.find((item) => item.caseId === CASE_ID)?.latestStatus).toBe("pass");
  });

  it("records actionable failure evidence when the motion approximation breaks mobile identity", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();

    // A QA regression on the motion-heavy mobile identity must produce an
    // actionable failure — the declared Adaptation Contract exceptions do
    // NOT legalize losing mobile visual identity.
    const scripts = createGoldenScripts(caseDefinition);
    const failingGenerate = async (systemPrompt: string, userPrompt: string, attempt: number) => {
      if (userPrompt.includes("hard composition gate") && attempt === 1) {
        return {
          content: JSON.stringify({
            version: "1",
            visualScore: 90,
            contentScore: 93,
            fabrication: false,
            hardGates: QA_A_HARD_GATE_IDS.map((id) => ({ id, passed: id !== "MOBILE_PRESERVES_VISUAL_IDENTITY" })),
            findings: [
              { severity: "P1", domain: "visual", description: "motion-showcase collapses to a generic stack on mobile", evidenceRef: "qa/home-390.png" },
            ],
          }),
          provider: "benchmark-script",
          model: "benchmark-golden-model",
        };
      }
      return scripts.generate(systemPrompt, userPrompt, attempt);
    };

    const outcome = await runBenchmarkCase(env, { caseId: CASE_ID, deps: { ...scripts, generate: failingGenerate } });
    expect(outcome.pass).toBe(false);
    expect(outcome.rootCause).toBe("GENERATOR");

    const run = await env.DB.prepare("SELECT qa_summary_json FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ qa_summary_json: string }>();
    const qaSummary = JSON.parse(run!.qa_summary_json!) as { reasons: string[] };
    expect(qaSummary.reasons.join(" ")).toContain("MOBILE_PRESERVES_VISUAL_IDENTITY");

    const checksumsAfter = await env.DB.prepare(
      "SELECT evidence_checksum, screenshot_checksum FROM benchmark_cases WHERE id = ?"
    )
      .bind(CASE_ID)
      .first<{ evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter).toEqual(checksumsBefore);
  });
});
