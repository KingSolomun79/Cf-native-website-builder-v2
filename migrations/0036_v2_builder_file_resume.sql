-- EXPERIMENT BRANCH (fix/zai-coding-plan-builder). GO 2026-09-11 §20:
-- per-file Builder RESUME artifacts — each validated Builder file (site.css,
-- the four pages, site.js) freezes under its own kind BEFORE the next call
-- starts, so a workflow resume reuses immutable successes and continues at
-- the first missing file. Resume, never a second semantic attempt.
--
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt with the
-- extended kind enumeration; rows, immutability triggers and indexes are
-- preserved verbatim (0035 pattern).

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
    'candidate_manifest',
    'qa_evidence_bundle', 'qa_report', 'release_record', 'craft_preflight',
    'design_blueprint', 'site_bundle', 'qa_package',
    'builder_file/site-css', 'builder_file/page-home', 'builder_file/page-about',
    'builder_file/page-services', 'builder_file/page-contact', 'builder_file/site-js'
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
CREATE INDEX idx_build_stage_artifacts_simple_design ON build_stage_artifacts(subkey, created_at);

-- Uniquely-named sentinel: the applied-migration skip heuristic treats a
-- migration as applied when every object it creates already exists. This
-- rebuild shares ALL its other object names with migration 0035, so a
-- database migrated before this file existed would falsely skip it. This
-- index exists only after THIS migration actually ran.
CREATE INDEX idx_build_stage_artifacts_file_resume ON build_stage_artifacts(kind, created_at);

CREATE TRIGGER build_stage_artifacts_no_update BEFORE UPDATE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;

CREATE TRIGGER build_stage_artifacts_no_delete BEFORE DELETE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;
