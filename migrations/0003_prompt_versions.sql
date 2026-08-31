-- 0003_prompt_versions.sql
-- Prompt versioning support
-- All core tables already exist in 0001_init.sql
-- This migration ensures prompts table has proper versioning constraints

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_type_style_version ON prompts(prompt_type, style_key, version);
