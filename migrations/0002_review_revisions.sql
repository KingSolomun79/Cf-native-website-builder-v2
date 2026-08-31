-- 0002_review_revisions.sql
-- Review and revisions schema refinements
-- All core tables already exist in 0001_init.sql
-- This migration adds indexes for review workflow queries

CREATE INDEX IF NOT EXISTS idx_contact_submissions_site ON contact_submissions(site_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_prompt_runs_job ON job_prompt_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_prompts_type_active ON prompts(prompt_type, is_active, style_key);
