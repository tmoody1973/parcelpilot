import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

// Integration test against the compose database (docs/planning/03_data_model.md §6).
// Requires migrations applied. Runs in CI against `docker compose up db`.
const OWNER = process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot";
const APP = process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot";
const SERVICE = process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot";

const owner = postgres(OWNER, { max: 1 });
const app = postgres(APP, { max: 1 });
const service = postgres(SERVICE, { max: 1 });
let orgA = "", orgB = "", userId = "";

before(async () => {
  [{ id: orgA }] = await owner`insert into organizations (name, slug) values ('Org A', 'rls-test-a-' || gen_random_uuid()) returning id`;
  [{ id: orgB }] = await owner`insert into organizations (name, slug) values ('Org B', 'rls-test-b-' || gen_random_uuid()) returning id`;
  [{ id: userId }] = await owner`insert into users (email) values ('rls-test-' || gen_random_uuid() || '@example.test') returning id`;
  await owner`insert into memberships (org_id, user_id, role) values (${orgA}, ${userId}, 'owner'), (${orgB}, ${userId}, 'member')`;
});
after(async () => {
  await owner`delete from organizations where id in (${orgA}, ${orgB})`;
  await owner`delete from users where id = ${userId}`;
  await Promise.all([owner.end(), app.end(), service.end()]);
});

const asOrg = (sql: postgres.Sql, orgId: string | null) =>
  sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId ?? ""}, true)`;
    return tx`select org_id from memberships where user_id = ${userId}`;
  });

test("trip-wire: every table with an org_id column has an RLS policy", async () => {
  const rows = await owner`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.column_name = 'org_id' and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.table_name not in (select tablename from pg_policies where schemaname = 'public')`;
  assert.deepEqual(rows.map((r) => r["table_name"]), []);
});

test("app role with org A sees only org A rows", async () => {
  const rows = await asOrg(app, orgA);
  assert.deepEqual(rows.map((r) => r["org_id"]), [orgA]);
});

test("app role with a wrong org id sees zero rows", async () => {
  assert.equal((await asOrg(app, "00000000-0000-0000-0000-000000000000")).length, 0);
});

test("app role with app.org_id unset sees zero rows", async () => {
  assert.equal((await asOrg(app, null)).length, 0);
});

test("service role bypasses RLS and sees both orgs", async () => {
  const rows = await service`select org_id from memberships where user_id = ${userId} order by org_id`;
  assert.deepEqual(rows.map((r) => r["org_id"]).sort(), [orgA, orgB].sort());
});

test("audit_events rejects UPDATE and DELETE, even for the owner", async () => {
  for (const op of ["update", "delete"] as const) {
    await assert.rejects(
      owner.begin(async (tx) => {
        const [{ id }] = await tx`insert into audit_events (org_id, action, entity_type) values (${orgA}, 'rls_test', 'test') returning id`;
        if (op === "update") await tx`update audit_events set action = 'tampered' where id = ${id}`;
        else await tx`delete from audit_events where id = ${id}`;
      }),
      (err: unknown) => {
        assert.match(String((err as Error).message), /append-only \((UPDATE|DELETE) not allowed\)/);
        return true;
      },
    );
  }
});
