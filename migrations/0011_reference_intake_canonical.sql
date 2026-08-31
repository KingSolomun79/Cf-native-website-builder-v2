-- Phase 16.R2: canonical, immutable, retry-safe reference intake contract.
-- Additive only; does not edit migrations 0006/0007.
--
-- Canonical public contract names:
--   reference_site_url             (was: inspiration_url, kept as documented alias)
--   reference_homepage_screenshot  (staged upload id; lineage lives in reference_assets)
--
-- Uniqueness is (job_id, site_version, kind) per Issue #17. The checksum is NOT
-- globally unique: two different clients/jobs may legitimately submit the same
-- bytes, so checksum is used only to decide identical-vs-different retry.

-- 1. Canonical URL column on clients (inspiration_url retained as compat alias).
ALTER TABLE clients ADD COLUMN reference_site_url TEXT;

-- Backfill canonical column from the legacy alias so existing rows carry lineage.
UPDATE clients SET reference_site_url = inspiration_url WHERE reference_site_url IS NULL;

-- 2. Staging upload linkage on reference_assets for retry identity / observability.
ALTER TABLE reference_assets ADD COLUMN upload_id TEXT;

-- 3. Replace the stricter legacy (job_id, kind) index with canonical lineage
--    uniqueness. The legacy index already prevents duplicate rows for the new
--    grouping, so no accepted evidence is deleted during migration.
DROP INDEX IF EXISTS idx_reference_assets_job_kind;
CREATE UNIQUE INDEX idx_reference_assets_job_version_kind
  ON reference_assets(job_id, site_version, kind);
