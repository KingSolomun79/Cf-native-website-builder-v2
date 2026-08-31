-- Phase 16.1: immutable reference homepage screenshot lineage.
-- One row per persisted reference asset, linked to the job and site version.

CREATE TABLE reference_assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'homepage_screenshot',
  r2_key TEXT NOT NULL,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  source TEXT NOT NULL,
  capture_timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_reference_assets_job ON reference_assets(job_id);
CREATE UNIQUE INDEX idx_reference_assets_job_kind ON reference_assets(job_id, kind);
