import { beforeAll, describe, expect, it } from "vitest";
import { env as providedEnv } from "cloudflare:test";
import type { Env } from "../src/env.d";
import {
  BENCHMARK_CASES,
  benchmarkCaseById,
  freezeBenchmarkCases,
  recordBenchmarkRun,
} from "../src/domain/benchmark";
import {
  evaluateProofGate,
  assertOriginalDesignUnlocked,
  getLatestProofGateEvaluation,
  REQUIRED_BENCHMARK_PASSES,
} from "../src/domain/proof-gate";

// Primary-seam tests for the REFERENCE_BOUND proof gate (issue #23).
// Scenarios append fresh benchmark runs to control each case's LATEST
// verdict deterministically on top of the shared, append-only run history.

const env = providedEnv as unknown as Env;

async function appendRun(caseId: string, pass: boolean, overrides: { manualEdits?: number; rootCause?: string } = {}): Promise<void> {
  await recordBenchmarkRun(env, {
    benchmarkCaseId: caseId,
    siteGenerationId: `sg-gate-${Math.random().toString(36).slice(2)}`,
    buildId: `b-gate-${Math.random().toString(36).slice(2)}`,
    buildVersionId: `bv-gate-${Math.random().toString(36).slice(2)}`,
    releaseReady: pass,
    imageSpendUsd: pass ? 1.8 : 2.9,
    manualSourceEdits: overrides.manualEdits ?? 0,
    rootCause: pass ? null : (overrides.rootCause ?? "GENERATOR"),
  });
}

async function setSuiteOutcome(pattern: Array<boolean>): Promise<void> {
  expect(pattern.length).toBe(BENCHMARK_CASES.length);
  for (const definition of BENCHMARK_CASES) {
    await appendRun(definition.id, pattern[definition.slot - 1]);
  }
}

describe("REFERENCE_BOUND proof gate", () => {
  beforeAll(async () => {
    await freezeBenchmarkCases(env);
  });

  it("aggregates exactly the five frozen cases without altering inputs", async () => {
    const checksumsBefore = await env.DB.prepare(
      "SELECT id, evidence_checksum, screenshot_checksum FROM benchmark_cases ORDER BY slot"
    ).all<{ id: string; evidence_checksum: string; screenshot_checksum: string }>();

    const evaluation = await evaluateProofGate(env);
    expect(evaluation.totalCases).toBe(5);
    expect(evaluation.requiredPasses).toBe(REQUIRED_BENCHMARK_PASSES);
    expect(evaluation.perCase.map((verdict) => verdict.caseId)).toEqual(BENCHMARK_CASES.map((definition) => definition.id));

    const checksumsAfter = await env.DB.prepare(
      "SELECT id, evidence_checksum, screenshot_checksum FROM benchmark_cases ORDER BY slot"
    ).all<{ id: string; evidence_checksum: string; screenshot_checksum: string }>();
    expect(checksumsAfter.results).toEqual(checksumsBefore.results);

    // The aggregate is recorded append-only.
    const row = await env.DB.prepare("SELECT * FROM proof_gate_evaluations WHERE id = ?")
      .bind(evaluation.evaluationId)
      .first<{ gate_open: number; passed_cases: number }>();
    expect(row!.passed_cases).toBe(evaluation.passedCases);
    await expect(
      env.DB.prepare("UPDATE proof_gate_evaluations SET gate_open = 1 WHERE id = ?").bind(evaluation.evaluationId).run()
    ).rejects.toThrow("PROOF_GATE_EVALUATION_IMMUTABLE");
    await expect(
      env.DB.prepare("DELETE FROM proof_gate_evaluations WHERE id = ?").bind(evaluation.evaluationId).run()
    ).rejects.toThrow("PROOF_GATE_EVALUATION_IMMUTABLE");
  });

  it("keeps ORIGINAL_DESIGN blocked at 0/5 and 2/5", async () => {
    await setSuiteOutcome([false, false, false, false, false]);
    let evaluation = await evaluateProofGate(env);
    expect(evaluation.passedCases).toBe(0);
    expect(evaluation.gateOpen).toBe(false);
    await expect(assertOriginalDesignUnlocked(env)).rejects.toThrow(/ORIGINAL_DESIGN is locked: 0\/5/);

    await setSuiteOutcome([true, true, false, false, false]);
    evaluation = await evaluateProofGate(env);
    expect(evaluation.passedCases).toBe(2);
    expect(evaluation.gateOpen).toBe(false);
    await expect(assertOriginalDesignUnlocked(env)).rejects.toThrow(/2\/5/);
  });

  it("opens exactly at 3/5 and at 5/5", async () => {
    await setSuiteOutcome([true, true, true, false, false]);
    const atThree = await evaluateProofGate(env);
    expect(atThree.passedCases).toBe(3);
    expect(atThree.gateOpen).toBe(true);
    await expect(assertOriginalDesignUnlocked(env)).resolves.toMatchObject({ gateOpen: true });

    await setSuiteOutcome([true, true, true, true, true]);
    const atFive = await evaluateProofGate(env);
    expect(atFive.passedCases).toBe(5);
    expect(atFive.gateOpen).toBe(true);

    const latest = await getLatestProofGateEvaluation(env);
    expect(latest!.evaluationId).toBe(atFive.evaluationId);
    expect(latest!.perCase.every((verdict) => verdict.latestStatus === "pass")).toBe(true);
  });

  it("cannot be bypassed by partial or manual results", async () => {
    // Two clean passes plus one 'release-ready' run achieved WITH manual
    // source edits: the run row is status fail, so the gate stays closed at
    // 2 clean passes.
    await setSuiteOutcome([true, true, false, false, false]);
    await appendRun(benchmarkCaseById("bench-responsive-motion").id, false, { manualEdits: 3 });

    const evaluation = await evaluateProofGate(env);
    expect(evaluation.passedCases).toBe(2);
    expect(evaluation.gateOpen).toBe(false);
    await expect(assertOriginalDesignUnlocked(env)).rejects.toThrow(/locked/);

    // Budget-bypassed attempts are equally inert: a spend-over run row is a
    // failure regardless of release readiness.
    await recordBenchmarkRun(env, {
      benchmarkCaseId: benchmarkCaseById("bench-trades-local-service").id,
      siteGenerationId: "sg-x", buildId: "b-x", buildVersionId: "bv-x",
      releaseReady: true, imageSpendUsd: 3.5, manualSourceEdits: 0,
    });
    const after = await evaluateProofGate(env);
    expect(after.passedCases).toBe(2);
    expect(after.gateOpen).toBe(false);
  });

  it("exposes failure categories for continued improvement after the gate opens", async () => {
    await setSuiteOutcome([true, true, true, false, false]);
    // Give the two failing cases distinct root causes via fresh appends.
    await appendRun(benchmarkCaseById("bench-trades-local-service").id, false, { rootCause: "IMAGE_GENERATION" });
    await appendRun(benchmarkCaseById("bench-responsive-motion").id, false, { rootCause: "GENERATOR" });

    const evaluation = await evaluateProofGate(env);
    expect(evaluation.gateOpen).toBe(true); // gate open while failures remain recorded
    expect(evaluation.failureCategories).toEqual({ IMAGE_GENERATION: 1, GENERATOR: 1 });

    const failing = evaluation.perCase.filter((verdict) => verdict.latestStatus === "fail");
    expect(failing.map((verdict) => verdict.caseId).sort()).toEqual([
      "bench-responsive-motion", "bench-trades-local-service",
    ]);
    expect(failing.every((verdict) => verdict.totalRuns > 0)).toBe(true);

    // The frozen failed cases were not replaced by easier References.
    const cases = await env.DB.prepare("SELECT COUNT(*) AS n FROM benchmark_cases").first<{ n: number }>();
    expect(cases!.n).toBe(5);
  });
});
