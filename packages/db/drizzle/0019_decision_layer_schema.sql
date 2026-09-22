-- MOO-834 (group 5): where every M5 model call and check is written down (05 §4.8, §7, §8), and the versioned
-- decision policy a run names (05 §4.1, §4.6). All log tables are tenant-scoped under RLS and append-only.
CREATE TYPE model_provider AS ENUM ('jev', 'baseline');--> statement-breakpoint
CREATE TYPE model_call_status AS ENUM ('ok', 'failed');--> statement-breakpoint
CREATE TYPE briefing_outcome AS ENUM ('validated', 'fallback');--> statement-breakpoint
CREATE TYPE validation_result AS ENUM ('pass', 'fail', 'skipped');--> statement-breakpoint
CREATE TYPE validation_effect AS ENUM ('none', 'sentence_removed', 'action_removed', 'brief_failed');--> statement-breakpoint
CREATE TYPE validator_name AS ENUM ('schema', 'contract_hash', 'status_lock', 'citation_membership', 'uncited_claim', 'numeric_alignment', 'action_allowlist', 'banned_phrases', 'finding_coverage', 'abstention', 'unknown_as_pass', 'citation_support');--> statement-breakpoint

-- The policy is product-wide, not tenant data: readable by every role, never edited. A new policy is a new row, and
-- the repo copy (DECISION_POLICY_V1 in packages/contracts) is the authority; a test fails if this seed drifts from it.
CREATE TABLE decision_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^decision_policy\.v\d+$'),
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_policy_versions_config_version CHECK (config->>'version' = version)
);--> statement-breakpoint
CREATE TRIGGER decision_policy_versions_append_only BEFORE UPDATE OR DELETE ON decision_policy_versions FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON decision_policy_versions FROM app_role;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON decision_policy_versions FROM service_role;--> statement-breakpoint
INSERT INTO decision_policy_versions (version, config) VALUES ('decision_policy.v1', '{
  "version": "decision_policy.v1",
  "thresholds": { "route_confidence_min": 0.7, "manual_review_true_at": 0.35, "summary_safe_false_below": 0.65, "risk_medium_at": 0.5, "risk_high_at": 1.5, "jev_timeout_ms": 2000 },
  "decision_table": [
    { "status": "insufficient_evidence", "if_fired": "O1", "risk": null, "route": "insufficient_evidence" },
    { "status": "insufficient_evidence", "risk": null, "route": "collect_missing_information" },
    { "status": "revise_scenario", "risk": "high", "route": "revise_scenario" },
    { "status": "verify_before_committing", "if_special": true, "risk": "high", "route": "contact_city" },
    { "status": "verify_before_committing", "if_fired": "O2", "risk": "medium", "route": "collect_missing_information" },
    { "status": "verify_before_committing", "risk": "medium", "route": "engage_zoning_professional" },
    { "status": "proceed_to_concept_design", "risk": "low", "route": "proceed_to_concept_design" }
  ],
  "allowed_next_actions": {
    "by_status": {
      "proceed_to_concept_design": ["proceed_to_concept_design"],
      "revise_scenario": ["revise_scenario", "engage_zoning_professional"],
      "verify_before_committing": ["engage_zoning_professional", "request_early_city_zoning_review"],
      "insufficient_evidence": ["collect_missing_information", "contact_city"]
    },
    "by_trigger_kind": {
      "overlay": ["contact_city"], "special_district": ["contact_city"], "planned_development": ["contact_city"],
      "floodplain": ["contact_city"], "gis_ambiguity": ["contact_city"], "stacked_condo": ["collect_missing_information"]
    },
    "by_category_needing_verification": { "parking": ["confirm_parking_configuration"] },
    "when_missing_inputs": ["collect_missing_information"]
  }
}'::jsonb);--> statement-breakpoint

-- A run names its policy, and a gold-case run carries the expert label it is scored against (copied from
-- packages/contracts/gold/<id>.json at run time, version pinned). Existing runs predate both and stay null.
ALTER TABLE feasibility_runs
  ADD COLUMN decision_policy_version_id uuid REFERENCES decision_policy_versions(id),
  ADD COLUMN gold_case_id text,
  ADD COLUMN gold_case_version integer,
  ADD COLUMN gold_expected_status final_status,
  ADD COLUMN gold_expected_route jev_route,
  ADD CONSTRAINT feasibility_runs_gold_label_complete CHECK (
    (gold_case_id IS NULL AND gold_case_version IS NULL AND gold_expected_status IS NULL AND gold_expected_route IS NULL)
    OR (gold_case_id IS NOT NULL AND gold_case_version IS NOT NULL AND gold_expected_status IS NOT NULL AND gold_expected_route IS NOT NULL));--> statement-breakpoint

-- One row per JEV (or baseline) call. A failed call is still a row: that is what the fallback rate is measured from.
CREATE TABLE jev_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feasibility_run_id uuid NOT NULL REFERENCES feasibility_runs(id),
  provider model_provider NOT NULL,
  decision_mode decision_mode NOT NULL,
  input_state jsonb NOT NULL,
  input_state_hash text NOT NULL CHECK (input_state_hash ~ '^[0-9a-f]{64}$'),
  question_set_version text NOT NULL,
  model_version text, -- verbatim from the provider; null only when the call never got an answer
  raw_response jsonb,
  answers jsonb,
  recommended_route jev_route,
  route_confidence numeric CHECK (route_confidence BETWEEN 0 AND 1),
  status model_call_status NOT NULL,
  error text,
  latency_ms integer CHECK (latency_ms >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cost_estimate_usd numeric CHECK (cost_estimate_usd >= 0),
  used_by_policy boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jev_runs_ok_has_answers CHECK (status <> 'ok' OR (answers IS NOT NULL AND recommended_route IS NOT NULL AND model_version IS NOT NULL)),
  CONSTRAINT jev_runs_failed_has_error CHECK (status <> 'failed' OR (error IS NOT NULL AND NOT used_by_policy)),
  CONSTRAINT jev_runs_shadow_never_used CHECK (decision_mode <> 'shadow' OR NOT used_by_policy)
);--> statement-breakpoint
CREATE INDEX jev_runs_feasibility_idx ON jev_runs (feasibility_run_id, provider, created_at);--> statement-breakpoint

CREATE TABLE briefing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feasibility_run_id uuid NOT NULL REFERENCES feasibility_runs(id),
  contract jsonb NOT NULL,
  contract_hash text NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  prompt_version text NOT NULL,
  schema_version text NOT NULL,
  model_version text,
  raw_output text,
  validated_output jsonb,
  outcome briefing_outcome NOT NULL,
  error text,
  latency_ms integer CHECK (latency_ms >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  cost_estimate_usd numeric CHECK (cost_estimate_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT briefing_runs_validated_has_output CHECK (outcome <> 'validated' OR (validated_output IS NOT NULL AND model_version IS NOT NULL))
);--> statement-breakpoint
CREATE INDEX briefing_runs_feasibility_idx ON briefing_runs (feasibility_run_id, created_at);--> statement-breakpoint

-- One row per validator per brief (05 §7), including skipped ones, so "never ran" and "passed" are distinguishable.
CREATE TABLE validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  briefing_run_id uuid NOT NULL REFERENCES briefing_runs(id),
  validator validator_name NOT NULL,
  result validation_result NOT NULL,
  effect validation_effect NOT NULL DEFAULT 'none',
  removed_sentence_ids text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_runs_one_per_validator UNIQUE (briefing_run_id, validator),
  CONSTRAINT validation_runs_pass_has_no_effect CHECK (result <> 'pass' OR effect = 'none')
);--> statement-breakpoint

ALTER TABLE jev_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON jev_runs USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE briefing_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON briefing_runs USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE validation_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON validation_runs USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
CREATE TRIGGER jev_runs_append_only BEFORE UPDATE OR DELETE ON jev_runs FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON jev_runs FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER briefing_runs_append_only BEFORE UPDATE OR DELETE ON briefing_runs FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON briefing_runs FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER validation_runs_append_only BEFORE UPDATE OR DELETE ON validation_runs FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON validation_runs FROM app_role, service_role;--> statement-breakpoint

-- Shadow comparison per run (05 §4.8): the rules-only route (what policy used while in shadow) next to the latest JEV
-- and baseline answers and the expert label. security_invoker makes the caller's RLS apply, so a tenant sees only its
-- own runs. Unsafe-permissive (06 §M6, 05 §9): JEV says proceed where the rules or the expert require review or more
-- evidence; it must be zero on the gold set.
CREATE VIEW decision_comparisons WITH (security_invoker = true) AS
  SELECT r.id AS feasibility_run_id, r.org_id, r.created_at, r.decision_mode, r.decision_policy_version_id,
    r.final_status, r.route AS rules_only_route,
    j.id AS jev_run_id, j.status AS jev_status, j.recommended_route AS jev_route, j.route_confidence AS jev_confidence,
    b.id AS baseline_run_id, b.recommended_route AS baseline_route,
    r.gold_case_id, r.gold_case_version, r.gold_expected_status, r.gold_expected_route AS expert_route,
    j.recommended_route = r.route AS jev_agrees_rules_only,
    j.recommended_route = r.gold_expected_route AS jev_agrees_expert,
    coalesce(j.recommended_route = 'proceed_to_concept_design'
      AND (r.route <> 'proceed_to_concept_design' OR coalesce(r.gold_expected_route <> 'proceed_to_concept_design', false)), false) AS jev_unsafe_permissive
  FROM feasibility_runs r
  LEFT JOIN LATERAL (SELECT * FROM jev_runs x WHERE x.feasibility_run_id = r.id AND x.provider = 'jev' ORDER BY x.created_at DESC LIMIT 1) j ON true
  LEFT JOIN LATERAL (SELECT * FROM jev_runs x WHERE x.feasibility_run_id = r.id AND x.provider = 'baseline' ORDER BY x.created_at DESC LIMIT 1) b ON true
  WHERE j.id IS NOT NULL OR b.id IS NOT NULL;--> statement-breakpoint
GRANT SELECT ON decision_comparisons TO app_role, service_role;
