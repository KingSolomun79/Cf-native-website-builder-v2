-- V2 Revision Request + Fact Update lifecycle (issue #5, PRD 2.3).
--
-- A Revision Request preserves Reference and Build Mode and starts a new
-- Build (kind 'revision') derived from a parent Build. Fact Updates are
-- carried by that new Build and supersede individual Business Facts for its
-- lineage without mutating the historical Onboarding Submission or any
-- earlier Build. Both tables are append-only history.

CREATE TABLE revision_requests (
  id TEXT PRIMARY KEY,
  site_generation_id TEXT NOT NULL REFERENCES site_generations(id),
  parent_build_id TEXT NOT NULL REFERENCES builds(id),
  build_id TEXT NOT NULL UNIQUE REFERENCES builds(id),
  request_note TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_revision_requests_generation
  ON revision_requests(site_generation_id, created_at);

CREATE TABLE fact_updates (
  id TEXT PRIMARY KEY,
  site_generation_id TEXT NOT NULL REFERENCES site_generations(id),
  build_id TEXT NOT NULL REFERENCES builds(id),
  field TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (build_id, field)
);

CREATE INDEX idx_fact_updates_generation
  ON fact_updates(site_generation_id, created_at);

CREATE TRIGGER revision_requests_no_update BEFORE UPDATE ON revision_requests
BEGIN
  SELECT RAISE(ABORT, 'REVISION_REQUEST_IMMUTABLE');
END;

CREATE TRIGGER revision_requests_no_delete BEFORE DELETE ON revision_requests
BEGIN
  SELECT RAISE(ABORT, 'REVISION_REQUEST_IMMUTABLE');
END;

CREATE TRIGGER fact_updates_no_update BEFORE UPDATE ON fact_updates
BEGIN
  SELECT RAISE(ABORT, 'FACT_UPDATE_IMMUTABLE');
END;

CREATE TRIGGER fact_updates_no_delete BEFORE DELETE ON fact_updates
BEGIN
  SELECT RAISE(ABORT, 'FACT_UPDATE_IMMUTABLE');
END;
