-- Phase 16.R4: immutable, attempt-scoped blueprint persistence.
--
-- Replaces the Phase 16.4 path where repair attempts overwrote the same R2 keys
-- and D1 rows. Three new append-only tables + one mutable accepted pointer.
-- Legacy blueprints table (migration 0010) is left intact.
--
-- Evidence registries and blueprint attempts are append-only. Only
-- blueprint_accepted is mutable: it points (job_id, site_version) at the single
-- accepted attempt id. A failed/persistence-failed attempt remains inspectable
-- but never becomes accepted; an older attempt can never replace a newer one.

CREATE TABLE blueprint_evidence_registries (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  evidence_attempt_id TEXT,
  registry_r2_key TEXT NOT NULL,
  screenshot_evidence_r2_key TEXT,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_blueprint_evidence_registries_job
  ON blueprint_evidence_registries(job_id, site_version);

CREATE TABLE blueprint_attempts (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  client_slug TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  attempt_number INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  prompt_version TEXT,
  provider TEXT,
  model TEXT,
  design_r2_key TEXT,
  interaction_r2_key TEXT,
  validation_r2_key TEXT,
  review_r2_key TEXT,
  prompt_input_r2_key TEXT,
  overall_confidence REAL,
  status TEXT NOT NULL DEFAULT 'generated',
  failure_code TEXT,
  failure_diagnostics TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (registry_id) REFERENCES blueprint_evidence_registries(id)
);

CREATE INDEX idx_blueprint_attempts_job
  ON blueprint_attempts(job_id, site_version);

CREATE INDEX idx_blueprint_attempts_registry
  ON blueprint_attempts(registry_id);

-- The single mutable table: the accepted blueprint attempt per job/site-version.
-- Promoting a new attempt flips this pointer only if newer; prior attempts remain
-- append-only and inspectable.
CREATE TABLE blueprint_accepted (
  job_id TEXT NOT NULL,
  site_version INTEGER NOT NULL DEFAULT 1,
  accepted_attempt_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, site_version),
  FOREIGN KEY (accepted_attempt_id) REFERENCES blueprint_attempts(id)
);
