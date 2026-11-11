-- Recovery regeneration pointer (operator-approved plan + FDR decision 137,
-- 2026-09-23): an operator may start a NEW Site Generation from an already
-- converted Intake Draft when the site's latest generation terminally failed
-- or was gated for human review (production incident 2026-09-23: three
-- HUMAN_REVIEW_REQUIRED builds left no forward path except more revision
-- notes). The draft's original converted_* provenance columns stay set-once
-- and immutable; this separate pointer tracks the generation the draft's
-- recovery currently governs (the latest recovery attempt). Plain ADD COLUMN
-- — no constraint change, so no table rebuild.
ALTER TABLE client_intake_drafts ADD COLUMN recovered_site_generation_id TEXT;
