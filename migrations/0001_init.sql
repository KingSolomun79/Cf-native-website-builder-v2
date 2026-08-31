CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  company_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  county TEXT,
  zip_code TEXT,
  country TEXT,
  business_type TEXT,
  business_description TEXT,
  ideal_client_profile TEXT,
  logo_url TEXT,
  preferred_colour_1 TEXT,
  preferred_colour_2 TEXT,
  mode TEXT CHECK (mode IN ('light','dark')) DEFAULT 'light',
  website_overall_style TEXT NOT NULL,
  facebook_url TEXT,
  instagram_url TEXT,
  twitter_url TEXT,
  linkedin_url TEXT,
  other_social_url TEXT,
  extra_information TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  current_version_id TEXT,
  status TEXT NOT NULL,
  revisions_count INTEGER NOT NULL DEFAULT 0,
  preview_url TEXT,
  production_url TEXT,
  style_key TEXT NOT NULL,
  style_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  version_number INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('initial_build','revision')),
  source_job_id TEXT,
  build_manifest_r2_key TEXT,
  static_bundle_r2_prefix TEXT,
  deployed_worker_name TEXT,
  preview_url TEXT,
  qa_report_id TEXT,
  preview_worker_deleted_at TEXT,
  worker_status TEXT NOT NULL DEFAULT 'active' CHECK (worker_status IN ('active','scheduled_delete','deleted')),
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  job_type TEXT NOT NULL CHECK (job_type IN ('initial_build','revision','redeploy','qa_only')),
  status TEXT NOT NULL CHECK (status IN (
    'queued','running','waiting_approval','approved',
    'rejected','failed','failed_validation','needs_input',
    'timed_out','completed'
  )),
  current_step TEXT,
  error_code TEXT,
  error_message TEXT,
  job_validation_errors TEXT,
  workflow_instance_id TEXT,
  agent_session_id TEXT,
  raw_payload_r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE prompts (
  id TEXT PRIMARY KEY,
  prompt_type TEXT NOT NULL CHECK (prompt_type IN (
    'site_generation','image_generation','revision_planner','qa_reviewer'
  )),
  style_key TEXT,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE job_prompt_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  prompt_id TEXT NOT NULL REFERENCES prompts(id),
  model_provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  ai_gateway_request_id TEXT,
  input_summary TEXT,
  output_summary TEXT,
  token_in INTEGER,
  token_out INTEGER,
  cost_estimate REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE page_specs (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  page_name TEXT NOT NULL,
  slug TEXT NOT NULL,
  seo_title TEXT NOT NULL,
  meta_description TEXT NOT NULL,
  h1 TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  html_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE image_assets (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  page_name TEXT NOT NULL,
  slot_name TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  source_provider TEXT NOT NULL DEFAULT 'kie.ai',
  source_job_ref TEXT,
  r2_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed','placeholder')),
  created_at TEXT NOT NULL
);

CREATE TABLE qa_reports (
  id TEXT PRIMARY KEY,
  site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  status TEXT NOT NULL CHECK (status IN ('pass','pass_with_minor_issues','needs_revision','failed','error')),
  summary TEXT NOT NULL,
  report_json TEXT NOT NULL,
  desktop_screenshot_r2_key TEXT,
  mobile_screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE qa_issues (
  id TEXT PRIMARY KEY,
  qa_report_id TEXT NOT NULL REFERENCES qa_reports(id),
  severity TEXT NOT NULL CHECK (severity IN ('critical','major','minor')),
  category TEXT NOT NULL CHECK (category IN ('links','images','seo','overflow','social','form','accessibility','layout')),
  page_slug TEXT,
  selector TEXT,
  issue_text TEXT NOT NULL,
  screenshot_r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revise_requested','timed_out')),
  signed_token_hash TEXT,
  requested_at TEXT NOT NULL,
  responded_at TEXT,
  responder_email TEXT,
  response_note TEXT
);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  parent_site_version_id TEXT NOT NULL REFERENCES site_versions(id),
  requested_by_email TEXT,
  revision_prompt TEXT NOT NULL,
  revision_plan_json TEXT,
  revision_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','applied','failed')),
  created_at TEXT NOT NULL
);

CREATE TABLE contact_submissions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  site_version_id TEXT,
  submitted_at TEXT NOT NULL,
  page_slug TEXT NOT NULL DEFAULT '/contact',
  sender_name TEXT,
  sender_email TEXT,
  sender_phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  smtp2go_status TEXT,
  smtp2go_response_json TEXT
);

CREATE INDEX idx_jobs_site_status ON jobs(site_id, status);
CREATE INDEX idx_sites_client_id ON sites(client_id);
CREATE INDEX idx_versions_site_id ON site_versions(site_id, version_number);
CREATE INDEX idx_pages_version_slug ON page_specs(site_version_id, slug);
CREATE INDEX idx_qa_report_version ON qa_reports(site_version_id);
CREATE INDEX idx_revisions_site ON revisions(site_id, created_at);
CREATE INDEX idx_image_assets_version ON image_assets(site_version_id, status);
CREATE INDEX idx_approvals_job ON approvals(job_id, status);
