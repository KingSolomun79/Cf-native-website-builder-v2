-- V2 Reference intake / suitability / frozen evidence (issue #7, PRD 9-11).
--
-- One frozen versioned Reference Evidence package per Site Generation. The
-- package is immutable once frozen; later stages read it without re-reading
-- mutable live state. Suitability classification and the accepted Adaptation
-- Contract (when SUPPORTED_WITH_LIMITATIONS) are frozen with it.

CREATE TABLE reference_evidence_packages (
  id TEXT PRIMARY KEY,
  site_generation_id TEXT NOT NULL UNIQUE REFERENCES site_generations(id),
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  suitability TEXT NOT NULL CHECK (suitability IN ('SUPPORTED', 'SUPPORTED_WITH_LIMITATIONS', 'UNSUPPORTED')),
  suitability_reasons_json TEXT NOT NULL,
  adaptation_contract_json TEXT,
  input_mode TEXT NOT NULL CHECK (input_mode IN ('SCREENSHOT_ONLY', 'URL_ONLY', 'SCREENSHOT_AND_URL')),
  evidence_r2_key TEXT NOT NULL,
  canonical_screenshot_r2_key TEXT NOT NULL,
  checksum TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE INDEX idx_reference_evidence_build ON reference_evidence_packages(build_id);

CREATE TRIGGER reference_evidence_packages_no_update BEFORE UPDATE ON reference_evidence_packages
BEGIN
  SELECT RAISE(ABORT, 'REFERENCE_EVIDENCE_IMMUTABLE');
END;

CREATE TRIGGER reference_evidence_packages_no_delete BEFORE DELETE ON reference_evidence_packages
BEGIN
  SELECT RAISE(ABORT, 'REFERENCE_EVIDENCE_IMMUTABLE');
END;
