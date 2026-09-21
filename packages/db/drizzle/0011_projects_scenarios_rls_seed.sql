-- Row Level Security for the group-6 tenant-scoped tables, plus the M1 bootstrap org.
-- projects and scenarios are mutable, so they get RLS only (no append-only trigger).
-- Follows the tenant_isolation pattern from 0001_rls_roles_audit.sql; app_role/service_role
-- already hold table grants via ALTER DEFAULT PRIVILEGES, so no new GRANT is needed here.

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scenarios
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- M1 bootstrap tenant. The web app has no auth provider yet (Clerk lands with MOO-807), so M1
-- runs against this single fixed org until real sign-in exists. Idempotent; safe to re-run.
-- The fixed ids let the app default its org context without a lookup.
INSERT INTO organizations (id, name, slug, plan)
  VALUES ('00000000-0000-0000-0000-0000000000d1', 'ParcelPilot Demo', 'demo', 'pilot')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, email, full_name)
  VALUES ('00000000-0000-0000-0000-0000000000d2', 'demo@parcelpilot.local', 'Demo User')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO memberships (org_id, user_id, role)
  VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'owner')
  ON CONFLICT (org_id, user_id) DO NOTHING;
