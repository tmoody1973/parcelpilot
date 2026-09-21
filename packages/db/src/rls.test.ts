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

// Scopes an app connection to `orgId` for one transaction, then runs `q` under RLS.
const scoped = <T>(orgId: string, q: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
  app.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return q(tx);
  });

test("app role with org A cannot read org B's projects or scenarios", async () => {
  const [{ id: projA }] = await owner`insert into projects (org_id, name) values (${orgA}, 'A project') returning id`;
  const [{ id: projB }] = await owner`insert into projects (org_id, name) values (${orgB}, 'B project') returning id`;
  await owner`insert into scenarios (org_id, project_id, name) values (${orgB}, ${projB}, 'B scenario')`;
  try {
    // reads are filtered to org A: it sees its own project and none of org B's rows.
    const projects = await scoped(orgA, (tx) => tx`select id, org_id from projects order by name`);
    assert.deepEqual(projects.map((r) => r["id"]), [projA]);
    const scenarios = await scoped(orgA, (tx) => tx`select id from scenarios`);
    assert.equal(scenarios.length, 0);
    // and the WITH CHECK clause blocks org A from writing a row into org B.
    await assert.rejects(
      scoped(orgA, (tx) => tx`insert into projects (org_id, name) values (${orgB}, 'cross-org write')`),
      /row-level security/,
    );
  } finally {
    await owner`delete from projects where id in (${projA}, ${projB})`; // cascade removes org B's scenario
  }
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
