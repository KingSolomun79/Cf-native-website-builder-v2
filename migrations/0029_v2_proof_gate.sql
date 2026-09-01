-- V2 REFERENCE_BOUND proof gate (issue #23, PRD sections 43-44).
--
-- Aggregates the immutable benchmark run verdicts for the five frozen cases
-- and records every evaluation append-only. The gate opens ORIGINAL_DESIGN
-- work only when at least 3 of 5 fixed Benchmark Sites satisfy Benchmark
-- Pass under the frozen rules (automatic Release Ready, zero manual source
-- edits, image spend within the USD 3 hard gate — all already enforced when
-- the run rows were recorded). Failed cases stay recorded; nothing about the
-- frozen targets changes.

CREATE TABLE proof_gate_evaluations (
  id TEXT PRIMARY KEY,
  total_cases INTEGER NOT NULL,
  passed_cases INTEGER NOT NULL,
  required_passes INTEGER NOT NULL,
  gate_open INTEGER NOT NULL,
  per_case_json TEXT NOT NULL,
  failure_categories_json TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);

CREATE TRIGGER proof_gate_evaluations_no_update BEFORE UPDATE ON proof_gate_evaluations
BEGIN
  SELECT RAISE(ABORT, 'PROOF_GATE_EVALUATION_IMMUTABLE');
END;

CREATE TRIGGER proof_gate_evaluations_no_delete BEFORE DELETE ON proof_gate_evaluations
BEGIN
  SELECT RAISE(ABORT, 'PROOF_GATE_EVALUATION_IMMUTABLE');
END;
