-- MOO-835: the evidence a run was locked with (04 §7, 05 §5). One row per run, frozen: the briefing contract and any
-- replay read exactly these excerpts. Retrieval failure never blocks a run; it is recorded as `unavailable` and the
-- memo falls back to the templated brief.
CREATE TYPE evidence_bundle_status AS ENUM ('assembled', 'unavailable');--> statement-breakpoint
CREATE TABLE run_evidence_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feasibility_run_id uuid NOT NULL UNIQUE REFERENCES feasibility_runs(id),
  status evidence_bundle_status NOT NULL,
  retrieval_run_ids uuid[] NOT NULL DEFAULT '{}',
  token_budget integer NOT NULL CHECK (token_budget > 0),
  bundle jsonb,
  bundle_sha256 text CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_evidence_bundles_status_shape CHECK (
    (status = 'assembled' AND bundle IS NOT NULL AND bundle_sha256 IS NOT NULL AND cardinality(retrieval_run_ids) > 0 AND error IS NULL)
    OR (status = 'unavailable' AND bundle IS NULL AND bundle_sha256 IS NULL AND error IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE run_evidence_bundles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON run_evidence_bundles USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
CREATE TRIGGER run_evidence_bundles_append_only BEFORE UPDATE OR DELETE ON run_evidence_bundles FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON run_evidence_bundles FROM app_role, service_role;
