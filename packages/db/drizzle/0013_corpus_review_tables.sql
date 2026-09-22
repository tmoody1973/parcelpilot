CREATE TYPE "public"."code_source_type" AS ENUM('ordinance_text', 'table_row', 'footnote', 'definition', 'amendment', 'map_legend');--> statement-breakpoint
CREATE TYPE "public"."review_task_type" AS ENUM('rule_candidate_review', 'merge_review', 'page_review', 'footnote_review', 'source_review', 'gis_ambiguity');--> statement-breakpoint
CREATE TABLE "code_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" text NOT NULL,
	"version" integer NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"code_family" text DEFAULT 'zoning' NOT NULL,
	"chapter" text NOT NULL,
	"subchapter" text,
	"section" text NOT NULL,
	"subsection" text,
	"heading" text,
	"source_type" "code_source_type" NOT NULL,
	"district_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"overlay_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"rule_categories" "rule_category"[] DEFAULT '{}'::rule_category[] NOT NULL,
	"source_document_id" uuid NOT NULL,
	"page_start" integer NOT NULL,
	"page_end" integer,
	"text" text NOT NULL,
	"table_json" jsonb,
	"parent_section_id" uuid,
	"preceding_chunk_id" uuid,
	"following_chunk_id" uuid,
	"cross_reference_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "source_status" DEFAULT 'pending_review' NOT NULL,
	"reviewer_status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"effective_start" date,
	"effective_end" date,
	"supersedes_id" uuid,
	"embedding" vector(1536),
	"embedding_version_id" uuid,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading, '') || ' ' || text)) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"chapter" text NOT NULL,
	"subchapter" text,
	"section" text NOT NULL,
	"subsection" text,
	"heading" text NOT NULL,
	"parent_section_id" uuid,
	"page_start" integer,
	"sort_order" integer NOT NULL,
	"confidence" text DEFAULT 'high' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"printed_page" integer,
	"raw_text" text NOT NULL,
	"char_density" numeric,
	"ocr_confidence" numeric,
	"image_ref" text,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedding_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"dimension" integer NOT NULL,
	"truncated_from" integer,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"task_type" "review_task_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"assigned_to" uuid,
	"status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"priority" "criticality",
	"reason" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" text NOT NULL,
	"family_id" text NOT NULL,
	"district_code" text NOT NULL,
	"category" "rule_category" NOT NULL,
	"proposed_rule" jsonb NOT NULL,
	"extracted_value" jsonb NOT NULL,
	"source_table_id" uuid,
	"row_key" text,
	"source_chunk_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"citation_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"extraction_method" text NOT NULL,
	"reviewer_status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_notes" text,
	"approved_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"family_key" text NOT NULL,
	"caption" text,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"canonical_rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"column_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merge_review_status" "review_status" DEFAULT 'unreviewed' NOT NULL,
	"extractor" text NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_footnotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_table_id" uuid NOT NULL,
	"fragment_id" uuid,
	"marker" text NOT NULL,
	"text" text NOT NULL,
	"applies_to_row_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_fragments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_table_id" uuid NOT NULL,
	"document_page_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"bbox" jsonb NOT NULL,
	"headers" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"extractor" text NOT NULL,
	"continuation_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citations" ADD COLUMN "document_page_id" uuid;--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_parent_section_id_code_sections_id_fk" FOREIGN KEY ("parent_section_id") REFERENCES "public"."code_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_embedding_version_id_embedding_versions_id_fk" FOREIGN KEY ("embedding_version_id") REFERENCES "public"."embedding_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_sections" ADD CONSTRAINT "code_sections_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_pages" ADD CONSTRAINT "document_pages_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_candidates" ADD CONSTRAINT "rule_candidates_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_candidates" ADD CONSTRAINT "rule_candidates_source_table_id_source_tables_id_fk" FOREIGN KEY ("source_table_id") REFERENCES "public"."source_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_candidates" ADD CONSTRAINT "rule_candidates_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_candidates" ADD CONSTRAINT "rule_candidates_approved_rule_id_zoning_rules_id_fk" FOREIGN KEY ("approved_rule_id") REFERENCES "public"."zoning_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_tables" ADD CONSTRAINT "source_tables_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_footnotes" ADD CONSTRAINT "table_footnotes_source_table_id_source_tables_id_fk" FOREIGN KEY ("source_table_id") REFERENCES "public"."source_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_footnotes" ADD CONSTRAINT "table_footnotes_fragment_id_table_fragments_id_fk" FOREIGN KEY ("fragment_id") REFERENCES "public"."table_fragments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_fragments" ADD CONSTRAINT "table_fragments_source_table_id_source_tables_id_fk" FOREIGN KEY ("source_table_id") REFERENCES "public"."source_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_fragments" ADD CONSTRAINT "table_fragments_document_page_id_document_pages_id_fk" FOREIGN KEY ("document_page_id") REFERENCES "public"."document_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_chunks_family_version_idx" ON "code_chunks" USING btree ("family_id","version");--> statement-breakpoint
CREATE INDEX "code_chunks_doc_page_idx" ON "code_chunks" USING btree ("source_document_id","page_start");--> statement-breakpoint
CREATE INDEX "code_chunks_tsv_idx" ON "code_chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "code_chunks_district_idx" ON "code_chunks" USING gin ("district_codes");--> statement-breakpoint
CREATE INDEX "code_chunks_categories_idx" ON "code_chunks" USING gin ("rule_categories");--> statement-breakpoint
CREATE INDEX "code_sections_doc_sort_idx" ON "code_sections" USING btree ("source_document_id","sort_order");--> statement-breakpoint
CREATE INDEX "code_sections_section_idx" ON "code_sections" USING btree ("source_document_id","section");--> statement-breakpoint
CREATE UNIQUE INDEX "document_pages_doc_page_idx" ON "document_pages" USING btree ("source_document_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "review_tasks_entity_idx" ON "review_tasks" USING btree ("task_type","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "review_tasks_status_idx" ON "review_tasks" USING btree ("status","task_type");--> statement-breakpoint
CREATE INDEX "rule_candidates_district_category_idx" ON "rule_candidates" USING btree ("jurisdiction_id","district_code","category");--> statement-breakpoint
CREATE INDEX "rule_candidates_status_idx" ON "rule_candidates" USING btree ("reviewer_status");--> statement-breakpoint
CREATE UNIQUE INDEX "source_tables_doc_family_idx" ON "source_tables" USING btree ("source_document_id","family_key");--> statement-breakpoint
CREATE INDEX "table_footnotes_table_idx" ON "table_footnotes" USING btree ("source_table_id");--> statement-breakpoint
CREATE INDEX "table_fragments_table_idx" ON "table_fragments" USING btree ("source_table_id","page_number");--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_document_page_id_document_pages_id_fk" FOREIGN KEY ("document_page_id") REFERENCES "public"."document_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Semantic index for M4 (cosine); null embeddings are simply absent from it.
CREATE INDEX "code_chunks_embedding_hnsw_idx" ON "code_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- The only way corpus text reaches a reviewer-as-current or retrieval: the chunk and its document are both active and in force.
CREATE VIEW active_code_chunks AS
  SELECT c.*
  FROM code_chunks c
  JOIN source_documents d ON d.id = c.source_document_id
  WHERE c.status = 'active' AND d.status = 'active'
    AND (c.effective_start IS NULL OR c.effective_start <= current_date) AND (c.effective_end IS NULL OR c.effective_end > current_date)
    AND (d.effective_start IS NULL OR d.effective_start <= current_date) AND (d.effective_end IS NULL OR d.effective_end > current_date);--> statement-breakpoint
-- Corpus rows are immutable: a code revision is a new document with new rows.
CREATE TRIGGER document_pages_append_only BEFORE UPDATE OR DELETE ON document_pages FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON document_pages FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER code_sections_append_only BEFORE UPDATE OR DELETE ON code_sections FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON code_sections FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER code_chunks_append_only BEFORE UPDATE OR DELETE ON code_chunks FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON code_chunks FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER table_fragments_append_only BEFORE UPDATE OR DELETE ON table_fragments FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON table_fragments FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER table_footnotes_append_only BEFORE UPDATE OR DELETE ON table_footnotes FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON table_footnotes FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER embedding_versions_append_only BEFORE UPDATE OR DELETE ON embedding_versions FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON embedding_versions FROM app_role, service_role;--> statement-breakpoint
-- source_tables: frozen except merge_review_status, which the reviewer queue sets once a multi-fragment family is approved.
CREATE OR REPLACE FUNCTION source_tables_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'merge_review_status') = (to_jsonb(NEW) - 'merge_review_status') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'source_tables is append-only except merge_review_status (% not allowed)', TG_OP USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER source_tables_guard BEFORE UPDATE OR DELETE ON source_tables FOR EACH ROW EXECUTE FUNCTION source_tables_guard();--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON source_tables FROM app_role, service_role;
