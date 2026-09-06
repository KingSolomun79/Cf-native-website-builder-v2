-- V2 Design Craft Preflight artifact kind (issue #49).
--
-- The craft preflight verdict (attempt-scoped, deterministic findings +
-- provenance-bound crop records) is stored as an immutable Build Version
-- stage artifact. SQLite cannot alter a CHECK constraint, so the table is
-- rebuilt with 'craft_preflight' added to the kind enumeration; rows,
-- immutability triggers and the build index are preserved verbatim.

DROP TRIGGER IF EXISTS build_stage_artifacts_no_update;
DROP TRIGGER IF EXISTS build_stage_artifacts_no_delete;

CREATE TABLE build_stage_artifacts_new (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  site_generation_id TEXT NOT NULL REFERENCES site_generations(id),
  kind TEXT NOT NULL CHECK (kind IN (
    'reference_analysis', 'visual_blueprint', 'implementation_contract',
    'generated_page', 'generated_shared_source', 'image_plan', 'assembled_manifest',
    'qa_evidence_bundle', 'qa_report', 'release_record', 'craft_preflight'
  )),
  subkey TEXT NOT NULL DEFAULT '',
  schema_version TEXT NOT NULL,
  artifact_r2_key TEXT NOT NULL,
  provenance_json TEXT,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (build_version_id, kind, subkey)
);

INSERT INTO build_stage_artifacts_new
  (id, build_id, build_version_id, site_generation_id, kind, subkey, schema_version, artifact_r2_key, provenance_json, checksum, created_at)
SELECT
  id, build_id, build_version_id, site_generation_id, kind, subkey, schema_version, artifact_r2_key, provenance_json, checksum, created_at
FROM build_stage_artifacts;

DROP TABLE build_stage_artifacts;
ALTER TABLE build_stage_artifacts_new RENAME TO build_stage_artifacts;

CREATE INDEX idx_build_stage_artifacts_build ON build_stage_artifacts(build_id, kind, created_at);

CREATE TRIGGER build_stage_artifacts_no_update BEFORE UPDATE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;

CREATE TRIGGER build_stage_artifacts_no_delete BEFORE DELETE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;
