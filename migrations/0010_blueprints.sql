-- Phase 16.4: validated design + interaction blueprints (source of truth for generation).

CREATE TABLE blueprints (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  prompt_version TEXT,
  model TEXT,
  r2_key TEXT NOT NULL,
  validation_valid INTEGER NOT NULL,
  validation_errors TEXT,
  review_issues TEXT,
  confidence REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, kind)
);

CREATE INDEX idx_blueprints_job ON blueprints(job_id);
