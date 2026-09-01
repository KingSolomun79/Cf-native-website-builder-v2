-- V2 Build Deployments (issue #12, PRD sections 22, 25, 32).
--
-- A Deployment is a runnable instance of one exact Build Version. Preview
-- deploys the exact preflight-passing candidate without regeneration; the
-- artifact manifest hash pins the deployed bytes to the immutable version.
-- (Published/Rollback roles land with issue #15's approval/publication work.)

CREATE TABLE build_deployments (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  role TEXT NOT NULL CHECK (role IN ('preview', 'published', 'rollback')),
  worker_name TEXT NOT NULL,
  preview_url TEXT NOT NULL,
  artifact_manifest_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (build_version_id, role)
);

CREATE INDEX idx_build_deployments_build ON build_deployments(build_id, role, created_at);
