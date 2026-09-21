import "server-only";
import postgres from "postgres";

// Two connection identities (docs/planning/03_data_model.md §6):
//   service — jurisdiction-shared tables (parcels, GIS); bypasses RLS.
//   app     — tenant-scoped tables (projects, scenarios); RLS applies, caller sets app.org_id.
// Pooled once per process and cached on globalThis so Next.js hot-reload does not leak sockets.

const LOCAL_SERVICE = "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot";
const LOCAL_APP = "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot";

const cache = globalThis as unknown as { __ppServiceSql?: postgres.Sql; __ppAppSql?: postgres.Sql };

export function serviceSql(): postgres.Sql {
  return (cache.__ppServiceSql ??= postgres(process.env["DATABASE_SERVICE_URL"] ?? LOCAL_SERVICE, { max: 5, prepare: false }));
}

export function appSql(): postgres.Sql {
  return (cache.__ppAppSql ??= postgres(process.env["DATABASE_APP_URL"] ?? LOCAL_APP, { max: 5, prepare: false }));
}
