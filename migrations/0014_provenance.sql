CREATE TABLE provenance_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  site_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  parent_artifact_id TEXT REFERENCES provenance_artifacts(id),
  r2_key TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, site_version)
);

CREATE INDEX idx_provenance_job_version ON provenance_artifacts(job_id, site_version);

CREATE TABLE qa_issues_provenance (
  id TEXT PRIMARY KEY,
  qa_report_id TEXT NOT NULL REFERENCES qa_reports(id),
  severity TEXT NOT NULL CHECK (severity IN ('critical','major','minor')),
  category TEXT NOT NULL CHECK (category IN ('links','images','seo','overflow','social','form','accessibility','layout','provenance')),
  page_slug TEXT,
  selector TEXT,
  issue_text TEXT NOT NULL,
  screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO qa_issues_provenance SELECT * FROM qa_issues;
DROP TABLE qa_issues;
ALTER TABLE qa_issues_provenance RENAME TO qa_issues;
CREATE INDEX idx_qa_issues_report ON qa_issues(qa_report_id);
