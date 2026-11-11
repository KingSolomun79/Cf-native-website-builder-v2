-- V2 benchmark run identity + retention class (issue #17, PRD sections 43-45).
--
-- benchmark_runs (migration 0028) recorded the outcome columns; the frozen
-- harness adds the identity a run must pin so a future reader can distinguish
-- "the system changed" from "the benchmark input changed": the benchmark
-- definition hash/version the run was verified against, the code revision the
-- pipeline ran on, the repair budget consumption, the accepted-image count,
-- the Reference Suitability verdict, and the bulky-evidence R2 keys that
-- belong to the 180-day benchmark evidence retention class (operator decision
-- 2026-09-16, FINAL-DECISION-RECORD). Compact run rows themselves remain
-- append-only (benchmark_runs_no_delete trigger) and are retained indefinitely.

ALTER TABLE benchmark_runs ADD COLUMN definition_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE benchmark_runs ADD COLUMN definition_version TEXT NOT NULL DEFAULT '';
ALTER TABLE benchmark_runs ADD COLUMN code_revision TEXT NOT NULL DEFAULT '';
ALTER TABLE benchmark_runs ADD COLUMN repair_consumed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs ADD COLUMN accepted_images INTEGER NOT NULL DEFAULT 0;
ALTER TABLE benchmark_runs ADD COLUMN reference_suitability TEXT;
ALTER TABLE benchmark_runs ADD COLUMN evidence_keys_json TEXT;

CREATE INDEX idx_benchmark_runs_build ON benchmark_runs(build_id);
