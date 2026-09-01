-- V2 migration contraction (issue #25, PRD Phase 11; manifest section 3.1).
--
-- Final contract migration: drops every superseded V1 product table now
-- that the V2 replacements own their concerns. V1 data is not migrated
-- (preserved in the V1 repository). V2 tables (businesses, site_identities,
-- onboarding_submissions, site_generations, builds, build_versions,
-- build_workflow_events, ai_stage_runs, build_stage_artifacts,
-- reference_evidence_packages, fact_updates, revision_requests,
-- image_attempts, accepted_images, site_configurations, form_submissions,
-- email_deliveries, build_deployments, build_release_records, repair_batches,
-- publications, build_approvals, site_published_state, benchmark_cases,
-- benchmark_runs, proof_gate_evaluations) are untouched.

DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS jobs;
DROP TABLE IF EXISTS site_versions;
DROP TABLE IF EXISTS page_specs;
DROP TABLE IF EXISTS image_assets;
DROP TABLE IF EXISTS qa_reports;
DROP TABLE IF EXISTS qa_issues;
DROP TABLE IF EXISTS qa_issues_provenance;
DROP TABLE IF EXISTS qa_issues_quality_gate;
DROP TABLE IF EXISTS quality_gate_attempts;
DROP TABLE IF EXISTS revisions;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS prompts;
DROP TABLE IF EXISTS job_prompt_runs;
DROP TABLE IF EXISTS contact_submissions;
DROP TABLE IF EXISTS blueprints;
DROP TABLE IF EXISTS blueprint_attempts;
DROP TABLE IF EXISTS blueprint_accepted;
DROP TABLE IF EXISTS blueprint_evidence_registries;
DROP TABLE IF EXISTS reference_assets;
DROP TABLE IF EXISTS reference_captures;
DROP TABLE IF EXISTS reference_interactions;
DROP TABLE IF EXISTS reference_evidence_attempts;
DROP TABLE IF EXISTS reference_capture_evidence_v2;
DROP TABLE IF EXISTS reference_interaction_evidence_v2;
DROP TABLE IF EXISTS reference_evidence_current;
DROP TABLE IF EXISTS provenance_artifacts;
DROP TABLE IF EXISTS candidate_validation_runs;
