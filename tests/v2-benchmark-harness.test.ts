import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  BENCHMARK_CASES,
  freezeBenchmarkCases,
  verifyBenchmarkIdentity,
  evaluateBenchmarkPass,
  recordBenchmarkRun,
  getBenchmarkSuiteStatus,
  benchmarkCaseById,
  BenchmarkHarnessError,
} from "../src/domain/benchmark";
import { runBenchmarkCase } from "../src/domain/benchmark-runner";
import { createGoldenScripts } from "./helpers/benchmark-golden";

// Primary-seam tests for the five-site benchmark harness (issue #17).

const env = providedEnv as unknown as Env;

describe("frozen benchmark identity", () => {
  beforeAll(async () => {
    await freezeBenchmarkCases(env);
  });

  it("freezes exactly five materially different cases with stable replacement briefs", async () => {
    const rows = await env.DB.prepare("SELECT * FROM benchmark_cases ORDER BY slot").all<{
      id: string; slot: number; archetype: string; replacement_brief_json: string; prompt_model_schema_json: string; adaptation_contract_json: string | null;
    }>();
    expect((rows.results ?? []).length).toBe(5);
    expect((rows.results ?? []).map((row) => row.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set((rows.results ?? []).map((row) => row.archetype)).size).toBe(5);
    // Stable replacement briefs + frozen prompt/model/schema settings.
    for (const row of rows.results ?? []) {
      const brief = JSON.parse(row.replacement_brief_json) as { businessName: string };
      expect(brief.businessName).toBeTruthy();
      const settings = JSON.parse(row.prompt_model_schema_json) as Record<string, { promptVersion: string }>;
      expect(settings["reference-analyzer"].promptVersion).toBe("v3");
      expect(settings["website-generator"].promptVersion).toBe("v4");
    }
    // Only the difficult motion case carries an Adaptation Contract.
    const withContract = (rows.results ?? []).filter((row) => row.adaptation_contract_json !== null);
    expect(withContract.map((row) => row.id)).toEqual(["bench-responsive-motion"]);

    // Freeze is idempotent.
    await expect(freezeBenchmarkCases(env)).resolves.toBeUndefined();
  });

  it("benchmark references cannot be silently swapped", async () => {
    const caseDefinition = benchmarkCaseById("bench-asymmetric-editorial");

    // Identity verification rejects mutated evidence or screenshot bytes.
    const mutatedEvidence = {
      ...caseDefinition.evidence,
      screenshotBytes: "PNG-easier-substitute-reference",
      regions: caseDefinition.evidence.regions.slice(0, 2),
    };
    await expect(verifyBenchmarkIdentity(env, { caseId: caseDefinition.id, evidence: mutatedEvidence })).rejects.toMatchObject({
      code: "BENCHMARK_IDENTITY_MISMATCH",
    });

    await expect(verifyBenchmarkIdentity(env, { caseId: caseDefinition.id, evidence: caseDefinition.evidence })).resolves.toBeUndefined();
    await expect(verifyBenchmarkIdentity(env, { caseId: "bench-does-not-exist", evidence: caseDefinition.evidence })).rejects.toMatchObject({
      code: "BENCHMARK_CASE_NOT_FOUND",
    });

    // Frozen rows are immutable at the storage boundary.
    await expect(
      env.DB.prepare("UPDATE benchmark_cases SET evidence_checksum = 'x' WHERE id = ?").bind(caseDefinition.id).run()
    ).rejects.toThrow("BENCHMARK_CASE_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM benchmark_cases WHERE id = ?").bind(caseDefinition.id).run()
    ).rejects.toThrow("BENCHMARK_CASE_IMMUTABLE");
    const existingRun = await recordBenchmarkRun(env, {
      benchmarkCaseId: caseDefinition.id,
      siteGenerationId: "sg", buildId: "b", buildVersionId: "bv",
      releaseReady: false, imageSpendUsd: 0, manualSourceEdits: 0, rootCause: "PLATFORM_RUNTIME",
    });
    await expect(
      env.DB.prepare("DELETE FROM benchmark_runs WHERE id = ?").bind(existingRun.runId).run()
    ).rejects.toThrow("BENCHMARK_RUN_IMMUTABLE_APPEND_ONLY");
    expect(BENCHMARK_CASES.length).toBe(5);
    expect(BenchmarkHarnessError.name).toBe("BenchmarkHarnessError");
  });
});

describe("benchmark PASS calculation", () => {
  it("defines PASS as automated Release Ready + zero manual edits + spend within the USD 3 hard gate", () => {
    expect(evaluateBenchmarkPass({ releaseReady: true, imageSpendUsd: 2.95, manualSourceEdits: 0 })).toEqual({ pass: true, reasons: [] });
    expect(evaluateBenchmarkPass({ releaseReady: false, imageSpendUsd: 1.0, manualSourceEdits: 0 }).pass).toBe(false);
    expect(evaluateBenchmarkPass({ releaseReady: true, imageSpendUsd: 3.01, manualSourceEdits: 0 }).reasons.join(" ")).toContain("hard gate");
    expect(evaluateBenchmarkPass({ releaseReady: true, imageSpendUsd: 1.0, manualSourceEdits: 2 }).reasons.join(" ")).toContain("manual source edit");
  });
});

describe("benchmark case runner", () => {
  beforeAll(async () => {
    await freezeBenchmarkCases(env);
  });

  it("drives a frozen case through the automated pipeline to a recorded PASS without Approval or Publication", async () => {
    const caseDefinition = benchmarkCaseById("bench-asymmetric-editorial");
    const scripts = createGoldenScripts(caseDefinition);

    const outcome = await runBenchmarkCase(env, { caseId: caseDefinition.id, deps: scripts });

    expect(outcome.pass).toBe(true);
    expect(outcome.reasons).toEqual([]);
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.imageSpendUsd).toBeGreaterThan(0);
    expect(outcome.imageSpendUsd).toBeLessThanOrEqual(3.0);

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; release_ready: number; image_spend_usd: number; root_cause: string | null; qa_summary_json: string; provenance_json: string }>();
    expect(run!.status).toBe("pass");
    expect(run!.release_ready).toBe(1);
    expect(run!.root_cause).toBeNull();
    const qaSummary = JSON.parse(run!.qa_summary_json!) as { visualScore: number; technicalScore: number };
    expect(qaSummary.visualScore).toBeGreaterThanOrEqual(90);
    expect(qaSummary.technicalScore).toBeGreaterThanOrEqual(90);

    // Harness records prompt/model/schema provenance for the run.
    const provenance = JSON.parse(run!.provenance_json!) as Array<{ stage: string; prompt_id: string; prompt_version: string; model: string; schema_version: string }>;
    const stages = new Set(provenance.map((entry) => entry.stage));
    for (const expected of ["reference-analyzer", "visual-blueprint-generator", "website-generator", "kie-image-prompt-generator", "qa-a-visual-content", "qa-b-browser-technical"]) {
      expect(stages.has(expected)).toBe(true);
    }
    expect(provenance.every((entry) => entry.model === "benchmark-golden-model")).toBe(true);

    // No publication/approval was required: no approvals or publications rows
    // exist for this build.
    const approvals = await env.DB.prepare("SELECT COUNT(*) AS n FROM build_approvals WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    const publications = await env.DB.prepare("SELECT COUNT(*) AS n FROM publications WHERE build_id = ?")
      .bind(outcome.buildId)
      .first<{ n: number }>();
    expect(approvals!.n).toBe(0);
    expect(publications!.n).toBe(0);

    // Suite status reflects the pass and the 3/5 gate shape.
    const suite = await getBenchmarkSuiteStatus(env);
    expect(suite.totalCases).toBe(5);
    expect(suite.requiredPasses).toBe(3);
    const entry = suite.perCase.find((item) => item.caseId === caseDefinition.id);
    expect(entry?.latestStatus).toBe("pass");
  });

  it("records a FAIL with root cause when the image budget gate aborts the run", async () => {
    const caseDefinition = benchmarkCaseById("bench-responsive-motion");
    const scripts = createGoldenScripts(caseDefinition, { imageCostUsd: 0.5 });

    const outcome = await runBenchmarkCase(env, { caseId: caseDefinition.id, deps: scripts });

    expect(outcome.pass).toBe(false);
    expect(outcome.releaseReady).toBe(false);
    expect(outcome.rootCause).toBe("IMAGE_GENERATION");

    const run = await env.DB.prepare("SELECT * FROM benchmark_runs WHERE id = ?")
      .bind(outcome.runId)
      .first<{ status: string; root_cause: string; qa_summary_json: string }>();
    expect(run!.status).toBe("fail");
    expect(run!.root_cause).toBe("IMAGE_GENERATION");
    const failure = JSON.parse(run!.qa_summary_json!) as { failedStage: string };
    expect(failure.failedStage).toBe("images");

    // The difficult case keeps its Adaptation Contract through intake (the
    // run reached the image stage, so SUPPORTED_WITH_LIMITATIONS was
    // satisfied with the frozen contract).
    const suite = await getBenchmarkSuiteStatus(env);
    const entry = suite.perCase.find((item) => item.caseId === caseDefinition.id);
    expect(entry?.latestStatus).toBe("fail");
    expect(suite.gateSatisfied).toBe(false);
  });

  it("records manual-source-edit failures as non-PASS", async () => {
    const caseDefinition = benchmarkCaseById("bench-corporate-professional");
    const scripts = createGoldenScripts(caseDefinition);
    const outcome = await runBenchmarkCase(env, { caseId: caseDefinition.id, deps: scripts, manualSourceEdits: 3 });
    expect(outcome.releaseReady).toBe(true);
    expect(outcome.pass).toBe(false);
    expect(outcome.reasons.join(" ")).toContain("manual source edit");
  });
});
