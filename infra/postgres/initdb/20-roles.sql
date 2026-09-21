-- Local-only login users. On Neon/production create equivalents by hand with real passwords.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN CREATE ROLE app_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parcelpilot_app') THEN
    CREATE ROLE parcelpilot_app LOGIN PASSWORD 'parcelpilot-app' IN ROLE app_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parcelpilot_service') THEN
    -- BYPASSRLS is a role attribute and is NOT inherited through membership, so the login user carries it itself.
    CREATE ROLE parcelpilot_service LOGIN PASSWORD 'parcelpilot-service' BYPASSRLS IN ROLE service_role;
  END IF;
END $$;
