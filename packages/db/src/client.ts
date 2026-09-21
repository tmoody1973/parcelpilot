import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.ts";

export type Db = ReturnType<typeof createDb>;

// Three connection identities (docs/planning/03_data_model.md §6):
//   owner   — migrations only (DATABASE_URL)
//   app     — every request; RLS applies; caller must set app.org_id per transaction (DATABASE_APP_URL)
//   service — workers; BYPASSRLS; touch jurisdiction-shared tables only, by convention (DATABASE_SERVICE_URL)
export function createDb(url: string, opts: { max?: number } = {}) {
  const sql = postgres(url, { max: opts.max ?? 5, prepare: false });
  return drizzle(sql, { schema, casing: "snake_case" });
}

// Runs `fn` inside a transaction with the tenant id set for RLS. `set_config(..., true)` scopes it to
// the transaction. `orgId` is a bound parameter, never string-interpolated, so a request-supplied
// value can never break out of the statement.
export async function withOrg<T>(db: Db, orgId: string, fn: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
