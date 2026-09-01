-- V2 Release QA and Release Ready records (issue #13, PRD sections 26-32).
--
-- Release Ready is the automated quality state of ONE EXACT Build Version
-- after every mandatory gate passed with zero P0/P1 Release Blockers. The
-- record pins the scores, hard gates and the exact findings categorized as
-- Release Blockers vs non-blocking polish.

CREATE TABLE build_release_records (
  build_version_id TEXT PRIMARY KEY REFERENCES build_versions(id),
  build_id TEXT NOT NULL REFERENCES builds(id),
  qa_a_visual_score INTEGER NOT NULL,
  qa_a_content_score INTEGER NOT NULL,
  qa_b_technical_score INTEGER NOT NULL,
  fabrication INTEGER NOT NULL,
  hard_gates_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL,
  polish_json TEXT NOT NULL,
  assigned_at TEXT NOT NULL
);

CREATE INDEX idx_build_release_records_build ON build_release_records(build_id, assigned_at);
