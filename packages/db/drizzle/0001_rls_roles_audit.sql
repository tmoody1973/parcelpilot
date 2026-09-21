-- Custom migration: extensions, roles, grants, Row Level Security, append-only audit log.
-- Hand-written; registered in meta/_journal.json by drizzle-kit generate --custom.

-- Extensions (idempotent; local initdb already created them, Neon/prod need this)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- Group roles. Login users are created outside migrations (compose initdb locally; by hand in prod).
-- BYPASSRLS is a role attribute and is not inherited, so the service LOGIN user must carry it itself.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN CREATE ROLE app_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_role, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_role, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_role, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_role, service_role;

-- audit_events is append-only: trigger blocks everyone (including the owner); REVOKE removes the privilege too.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_role, service_role;
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (% not allowed)', TG_OP USING ERRCODE = '55000';
END $$;
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- Row Level Security. The app sets app.org_id per transaction; unset => NULL => zero rows.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = current_org_id()) WITH CHECK (id = current_org_id());

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- users has no org_id (global identity); visible only through a membership in the current org.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = current_org_id()));

-- jurisdictions and source_documents are jurisdiction-shared: readable by every tenant, no RLS.
