-- Production deployment tracking
-- Links site_versions to GitHub commits and production Worker state

ALTER TABLE site_versions ADD COLUMN github_commit_sha TEXT;
ALTER TABLE site_versions ADD COLUMN github_ref TEXT;
ALTER TABLE site_versions ADD COLUMN production_worker_name TEXT;
ALTER TABLE site_versions ADD COLUMN production_url TEXT;
ALTER TABLE site_versions ADD COLUMN production_deployed_at TEXT;
ALTER TABLE site_versions ADD COLUMN production_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (production_status IN ('pending','deploying','deployed','failed'));

-- Deployments log for audit trail
CREATE TABLE deployments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  environment TEXT NOT NULL CHECK (environment IN ('preview','production')),
  worker_name TEXT,
  url TEXT,
  trigger_source TEXT NOT NULL CHECK (trigger_source IN ('workflow','github_actions','manual')),
  status TEXT NOT NULL CHECK (status IN ('in_progress','success','failed','rolled_back')),
  github_run_id TEXT,
  github_run_url TEXT,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_deployments_site ON deployments(site_id, started_at DESC);
CREATE INDEX idx_deployments_version ON deployments(site_version_id);
CREATE INDEX idx_versions_production_status ON site_versions(production_status);
