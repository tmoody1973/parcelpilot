-- Generic append-only guard, reusable for every immutable table (parcel_snapshots now; runs/calculations later).
CREATE OR REPLACE FUNCTION append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END $$;
CREATE TRIGGER parcel_snapshots_append_only BEFORE UPDATE OR DELETE ON parcel_snapshots FOR EACH ROW EXECUTE FUNCTION append_only();
REVOKE UPDATE, DELETE, TRUNCATE ON parcel_snapshots FROM app_role, service_role;
