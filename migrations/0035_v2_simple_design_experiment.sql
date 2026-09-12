-- Originally introduced for the SIMPLE design experiment
-- (experiment/simplified-design-pipeline). PROMOTED TO CANONICAL V2 with the
-- SIMPLE production rollout (2026-09-12): this migration is part of the
-- production schema from 2026-09-12 onward, and its artifact kinds are
-- required by the canonical SIMPLE pipeline.
--
-- Adds the SIMPLE design pipeline's three new Build Version stage artifact
-- kinds:
--   design_blueprint  — the rich implementation-ready Design Blueprint
--                       (schema design-blueprint/1)
--   site_bundle       — the Website Builder's raw semantic bundle: four pages
--                       + shared CSS/JS + asset manifest (schema site-bundle/1)
--   qa_package        — the combined visual + truth + technical QA package
--                       that feeds the ONE repair (schema qa-package/1)
--
-- The assembled/frozen candidate, evidence bundle, QA report and release
-- record reuse the EXISTING kinds (assembled_manifest, qa_evidence_bundle,
-- qa_report, release_record) — shared infrastructure stays shared.
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt with the
-- extended kind enumeration; rows, immutability triggers and indexes are
-- preserved verbatim (0032/0034 pattern).

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
    'design_blueprint', 'site_bundle', 'qa_package'
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

-- Uniquely-named sentinel: the applied-migration skip heuristic treats a
-- migration as applied when every object it creates already exists. This
-- rebuild shares ALL its other object names with migrations 0032/0034, so a
-- database migrated before this file existed would falsely skip it. This
-- index exists only after THIS migration actually ran.
CREATE INDEX idx_build_stage_artifacts_simple_design ON build_stage_artifacts(subkey, created_at);

CREATE TRIGGER build_stage_artifacts_no_update BEFORE UPDATE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;

CREATE TRIGGER build_stage_artifacts_no_delete BEFORE DELETE ON build_stage_artifacts
BEGIN
  SELECT RAISE(ABORT, 'BUILD_STAGE_ARTIFACT_IMMUTABLE');
END;
