-- Phase 16.2: immutable live reference capture evidence (one row per job + viewport).

CREATE TABLE reference_captures (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  viewport TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  final_url TEXT,
  status TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  screenshot_r2_key TEXT,
  capture_json_r2_key TEXT,
  redirects TEXT,
  limitations TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, viewport)
);

CREATE INDEX idx_reference_captures_job ON reference_captures(job_id);
