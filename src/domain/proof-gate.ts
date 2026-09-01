// V2 REFERENCE_BOUND proof gate (issue #23, PRD sections 43-44).
//
// Aggregates the immutable benchmark run verdicts of the five frozen
// REFERENCE_BOUND Benchmark Sites and enforces the product gate:
// ORIGINAL_DESIGN work is permitted only when at least 3 of 5 satisfy
// Benchmark Pass under the frozen rules. A case counts ONLY through its
// recorded benchmark_runs row with status 'pass' — the PASS calculation
// already required automatic Release Ready, zero manual source edits and
// image spend within the USD 3 hard gate, so partial or manual results can
// never satisfy the gate. Failed cases remain recorded with their root
// causes for continued REFERENCE_BOUND improvement; nothing about the frozen
// targets is altered.

import type { Env } from "../env.d";
import { generateId, nowIso } from "../lib/crypto";
import { BENCHMARK_CASES, freezeBenchmarkCases } from "./benchmark";

export const REQUIRED_BENCHMARK_PASSES = 3;

export interface ProofGateCaseVerdict {
  caseId: string;
  slot: number;
  archetype: string;
  latestStatus: "pass" | "fail" | null;
  latestRunId: string | null;
  totalRuns: number;
  latestRootCause: string | null;
}

export interface ProofGateEvaluation {
  evaluationId: string;
  totalCases: number;
  passedCases: number;
  requiredPasses: number;
  gateOpen: boolean;
  perCase: ProofGateCaseVerdict[];
  /** Root-cause counts across the latest failing runs (post-gate improvement input). */
  failureCategories: Record<string, number>;
}

interface LatestRunRow {
  benchmark_case_id: string;
  status: "pass" | "fail";
  id: string;
  root_cause: string | null;
  total_runs: number;
}

// Reads the frozen cases and their latest recorded run verdicts without
// altering inputs or evidence, records the aggregate append-only, and
// returns whether the ORIGINAL_DESIGN gate is open.
export async function evaluateProofGate(env: Env): Promise<ProofGateEvaluation> {
  await freezeBenchmarkCases(env);

  const latest = await env.DB.prepare(
    `SELECT r.benchmark_case_id, r.status, r.id, r.root_cause,
            (SELECT COUNT(*) FROM benchmark_runs all_r WHERE all_r.benchmark_case_id = r.benchmark_case_id) AS total_runs
     FROM benchmark_runs r
     JOIN (
       SELECT benchmark_case_id, MAX(started_at || '|' || id) AS latest_key
       FROM benchmark_runs
       GROUP BY benchmark_case_id
     ) latest_sel
       ON latest_sel.benchmark_case_id = r.benchmark_case_id
      AND (r.started_at || '|' || r.id) = latest_sel.latest_key`
  ).all<LatestRunRow>();
  const latestByCase = new Map((latest.results ?? []).map((row) => [row.benchmark_case_id, row]));

  const perCase: ProofGateCaseVerdict[] = BENCHMARK_CASES.map((definition) => {
    const row = latestByCase.get(definition.id);
    return {
      caseId: definition.id,
      slot: definition.slot,
      archetype: definition.archetype,
      latestStatus: row?.status ?? null,
      latestRunId: row?.id ?? null,
      totalRuns: row?.total_runs ?? 0,
      latestRootCause: row?.status === "fail" ? row.root_cause : null,
    };
  });

  const passedCases = perCase.filter((verdict) => verdict.latestStatus === "pass").length;
  const failureCategories: Record<string, number> = {};
  for (const verdict of perCase) {
    if (verdict.latestStatus === "fail" && verdict.latestRootCause) {
      failureCategories[verdict.latestRootCause] = (failureCategories[verdict.latestRootCause] ?? 0) + 1;
    }
  }

  const gateOpen = passedCases >= REQUIRED_BENCHMARK_PASSES;
  const evaluationId = generateId();
  await env.DB.prepare(
    `INSERT INTO proof_gate_evaluations (id, total_cases, passed_cases, required_passes, gate_open, per_case_json, failure_categories_json, evaluated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      evaluationId,
      perCase.length,
      passedCases,
      REQUIRED_BENCHMARK_PASSES,
      gateOpen ? 1 : 0,
      JSON.stringify(perCase),
      JSON.stringify(failureCategories),
      nowIso()
    )
    .run();

  return {
    evaluationId,
    totalCases: perCase.length,
    passedCases,
    requiredPasses: REQUIRED_BENCHMARK_PASSES,
    gateOpen,
    perCase,
    failureCategories,
  };
}

// ORIGINAL_DESIGN remains blocked until the gate opens. Callers that start
// ORIGINAL_DESIGN Site Generations must pass this guard.
export async function assertOriginalDesignUnlocked(env: Env): Promise<ProofGateEvaluation> {
  const evaluation = await evaluateProofGate(env);
  if (!evaluation.gateOpen) {
    throw new Error(
      `ORIGINAL_DESIGN is locked: ${evaluation.passedCases}/${evaluation.totalCases} fixed Benchmark Sites satisfy Benchmark Pass (requires ${evaluation.requiredPasses}); failed cases remain recorded for REFERENCE_BOUND improvement`
    );
  }
  return evaluation;
}

export async function getLatestProofGateEvaluation(env: Env): Promise<ProofGateEvaluation | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM proof_gate_evaluations ORDER BY evaluated_at DESC LIMIT 1"
  ).first<{
    id: string;
    total_cases: number;
    passed_cases: number;
    required_passes: number;
    gate_open: number;
    per_case_json: string;
    failure_categories_json: string;
  }>();
  if (!row) return null;
  return {
    evaluationId: row.id,
    totalCases: row.total_cases,
    passedCases: row.passed_cases,
    requiredPasses: row.required_passes,
    gateOpen: row.gate_open === 1,
    perCase: JSON.parse(row.per_case_json) as ProofGateCaseVerdict[],
    failureCategories: JSON.parse(row.failure_categories_json) as Record<string, number>,
  };
}
