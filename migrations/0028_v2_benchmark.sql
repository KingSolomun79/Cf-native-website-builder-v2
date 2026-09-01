-- V2 five-site REFERENCE_BOUND benchmark harness (issue #17, PRD 43-45).
--
-- Exactly five materially different benchmark cases are frozen: reference
-- identity (evidence + screenshot checksums), the stable replacement-Business
-- brief, the Adaptation Contract where applicable, and the prompt/model/schema
-- settings. Rows are immutable once frozen so a difficult or failing Reference
-- can never be silently swapped. Every run records release outcome, QA
-- summary, root cause, image spend and provenance; Benchmark PASS requires
-- automated Release Ready with zero manual source edits and image spend
-- within the USD 3 hard gate (Approval/Publication are not criteria).

CREATE TABLE benchmark_cases (
  id TEXT PRIMARY KEY,
  slot INTEGER NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 5),
  archetype TEXT NOT NULL,
  reference_url TEXT,
  evidence_checksum TEXT NOT NULL,
  screenshot_checksum TEXT NOT NULL,
  replacement_brief_json TEXT NOT NULL,
  adaptation_contract_json TEXT,
  prompt_model_schema_json TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE TRIGGER benchmark_cases_no_update BEFORE UPDATE ON benchmark_cases
BEGIN
  SELECT RAISE(ABORT, 'BENCHMARK_CASE_IMMUTABLE');
END;

CREATE TRIGGER benchmark_cases_no_delete BEFORE DELETE ON benchmark_cases
BEGIN
  SELECT RAISE(ABORT, 'BENCHMARK_CASE_IMMUTABLE');
END;

CREATE TABLE benchmark_runs (
  id TEXT PRIMARY KEY,
  benchmark_case_id TEXT NOT NULL REFERENCES benchmark_cases(id),
  site_generation_id TEXT NOT NULL,
  build_id TEXT NOT NULL,
  build_version_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'pass', 'fail')),
  release_ready INTEGER NOT NULL DEFAULT 0,
  image_spend_usd REAL NOT NULL DEFAULT 0,
  manual_source_edits INTEGER NOT NULL DEFAULT 0,
  root_cause TEXT,
  qa_summary_json TEXT,
  provenance_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_benchmark_runs_case ON benchmark_runs(benchmark_case_id, started_at);

-- Run rows complete their lifecycle transition (running -> pass/fail) but
-- are never deleted: run history is the benchmark evidence trail.
CREATE TRIGGER benchmark_runs_no_delete BEFORE DELETE ON benchmark_runs
BEGIN
  SELECT RAISE(ABORT, 'BENCHMARK_RUN_IMMUTABLE_APPEND_ONLY');
END;
