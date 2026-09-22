-- MOO-827: code_chunks stay append-only except for their review state. A chunk's status may move exactly once,
-- pending_review → active (cleared for retrieval) or pending_review → withdrawn (a reviewer refused its page; the
-- status enum has no "rejected"). reviewer_status may move with it. The embedding columns may be written so the
-- M4 embedding job (MOO-829) can fill them without a new chunk version. Every other column and every DELETE is refused.
DROP TRIGGER IF EXISTS code_chunks_append_only ON code_chunks;--> statement-breakpoint
CREATE OR REPLACE FUNCTION code_chunks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
-- tsv is excluded from the comparison because a generated column is not yet computed in a BEFORE trigger's NEW row.
DECLARE frozen_cols text[] := ARRAY['status', 'reviewer_status', 'embedding', 'embedding_version_id', 'tsv'];
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
CREATE TRIGGER code_chunks_guard BEFORE UPDATE OR DELETE ON code_chunks FOR EACH ROW EXECUTE FUNCTION code_chunks_guard();--> statement-breakpoint
GRANT UPDATE ON code_chunks TO service_role;
