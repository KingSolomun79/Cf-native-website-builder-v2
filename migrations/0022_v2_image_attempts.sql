-- V2 Image Slot / Image Attempt / Accepted Image ledger (issue #10, PRD 17-18).
--
-- Append-only attempt rows carry the cost ledger enforcing the hard USD 3.00
-- completed-site KIE spend gate. Accepted Images pin the exact attempt chosen
-- per slot for one exact Build Version and point at project-controlled R2
-- storage; temporary provider URLs live only in the audit column and never
-- ship.

CREATE TABLE image_attempts (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  slot_id TEXT NOT NULL,
  wave INTEGER NOT NULL CHECK (wave IN (1, 2)),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'rejected_budget')),
  provider_task_id TEXT,
  provider_url TEXT,
  r2_key TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  checksum TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (build_version_id, slot_id, attempt_number)
);

CREATE INDEX idx_image_attempts_build ON image_attempts(build_id, created_at);

CREATE TABLE accepted_images (
  build_version_id TEXT NOT NULL REFERENCES build_versions(id),
  slot_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES image_attempts(id),
  r2_key TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  PRIMARY KEY (build_version_id, slot_id)
);

CREATE TRIGGER accepted_images_no_update BEFORE UPDATE ON accepted_images
BEGIN
  SELECT RAISE(ABORT, 'ACCEPTED_IMAGE_IMMUTABLE');
END;

CREATE TRIGGER accepted_images_no_delete BEFORE DELETE ON accepted_images
BEGIN
  SELECT RAISE(ABORT, 'ACCEPTED_IMAGE_IMMUTABLE');
END;
