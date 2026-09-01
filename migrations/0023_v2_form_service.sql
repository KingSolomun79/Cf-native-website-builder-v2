-- V2 central WAZIBIZ Form Service (issue #11, PRD sections 34-39).
--
-- One multi-tenant form service for every generated Site. Form Destination
-- and Sender Identity are mutable Site Configuration (no Build, no Revision
-- Request, survives Rollback). A Form Submission becomes an Accepted
-- Submission only when the platform has validated it and durably committed
-- responsibility; Email Delivery happens downstream with bounded server-side
-- retry and never requires visitor resubmission.

CREATE TABLE site_configurations (
  site_id TEXT PRIMARY KEY REFERENCES site_identities(id),
  form_enabled INTEGER NOT NULL DEFAULT 1,
  form_allowed_origins_json TEXT NOT NULL DEFAULT '[]',
  form_destination TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  turnstile_required INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES site_identities(id),
  site_form_id TEXT NOT NULL,
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  visitor_message TEXT NOT NULL,
  visitor_phone TEXT,
  visitor_subject TEXT,
  source_origin TEXT NOT NULL,
  ip_hash TEXT,
  accepted_at TEXT NOT NULL
);

CREATE INDEX idx_form_submissions_site_time ON form_submissions(site_id, accepted_at);
CREATE INDEX idx_form_submissions_rate ON form_submissions(site_id, ip_hash, accepted_at);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY,
  form_submission_id TEXT NOT NULL REFERENCES form_submissions(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'transient_failure', 'permanent_failure')),
  destination TEXT NOT NULL,
  sender_identity TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  error_class TEXT,
  error_detail TEXT,
  scheduled_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (form_submission_id, attempt_number)
);

CREATE INDEX idx_email_deliveries_due ON email_deliveries(status, scheduled_retry_at);
