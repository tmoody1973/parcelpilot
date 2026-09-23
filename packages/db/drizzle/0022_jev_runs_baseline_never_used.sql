-- MOO-844: the structured-output baseline (comparator 2) is an evaluation comparator and never serves users (05 §4.2), so
-- the table refuses a baseline row that claims policy use, whatever its decision mode.
ALTER TABLE jev_runs ADD CONSTRAINT jev_runs_baseline_never_used CHECK (provider <> 'baseline' OR NOT used_by_policy);
