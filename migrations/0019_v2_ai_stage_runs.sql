-- V2 AI stage provenance (issue #6, PRD sections 19-21).
--
-- One append-only row per attempt of every schema-validated AI stage run:
-- prompt id/version/domain-contract version, model, provider, schema
-- version, attempt, outcome, token usage/cost and the immutable R2 artifact
-- key of the accepted output.

CREATE TABLE ai_stage_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  stage TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  prompt_domain_contract_version TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT,
  schema_version TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('valid', 'repaired', 'invalid')),
  token_usage_json TEXT,
  estimated_cost_usd REAL,
  input_artifact_ids_json TEXT,
  artifact_r2_key TEXT,
  error_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_ai_stage_runs_build ON ai_stage_runs(build_id, stage, created_at);
CREATE INDEX idx_ai_stage_runs_run ON ai_stage_runs(run_id);

CREATE TRIGGER ai_stage_runs_no_update BEFORE UPDATE ON ai_stage_runs
BEGIN
  SELECT RAISE(ABORT, 'AI_STAGE_RUN_IMMUTABLE');
END;

CREATE TRIGGER ai_stage_runs_no_delete BEFORE DELETE ON ai_stage_runs
BEGIN
  SELECT RAISE(ABORT, 'AI_STAGE_RUN_IMMUTABLE');
END;
