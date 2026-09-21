import { createDb, type Db } from "@parcelpilot/db";

// Lazy singletons so a missing env var never fails the build, only the first request that needs it.
//   appDb     — RLS-bound; every tenant-scoped read/write goes through `withOrg` (DATABASE_APP_URL).
//   serviceDb — BYPASSRLS; used only to provision orgs/users/memberships on sign-in (DATABASE_SERVICE_URL).
let app: Db | undefined;
let service: Db | undefined;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function appDb(): Db {
  return (app ??= createDb(required("DATABASE_APP_URL")));
}

export function serviceDb(): Db {
  return (service ??= createDb(required("DATABASE_SERVICE_URL")));
}
