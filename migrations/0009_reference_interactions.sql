-- Phase 16.3: immutable reference interaction evidence (one row per job + viewport).

CREATE TABLE reference_interactions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  viewport TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_count INTEGER NOT NULL DEFAULT 0,
  inferred_count INTEGER NOT NULL DEFAULT 0,
  reduced_motion_detected INTEGER NOT NULL DEFAULT 0,
  fallback_reason TEXT,
  interactions_r2_key TEXT,
  manifest_r2_key TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, viewport)
);

CREATE INDEX idx_reference_interactions_job ON reference_interactions(job_id);
