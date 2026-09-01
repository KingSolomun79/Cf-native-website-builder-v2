-- V2 Build stage artifacts (issue #8+, PRD sections 12-14, 22).
--
-- One immutable artifact row per (Build Version, kind, subkey): Reference
-- Analysis, Visual Blueprint, Implementation Contract, later generated
-- pages/image plans/manifests. R2 holds the bytes; this table is the index
-- with schema version, checksum and prompt/model provenance.

CREATE TABLE build_stage_artifacts (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  site_generation_id TEXT NOT NULL REFERENCES site_generations(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'reference_analysis', 'visual_blueprint', 'implementation_contract',
    'generated_page', 'generated_shared_source', 'image_plan', 'assembled_manifest',
    'qa_evidence_bundle', 'qa_report', 'release_record'
  )),
  subkey TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL,
  artifact_r2_key TEXT NOT NULL,
  provenance_json TEXT,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (build_version_id, kind, subkey)
);

CREATE INDEX idx_build_stage_artifacts_build ON build_stage_artifacts(build_id, kind, created_at);

CREATE TRIGGER build_stage_artifacts_no_update BEFORE UPDATE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;

CREATE TRIGGER build_stage_artifacts_no_delete BEFORE DELETE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;
