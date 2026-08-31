-- Phase 16.R3: append-only, immutable evidence attempts for responsive layout
-- and interaction capture. Legacy reference_captures / reference_interactions
-- (migrations 0008/0009) are left intact; these v2 tables become the source of
-- truth. SQLite auto-indexes from the legacy UNIQUE(job_id, viewport) table
-- constraints cannot be dropped, so we add new append-only tables instead.
--
-- Immutability rule: attempt rows, capture-evidence rows, and interaction-
-- evidence rows are append-only. Only reference_evidence_current (the pointer)
-- is mutable. Incomplete or persistence-failed attempts remain auditable but
-- never become the current usable attempt.

-- One row per evidence attempt (a single capture+interaction run for a job/site-version).
CREATE TABLE reference_evidence_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reference_evidence_attempts_job
  ON reference_evidence_attempts(job_id, site_version);

-- Append-only responsive-layout evidence, one row per attempt + viewport.
CREATE TABLE reference_capture_evidence_v2 (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  viewport TEXT NOT NULL,
  http_status INTEGER,
  status TEXT NOT NULL,
  diagnostics TEXT,
  raw_r2_key TEXT,
  screenshot_r2_key TEXT,
  capture_json_r2_key TEXT,
  checksum TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (attempt_id) REFERENCES reference_evidence_attempts(id),
  UNIQUE(attempt_id, viewport)
);

CREATE INDEX idx_reference_capture_evidence_v2_attempt
  ON reference_capture_evidence_v2(attempt_id, viewport);

CREATE INDEX idx_reference_capture_evidence_v2_job
  ON reference_capture_evidence_v2(job_id, site_version);

-- Append-only interaction evidence, one row per attempt + viewport + motion mode.
CREATE TABLE reference_interaction_evidence_v2 (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  viewport TEXT NOT NULL,
  motion_mode TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL,
  observed_count INTEGER NOT NULL DEFAULT 0,
  detected_count INTEGER NOT NULL DEFAULT 0,
  inferred_count INTEGER NOT NULL DEFAULT 0,
  reduced_motion_comparison TEXT,
  traces_r2_key TEXT,
  interactions_r2_key TEXT,
  raw_r2_key TEXT,
  checksum TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (attempt_id) REFERENCES reference_evidence_attempts(id),
  UNIQUE(attempt_id, viewport, motion_mode)
);

CREATE INDEX idx_reference_interaction_evidence_v2_attempt
  ON reference_interaction_evidence_v2(attempt_id, viewport, motion_mode);

CREATE INDEX idx_reference_interaction_evidence_v2_job
  ON reference_interaction_evidence_v2(job_id, site_version);

-- The single mutable table: the current usable evidence attempt per job/site-version.
-- Promoting a new attempt flips this pointer in one transaction; prior attempts and
-- their evidence rows remain append-only and auditable.
CREATE TABLE reference_evidence_current (
  job_id TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  attempt_id TEXT NOT NULL,
  promoted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, site_version),
  FOREIGN KEY (attempt_id) REFERENCES reference_evidence_attempts(id)
);
