CREATE TABLE quality_gate_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  site_version INTEGER NOT NULL,
  attempt_number INTEGER NOT NULL,
  score INTEGER NOT NULL,
  threshold INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','failed')),
  report_r2_key TEXT NOT NULL,
  interaction_evidence_r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, site_version, attempt_number)
);

CREATE INDEX idx_quality_gate_job_version ON quality_gate_attempts(job_id, site_version);

CREATE TABLE qa_issues_quality_gate (
  id TEXT PRIMARY KEY,
  qa_report_id TEXT NOT NULL REFERENCES qa_reports(id),
  severity TEXT NOT NULL CHECK (severity IN ('critical','major','minor')),
  category TEXT NOT NULL CHECK (category IN ('links','images','seo','overflow','social','form','accessibility','layout','provenance','visual','interaction','icons')),
  page_slug TEXT,
  selector TEXT,
  issue_text TEXT NOT NULL,
  screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO qa_issues_quality_gate SELECT * FROM qa_issues;
DROP TABLE qa_issues;
ALTER TABLE qa_issues_quality_gate RENAME TO qa_issues;
CREATE INDEX idx_qa_issues_report ON qa_issues(qa_report_id);
