CREATE TABLE candidate_validation_runs (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
  report_r2_key TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_candidate_validation_runs_created_at ON candidate_validation_runs(created_at);
