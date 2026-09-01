-- V2 Approval / Publication / Rollback (issue #15, PRD sections 32-33).
--
-- Approval is explicit human acceptance of ONE exact Release Ready Build
-- Version (unique per version, pinned to the artifact manifest hash) and
-- never carries to another version. Publication is a separate operational
-- act deploying that exact approved version without regeneration; an
-- operational failure may be retried under the same approval while the
-- version is unchanged. Publishing a newer version retains the immediately
-- previous Published Version as Rollback Version for the configured window;
-- Rollback restores it without creating a new Build, Build Version or
-- Approval and preserves publication history.

CREATE TABLE build_approvals (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL UNIQUE REFERENCES build_versions(id),
  artifact_manifest_hash TEXT NOT NULL,
  approved_by TEXT,
  approval_note TEXT,
  approved_at TEXT NOT NULL
);

CREATE INDEX idx_build_approvals_build ON build_approvals(build_id, approved_at);

CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site_identities(id),
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  artifact_manifest_hash TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  published_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('publishing', 'published', 'failed')),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_publications_site ON publications(site_id, created_at);
CREATE INDEX idx_publications_version ON publications(build_version_id, attempt);

CREATE TABLE site_published_state (
  site_id TEXT PRIMARY KEY REFERENCES site_identities(id),
  current_publication_id TEXT NOT NULL REFERENCES publications(id),
  current_build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  rollback_publication_id TEXT REFERENCES publications(id),
  rollback_build_version_id TEXT REFERENCES build_versions(id),
  rollback_expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER build_approvals_no_update BEFORE UPDATE ON build_approvals
BEGIN
  SELECT RAISE(ABORT, 'BUILD_APPROVAL_IMMUTABLE');
END;

CREATE TRIGGER build_approvals_no_delete BEFORE DELETE ON build_approvals
BEGIN
  SELECT RAISE(ABORT, 'BUILD_APPROVAL_IMMUTABLE');
END;
