-- V2 Reference Evidence sufficiency guard (issue #39).
--
-- Persists the deterministic evidence-sufficiency verdict frozen with the
-- Reference Evidence package: SUFFICIENT, PARTIAL (every missing blocking
-- dimension declared by the Adaptation Contract) or INSUFFICIENT (fail
-- closed). evidence_sufficiency is the SQL-visible enum mirror;
-- evidence_sufficiency_verdict_json carries the full versioned verdict
-- (missing/declared blocking dimensions + reasons). Columns are nullable
-- because packages frozen before issue #39 carry no verdict; the read path
-- evaluates those legacy rows lazily with the same versioned rules without
-- rewriting frozen evidence.

ALTER TABLE reference_evidence_packages ADD COLUMN evidence_sufficiency TEXT CHECK (evidence_sufficiency IN ('SUFFICIENT', 'PARTIAL', 'INSUFFICIENT'));
ALTER TABLE reference_evidence_packages ADD COLUMN evidence_sufficiency_verdict_json TEXT;
