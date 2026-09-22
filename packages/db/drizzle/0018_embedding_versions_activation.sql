-- MOO-829: switching embedding models flips is_active (04 §5.2). embedding_versions stays append-only in every other
-- column: a row that produced vectors is never edited. The partial unique index from 0017 keeps one active row.
DROP TRIGGER IF EXISTS embedding_versions_append_only ON embedding_versions;--> statement-breakpoint
CREATE OR REPLACE FUNCTION embedding_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'is_active') = (to_jsonb(NEW) - 'is_active') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'embedding_versions is append-only except is_active (% not allowed)', TG_OP USING ERRCODE = '55000';
END $$;--> statement-breakpoint
CREATE TRIGGER embedding_versions_guard BEFORE UPDATE OR DELETE ON embedding_versions FOR EACH ROW EXECUTE FUNCTION embedding_versions_guard();--> statement-breakpoint
GRANT UPDATE ON embedding_versions TO service_role;
