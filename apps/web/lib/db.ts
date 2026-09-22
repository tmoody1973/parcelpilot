import postgres from "postgres";
import { createDb, type Db } from "@parcelpilot/db";

// Lazy singletons so a missing env var never fails the build, only the first request that needs it.
//   appDb      — RLS-bound drizzle; every tenant-scoped read/write goes through `withOrg` (DATABASE_APP_URL).
//   serviceDb  — BYPASSRLS drizzle; provisions orgs/users/memberships on sign-in (DATABASE_SERVICE_URL).
//   serviceSql — BYPASSRLS postgres.js; parcel snapshots and GIS intersections (jurisdiction-shared tables only).
//   appSql     — RLS-bound plain postgres.js for code that speaks raw SQL (retrieval, evidence). Not appDb().$client:
//                drizzle replaces that client's JSON serializers, so sql.json() values arrive as objects and fail.
let app: Db | undefined;
let service: Db | undefined;
let serviceRaw: postgres.Sql | undefined;
let appRaw: postgres.Sql | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
export function appDb(): Db { return (app ??= createDb(required("DATABASE_APP_URL"))); }
export function serviceDb(): Db { return (service ??= createDb(required("DATABASE_SERVICE_URL"))); }
export function appSql(): postgres.Sql { return (appRaw ??= postgres(required("DATABASE_APP_URL"), { max: 4, prepare: false })); }
export function serviceSql(): postgres.Sql { return (serviceRaw ??= postgres(required("DATABASE_SERVICE_URL"), { max: 4, prepare: false })); }
// Tests end the pools so the node test runner can exit; the server never calls this.
export async function closeDb(): Promise<void> {
  await Promise.all([app?.$client.end(), service?.$client.end(), serviceRaw?.end(), appRaw?.end()]);
  app = service = serviceRaw = appRaw = undefined;
}
