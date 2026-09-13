-- Client intake + admin review layer (operator GO 2026-09-12).
--
-- Three deliberate additions AROUND the canonical V2 lifecycle — none of them
-- touch generation semantics:
--
-- 1. client_intake_drafts: the MUTABLE pre-canonical draft created by the
--    PUBLIC intake form. A draft is deliberately NOT the immutable Onboarding
--    Submission: the admin edits it, chooses the Build Mode, and only the
--    explicit Validate & Generate action constructs the canonical immutable
--    payload and starts the pipeline. The converted_* columns are the
--    idempotency + provenance link to canonical rows (set once; never edited).
-- 2. admin_site_notes: operator revision notes ("chat") for one Site. Notes
--    never start a Build individually — they are combined into ONE bounded
--    Revision Request by the explicit Generate Revision action.
-- 3. admin_notifications: idempotent admin-notification ledger. One row per
--    logical event (dedupe_key UNIQUE) so workflow-step retries and repeated
--    sweeps can never send duplicate emails; the existing cron performs the
--    bounded retry sweep. Email failure never rolls back the triggering write.
-- 4. public_intake_rate_limits: fixed-window counter keyed by a HASHED remote
--    address (SHA-256 with the platform secret as salt) — no raw IP is ever
--    persisted.

CREATE TABLE client_intake_drafts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'IN_REVIEW', 'GENERATION_STARTED')),
  payload_json TEXT NOT NULL,
  business_name TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  admin_notes TEXT,
  converted_site_id TEXT,
  converted_site_generation_id TEXT,
  converted_onboarding_submission_id TEXT,
  converted_build_mode TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_client_intake_drafts_status ON client_intake_drafts (status, updated_at);

CREATE TABLE admin_site_notes (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site_identities(id),
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INCLUDED')),
  included_in_revision_request_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_admin_site_notes_site ON admin_site_notes (site_id, created_at);

CREATE TABLE admin_notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'PERMANENT_FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  next_attempt_after TEXT
);
CREATE INDEX idx_admin_notifications_pending ON admin_notifications (status, next_attempt_after);

CREATE TABLE public_intake_rate_limits (
  hashed_ip TEXT NOT NULL,
  window_hour TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hashed_ip, window_hour)
);
