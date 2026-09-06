-- Issue #54: single-flight execution claims for immutable provider-backed
-- stage generation.
--
-- Workflow attempts may retry/re-enter around failures (resource exhaustion,
-- provider timeouts, engine restarts), and production (build 91764d47,
-- 2026-09-06) showed two overlapping executions both observing "artifact
-- absent", both calling the model, and only colliding afterwards on the
-- immutable store. The claim table gives every deterministic stage request a
-- single owner for the expensive provider call, atomically.
--
-- This is MUTABLE execution-coordination state only. The immutable
-- build_stage_artifacts rows remain the source of truth for stage outputs;
-- no lock/lease state ever pollutes an immutable artifact.
-- V2 only (website_factory_v2). Never applied to website_factory_v1.

CREATE TABLE IF NOT EXISTS stage_execution_claims (
  execution_key TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  build_version_id TEXT NOT NULL,
  stage_kind TEXT NOT NULL,
  subkey TEXT NOT NULL DEFAULT '',
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')),
  owner_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  artifact_r2_key TEXT,
  artifact_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stage_execution_claims_build_version
  ON stage_execution_claims (build_version_id);
