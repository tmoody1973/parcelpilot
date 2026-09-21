CREATE TYPE "public"."criticality" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."decision_mode" AS ENUM('rules_only', 'structured_output_baseline', 'jev', 'shadow');--> statement-breakpoint
CREATE TYPE "public"."final_status" AS ENUM('proceed_to_concept_design', 'revise_scenario', 'verify_before_committing', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('pass', 'fail', 'unknown', 'verify', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."jev_route" AS ENUM('proceed_to_concept_design', 'revise_scenario', 'contact_city', 'engage_zoning_professional', 'collect_missing_information', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."rule_category" AS ENUM('use', 'height', 'setback_front', 'setback_side', 'setback_rear', 'density', 'parking', 'lot_coverage');--> statement-breakpoint
CREATE TYPE "public"."rule_kind" AS ENUM('allowed_use', 'max_height_ft', 'min_height_ft', 'min_setback_ft', 'max_setback_ft', 'min_lot_area_per_unit');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"feasibility_run_id" uuid NOT NULL,
	"rule_category" "rule_category" NOT NULL,
	"finding_status" "finding_status" NOT NULL,
	"criticality" "criticality" NOT NULL,
	"proposed_value" jsonb,
	"allowed_value" jsonb,
	"assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculation_detail" jsonb NOT NULL,
	"zoning_rule_id" uuid,
	"citation_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"confidence" text NOT NULL,
	"review_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_chunk_id" uuid,
	"source_document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"printed_page" integer,
	"section" text,
	"anchor" text,
	"excerpt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feasibility_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"parcel_snapshot_id" uuid NOT NULL,
	"gis_layer_snapshot_ids" uuid[] NOT NULL,
	"input_hash" text NOT NULL,
	"scenario_inputs" jsonb NOT NULL,
	"rule_version_set" jsonb NOT NULL,
	"decision_mode" "decision_mode" DEFAULT 'rules_only' NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"final_status" "final_status",
	"route" "jev_route",
	"policy_reasons" jsonb,
	"locked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zoning_rule_id" uuid NOT NULL,
	"citation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zoning_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" text NOT NULL,
	"version" integer NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"district_code" text NOT NULL,
	"category" "rule_category" NOT NULL,
	"kind" "rule_kind" NOT NULL,
	"params" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criticality" "criticality" NOT NULL,
	"status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"effective_start" date NOT NULL,
	"effective_end" date,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_feasibility_run_id_feasibility_runs_id_fk" FOREIGN KEY ("feasibility_run_id") REFERENCES "public"."feasibility_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculations" ADD CONSTRAINT "calculations_zoning_rule_id_zoning_rules_id_fk" FOREIGN KEY ("zoning_rule_id") REFERENCES "public"."zoning_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_runs" ADD CONSTRAINT "feasibility_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_runs" ADD CONSTRAINT "feasibility_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_runs" ADD CONSTRAINT "feasibility_runs_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_runs" ADD CONSTRAINT "feasibility_runs_parcel_snapshot_id_parcel_snapshots_id_fk" FOREIGN KEY ("parcel_snapshot_id") REFERENCES "public"."parcel_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feasibility_runs" ADD CONSTRAINT "feasibility_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_citations" ADD CONSTRAINT "rule_citations_zoning_rule_id_zoning_rules_id_fk" FOREIGN KEY ("zoning_rule_id") REFERENCES "public"."zoning_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_citations" ADD CONSTRAINT "rule_citations_citation_id_citations_id_fk" FOREIGN KEY ("citation_id") REFERENCES "public"."citations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoning_rules" ADD CONSTRAINT "zoning_rules_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zoning_rules" ADD CONSTRAINT "zoning_rules_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculations_run_idx" ON "calculations" USING btree ("feasibility_run_id");--> statement-breakpoint
CREATE INDEX "citations_document_page_idx" ON "citations" USING btree ("source_document_id","page_number");--> statement-breakpoint
CREATE INDEX "feasibility_runs_org_project_idx" ON "feasibility_runs" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "feasibility_runs_scenario_idx" ON "feasibility_runs" USING btree ("scenario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_citations_rule_citation_idx" ON "rule_citations" USING btree ("zoning_rule_id","citation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "zoning_rules_family_version_idx" ON "zoning_rules" USING btree ("family_id","version");--> statement-breakpoint
CREATE INDEX "zoning_rules_district_category_idx" ON "zoning_rules" USING btree ("jurisdiction_id","district_code","category");--> statement-breakpoint
-- Jurisdiction-shared, immutable: a new rule version or a corrected citation is a new row.
CREATE TRIGGER zoning_rules_append_only BEFORE UPDATE OR DELETE ON zoning_rules FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON zoning_rules FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER citations_append_only BEFORE UPDATE OR DELETE ON citations FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON citations FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER rule_citations_append_only BEFORE UPDATE OR DELETE ON rule_citations FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON rule_citations FROM app_role, service_role;--> statement-breakpoint
-- Tenant isolation, same shape as migration 0010.
ALTER TABLE feasibility_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON feasibility_runs
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE calculations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON calculations
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
-- A run may change until it is locked (queued → running → succeeded, final_status, locked_at set in
-- the same statement). After locked_at is set the row is frozen; deletes are never allowed.
CREATE OR REPLACE FUNCTION feasibility_runs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'feasibility_runs row is locked (% not allowed after locked_at)', TG_OP USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER feasibility_runs_guard BEFORE UPDATE OR DELETE ON feasibility_runs FOR EACH ROW EXECUTE FUNCTION feasibility_runs_guard();--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON feasibility_runs FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER calculations_append_only BEFORE UPDATE OR DELETE ON calculations FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON calculations FROM app_role, service_role;
