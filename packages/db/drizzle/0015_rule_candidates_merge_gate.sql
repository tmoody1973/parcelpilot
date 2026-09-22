-- MOO-819: no rule candidate may be generated from a table family until a reviewer has approved the merge
-- (04 §10; issue AC 6). Enforced here so every writer (TS routes, Python extraction) meets the same gate.
CREATE OR REPLACE FUNCTION rule_candidates_merge_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE merge_status text;
BEGIN
  IF NEW.source_table_id IS NULL THEN RETURN NEW; END IF;
  SELECT merge_review_status::text INTO merge_status FROM source_tables WHERE id = NEW.source_table_id;
  IF merge_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'merge_unreviewed: table family % has merge_review_status %, a rule candidate needs approved', NEW.source_table_id, merge_status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER rule_candidates_merge_gate BEFORE INSERT ON rule_candidates FOR EACH ROW EXECUTE FUNCTION rule_candidates_merge_gate();
