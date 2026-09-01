-- V2 bounded Automated Repair ledger (issue #14, PRD sections 2.5, 30-31).
--
-- Repair automation is bounded at the storage level: at most ONE main Fix
-- Coordinator batch and ONE narrow Release Blocker Fix per Build
-- (UNIQUE (build_id, kind)). Every material applied repair records the new
-- immutable Build Version it produced; blueprint-root escalations are
-- recorded as outcomes, never as silent redesign.

CREATE TABLE repair_batches (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  source_build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  kind TEXT NOT NULL CHECK (kind IN ('fix_coordinator', 'release_blocker_fix')),
  plan_json TEXT NOT NULL,
  created_build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  created_at TEXT NOT NULL,
  UNIQUE (build_id, kind)
);

CREATE INDEX idx_repair_batches_build ON repair_batches(build_id, created_at);

CREATE TRIGGER repair_batches_no_update BEFORE UPDATE ON repair_batches
BEGIN
  SELECT RAISE(ABORT, 'REPAIR_BATCH_IMMUTABLE');
END;

CREATE TRIGGER repair_batches_no_delete BEFORE DELETE ON repair_batches
BEGIN
  SELECT RAISE(ABORT, 'REPAIR_BATCH_IMMUTABLE');
END;
