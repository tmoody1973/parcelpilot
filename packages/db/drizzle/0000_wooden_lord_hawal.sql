CREATE TYPE "public"."org_role" AS ENUM('owner', 'admin', 'member', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."retrieval_method" AS ENUM('browser_download', 'manual_upload', 'api_fetch');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('unreviewed', 'in_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending_review', 'active', 'superseded', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('ordinance_subchapter', 'ordinance_table_of_contents', 'zoning_map', 'amendment', 'staff_guidance', 'special_district_record', 'comprehensive_plan', 'procedure_form', 'gis_layer_snapshot');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before_hash" text,
	"after_hash" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"plan" text DEFAULT 'pilot' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"title" text NOT NULL,
	"official_url" text,
	"official_url_verified" boolean DEFAULT false NOT NULL,
	"local_path" text,
	"object_key" text,
	"sha256" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"retrieval_method" "retrieval_method" NOT NULL,
	"published_marker" text,
	"effective_start" date,
	"effective_end" date,
	"page_count" integer,
	"status" "source_status" DEFAULT 'pending_review' NOT NULL,
	"review_status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"auth_provider_id" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_idx" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_sha256_idx" ON "source_documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "source_documents_jurisdiction_status_idx" ON "source_documents" USING btree ("jurisdiction_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");