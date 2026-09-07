-- V2 candidate manifest artifact kind (issue #66).
--
-- The effective candidate lineage (which immutable page/shared-source
-- artifact composes each page of the current candidate) is stored as a
-- Build Version stage artifact so targeted repairs update ONE pointer and
-- unaffected pages keep their exact artifacts. Production Build 282f9b9d
-- showed the stale-base fallback reintroducing already-repaired defects.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt with
-- 'candidate_manifest' added to the kind enumeration; rows, immutability
-- triggers and the build index are preserved verbatim.

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

-- Uniquely-named sentinel (issue #66): the applied-migration skip heuristic
-- treats a migration as applied when every object it creates already exists.
-- This rebuild shares ALL its other object names with migration 0032, so a
-- database migrated before this file existed would falsely skip it. The
-- sentinel index exists only after THIS migration actually ran.
CREATE INDEX idx_build_stage_artifacts_candidate_manifest ON build_stage_artifacts(kind, created_at);

CREATE TRIGGER build_stage_artifacts_no_update BEFORE UPDATE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;

CREATE TRIGGER build_stage_artifacts_no_delete BEFORE DELETE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;
