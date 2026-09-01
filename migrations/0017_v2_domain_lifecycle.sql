-- V2 domain lifecycle backbone (issue #4, PRD Phase 1).
--
-- Canonical identity chain (CONTEXT.md):
--   businesses -> site_identities -> site_generations -> builds -> build_versions
--
-- Naming: `site_identities` avoids colliding with the V1 `sites` table, which is
-- dropped by the Phase 11 contract migration. All other table names are the
-- canonical V2 domain terms.
--
-- Immutability rules enforced at the storage boundary:
--   - Onboarding Submissions are never rewritten or deleted (triggers).
--   - Build Versions are never rewritten or deleted (triggers).
--   - Each Site Generation binds exactly one Onboarding Submission (UNIQUE).
--   - Each Build Version number is unique inside its Build (UNIQUE).
--   - Exactly one initial Build per Site Generation (partial UNIQUE index).

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_identities (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE onboarding_submissions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  site_id TEXT NOT NULL REFERENCES site_identities(id),
  build_mode TEXT NOT NULL CHECK (build_mode IN ('REFERENCE_BOUND','ORIGINAL_DESIGN')),
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  fact_snapshot_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE INDEX idx_onboarding_submissions_site
  ON onboarding_submissions(site_id, submitted_at);

CREATE TABLE site_generations (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site_identities(id),
  onboarding_submission_id TEXT NOT NULL UNIQUE REFERENCES onboarding_submissions(id),
  build_mode TEXT NOT NULL CHECK (build_mode IN ('REFERENCE_BOUND','ORIGINAL_DESIGN')),
  sequence_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (site_id, sequence_number)
);

CREATE INDEX idx_site_generations_site
  ON site_generations(site_id, sequence_number);

-- Canonical workflow states (PRD section 23). BLUEPRINT_REVIEW_REQUIRED is an
-- escalation signal carried in event detail, not a state.
CREATE TABLE builds (
  id TEXT PRIMARY KEY,
  site_generation_id TEXT NOT NULL REFERENCES site_generations(id),
  kind TEXT NOT NULL CHECK (kind IN ('initial','revision')),
  parent_build_id TEXT REFERENCES builds(id),
  state TEXT NOT NULL DEFAULT 'INTAKE_READY' CHECK (state IN (
    'INTAKE_READY',
    'REFERENCE_CHECK',
    'REFERENCE_EVIDENCE',
    'REFERENCE_ANALYSIS',
    'BLUEPRINT',
    'IMPLEMENTATION_PLAN',
    'SITE_GENERATION',
    'SITE_VALIDATION',
    'IMAGE_WAVE_1',
    'IMAGE_WAVE_2',
    'ASSET_PERSISTENCE',
    'ASSEMBLY',
    'TECHNICAL_PREFLIGHT',
    'PREVIEW',
    'QA_EVIDENCE',
    'QA',
    'FIX',
    'CONFIRMATION',
    'RELEASE_BLOCKER_FIX',
    'RELEASE_READY',
    'APPROVED',
    'PUBLISHING',
    'PUBLISHED',
    'DEGRADED',
    'FAILED',
    'HUMAN_REVIEW_REQUIRED'
  )),
  workflow_instance_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_builds_generation ON builds(site_generation_id);

CREATE UNIQUE INDEX idx_builds_one_initial_per_generation
  ON builds(site_generation_id) WHERE kind = 'initial';

CREATE TABLE build_versions (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  version_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (build_id, version_number)
);

CREATE TABLE build_workflow_events (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL REFERENCES builds(id),
  build_version_id TEXT REFERENCES build_versions(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  stage TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_build_workflow_events_build
  ON build_workflow_events(build_id, created_at);

CREATE TRIGGER onboarding_submissions_no_update BEFORE UPDATE ON onboarding_submissions
BEGIN
  SELECT RAISE(ABORT, 'ONBOARDING_SUBMISSION_IMMUTABLE');
END;

CREATE TRIGGER onboarding_submissions_no_delete BEFORE DELETE ON onboarding_submissions
BEGIN
  SELECT RAISE(ABORT, 'ONBOARDING_SUBMISSION_IMMUTABLE');
END;

CREATE TRIGGER build_versions_no_update BEFORE UPDATE ON build_versions
BEGIN
  SELECT RAISE(ABORT, 'BUILD_VERSION_IMMUTABLE');
END;

CREATE TRIGGER build_versions_no_delete BEFORE DELETE ON build_versions
BEGIN
  SELECT RAISE(ABORT, 'BUILD_VERSION_IMMUTABLE');
END;
