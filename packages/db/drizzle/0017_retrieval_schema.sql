-- MOO-828 (group 4c): retrieval tables and a code-aware lexical index (03 §4.6; 04 §4.2, §5.1).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- Lexical config. The default parser splits "295-505-2-i" into 295 / -505 / -2 and drops "i", and no config can
-- change how the parser splits. So prose goes through `zoning_code` (English stemming; district codes such as RM3
-- already parse as one numword and map to simple), and zoning_code_tokens adds every section / table number as one
-- unstemmed lexeme. Query with the same pair: to_tsquery('zoning_code', ...) for prose, a quoted lexeme for a
-- section (e.g. '295-505-2-i' or the prefix '295-505':*).
CREATE TEXT SEARCH CONFIGURATION zoning_code (COPY = english);--> statement-breakpoint
CREATE OR REPLACE FUNCTION zoning_code_tokens(t text) RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_to_tsvector(array_agg(DISTINCT lower(m[1]))), ''::tsvector)
  -- chapter-section (the section may be 4 digits, as in subchapters 10 and 11), then subsections of at most 3 digits
  -- or one letter; nothing word-like or a hyphen may sit on either side, so "414-286-2489" (a phone number) is not a section.
  FROM regexp_matches(coalesce(t, ''), '(?<![-\w])(\d{3}-\d{1,4}(?:-(?:\d{1,3}|[A-Za-z](?![A-Za-z])))*)(?![-\w])', 'g') AS m
$$;--> statement-breakpoint

-- Four derived chunk fields (04 §4.2), computed by the database so existing rows need no backfill and no ingest
-- change. The view reads c.*, so it is dropped and recreated around the column changes.
DROP VIEW active_code_chunks;--> statement-breakpoint
CREATE TYPE chunk_kind AS ENUM ('operative_provision', 'table_row', 'table_header', 'footnote', 'definition', 'exception', 'purpose_statement', 'procedure');--> statement-breakpoint
DROP INDEX IF EXISTS code_chunks_tsv_idx;--> statement-breakpoint
ALTER TABLE code_chunks DROP COLUMN tsv;--> statement-breakpoint
ALTER TABLE code_chunks
  ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('zoning_code'::regconfig, coalesce(heading, '') || ' ' || text) || zoning_code_tokens(coalesce(section, '') || ' ' || coalesce(heading, '') || ' ' || text)
  ) STORED,
  ADD COLUMN chunk_kind chunk_kind GENERATED ALWAYS AS (
    CASE
      WHEN source_type = 'table_row' THEN 'table_row'::chunk_kind
      WHEN source_type = 'footnote' THEN 'footnote'::chunk_kind
      WHEN source_type = 'definition' THEN 'definition'::chunk_kind
      WHEN heading ~* '^\s*purpose' THEN 'purpose_statement'::chunk_kind
      WHEN heading ~* 'exception|exemption' THEN 'exception'::chunk_kind
      WHEN heading ~* 'procedure|application|appeal|hearing|permit process' THEN 'procedure'::chunk_kind
      ELSE 'operative_provision'::chunk_kind
    END
  ) STORED,
  ADD COLUMN token_count integer GENERATED ALWAYS AS (ceil(char_length(text) / 4.0)::integer) STORED, -- ~4 chars per token; for budgeting, not billing
  ADD COLUMN text_hash text GENERATED ALWAYS AS (md5(text)) STORED, -- detects byte-identical re-parses; not a security hash
  ADD COLUMN source_anchors jsonb GENERATED ALWAYS AS (
    CASE WHEN source_type = 'table_row' AND table_json ? 'sources' THEN jsonb_path_query_array(table_json, '$.sources[*]')
         -- built from text: jsonb_build_object is STABLE and a generated column must be IMMUTABLE
         ELSE ('[{"page": ' || page_start::text || ', "page_end": ' || coalesce(page_end, page_start)::text || '}]')::jsonb END
  ) STORED;--> statement-breakpoint
CREATE INDEX code_chunks_tsv_idx ON code_chunks USING gin (tsv);--> statement-breakpoint
CREATE INDEX code_chunks_section_trgm_idx ON code_chunks USING gin (section gin_trgm_ops);--> statement-breakpoint
CREATE VIEW active_code_chunks AS
  SELECT c.*
  FROM code_chunks c
  JOIN source_documents d ON d.id = c.source_document_id
  WHERE c.status = 'active' AND d.status = 'active'
    AND (c.effective_start IS NULL OR c.effective_start <= current_date) AND (c.effective_end IS NULL OR c.effective_end > current_date)
    AND (d.effective_start IS NULL OR d.effective_start <= current_date) AND (d.effective_end IS NULL OR d.effective_end > current_date);--> statement-breakpoint
GRANT SELECT ON active_code_chunks TO app_role, service_role;--> statement-breakpoint

-- The chunk guard compares every non-review column; generated columns are not computed in a BEFORE trigger's NEW
-- row, so they are excluded alongside the columns that may legitimately change (0016).
CREATE OR REPLACE FUNCTION code_chunks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE frozen_cols text[] := ARRAY['status', 'reviewer_status', 'embedding', 'embedding_version_id', 'tsv', 'chunk_kind', 'token_count', 'text_hash', 'source_anchors'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'code_chunks is append-only (DELETE not allowed)' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(OLD) - frozen_cols) IS DISTINCT FROM (to_jsonb(NEW) - frozen_cols) THEN
    RAISE EXCEPTION 'code_chunks is append-only except status, reviewer_status and the embedding columns' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'pending_review' AND NEW.status IN ('active', 'withdrawn')) THEN
    RAISE EXCEPTION 'code_chunks is append-only: status may only move from pending_review to active or withdrawn (% → % refused)', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- At most one active embedding model at a time (04 §5.2: an index never mixes vector spaces).
CREATE UNIQUE INDEX embedding_versions_one_active_idx ON embedding_versions ((true)) WHERE is_active;--> statement-breakpoint

-- Retrieval runs and their evidence (03 §4.6). Tenant-scoped like feasibility_runs; org_id is null only for
-- offline evaluation runs written by the service role, which the RLS policy keeps invisible to tenants.
CREATE TABLE retrieval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feasibility_run_id uuid REFERENCES feasibility_runs(id),
  org_id uuid REFERENCES organizations(id),
  subquestion text NOT NULL,
  category rule_category,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding_version_id uuid REFERENCES embedding_versions(id),
  reranker_model text,
  planner_version text NOT NULL,
  status run_status NOT NULL DEFAULT 'succeeded',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retrieval_runs_tenant_or_offline CHECK (org_id IS NOT NULL OR feasibility_run_id IS NULL)
);--> statement-breakpoint
CREATE INDEX retrieval_runs_feasibility_idx ON retrieval_runs (feasibility_run_id);--> statement-breakpoint
CREATE INDEX retrieval_runs_org_idx ON retrieval_runs (org_id, created_at);--> statement-breakpoint
CREATE TABLE retrieval_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retrieval_run_id uuid NOT NULL REFERENCES retrieval_runs(id),
  org_id uuid REFERENCES organizations(id),
  code_chunk_id uuid NOT NULL REFERENCES code_chunks(id),
  rank integer NOT NULL,
  lexical_score numeric,
  semantic_score numeric,
  rerank_score numeric,
  relevance_score numeric,
  selection_reason text NOT NULL,
  required_context_type text,
  required_context_found boolean NOT NULL DEFAULT true,
  anchors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retrieval_evidence_run_rank_unique UNIQUE (retrieval_run_id, rank)
);--> statement-breakpoint
CREATE INDEX retrieval_evidence_run_idx ON retrieval_evidence (retrieval_run_id);--> statement-breakpoint
ALTER TABLE retrieval_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON retrieval_runs USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
ALTER TABLE retrieval_evidence ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON retrieval_evidence USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());--> statement-breakpoint
CREATE TRIGGER retrieval_runs_append_only BEFORE UPDATE OR DELETE ON retrieval_runs FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON retrieval_runs FROM app_role, service_role;--> statement-breakpoint
CREATE TRIGGER retrieval_evidence_append_only BEFORE UPDATE OR DELETE ON retrieval_evidence FOR EACH ROW EXECUTE FUNCTION append_only();--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON retrieval_evidence FROM app_role, service_role;
