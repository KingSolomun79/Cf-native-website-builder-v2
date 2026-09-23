-- Rejected intake attempts (incident remediation, operator-approved plan
-- 2026-09-23): public intake submissions rejected by the rate limiter, schema
-- validation or Turnstile previously left ZERO durable trace — a real client's
-- brief could be lost invisibly (observed in production). Rejected attempts
-- now persist as REJECTED client_intake_drafts rows (raw payload minus the
-- Turnstile token + rejection_reason), visible on the operator intake list.
-- They can NEVER start a Site Generation: conversion still requires the
-- explicit admin Validate & Generate action on a payload that passes the full
-- canonical validation.
--
-- Table rebuild: SQLite cannot alter a CHECK constraint. No foreign keys or
-- triggers reference client_intake_drafts (0037), so copy -> drop -> rename
-- is safe. The sequence is deliberately re-runnable: re-application copies the
-- current rows forward, and the final CREATE INDEX succeeds because the old
-- index was dropped together with the old table.
CREATE TABLE client_intake_drafts_new (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'IN_REVIEW', 'GENERATION_STARTED', 'REJECTED')),
  payload_json TEXT NOT NULL,
  business_name TEXT NOT NULL,
  submitter_name TEXT NOT NULL,
  submitter_email TEXT NOT NULL,
  rejection_reason TEXT CHECK (rejection_reason IN ('VALIDATION_FAILED', 'TURNSTILE_FAILED', 'RATE_LIMITED')),
  admin_notes TEXT,
  converted_site_id TEXT,
  converted_site_generation_id TEXT,
  converted_onboarding_submission_id TEXT,
  converted_build_mode TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO client_intake_drafts_new
  (id, status, payload_json, business_name, submitter_name, submitter_email, admin_notes,
   converted_site_id, converted_site_generation_id, converted_onboarding_submission_id, converted_build_mode,
   created_at, updated_at)
SELECT
  id, status, payload_json, business_name, submitter_name, submitter_email, admin_notes,
  converted_site_id, converted_site_generation_id, converted_onboarding_submission_id, converted_build_mode,
  created_at, updated_at
FROM client_intake_drafts;
DROP TABLE client_intake_drafts;
ALTER TABLE client_intake_drafts_new RENAME TO client_intake_drafts;
CREATE INDEX idx_client_intake_drafts_status ON client_intake_drafts (status, updated_at);
