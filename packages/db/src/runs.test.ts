import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

// Integration test for migration 0012 (rules, citations, runs, calculations) against the compose DB.
// Tests write inside a transaction that is rolled back at the end, because a locked run can never
// be deleted (that is the point), so ordinary cascade cleanup would fail.
const OWNER = process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot";
const APP = process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot";
const owner = postgres(OWNER, { max: 1 });
const app = postgres(APP, { max: 1 });
test.after(() => Promise.all([owner.end(), app.end()]));

class Rollback extends Error {}
// Runs `fn` in a transaction and always rolls it back. Assert inside `fn`.
const rolledBack = async (sql: postgres.Sql, fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
// A statement expected to fail, isolated in a savepoint so the outer transaction stays usable.
const rejects = (tx: postgres.TransactionSql, run: (sp: postgres.TransactionSql) => Promise<unknown>, re: RegExp, code?: string) =>
  assert.rejects(tx.savepoint(run), (e: unknown) => { assert.match(String(e), re); if (code) assert.equal((e as { code?: string }).code, code); return true; });

// Shared fixture rows: orgs, user, project, scenario, parcel snapshot, source document.
async function fixture(tx: postgres.TransactionSql) {
  const [{ id: orgA }] = await tx`insert into organizations (name, slug) values ('Runs A', 'runs-a-' || gen_random_uuid()) returning id`;
  const [{ id: orgB }] = await tx`insert into organizations (name, slug) values ('Runs B', 'runs-b-' || gen_random_uuid()) returning id`;
  const [{ id: userId }] = await tx`insert into users (email) values ('runs-' || gen_random_uuid() || '@example.test') returning id`;
  const [{ id: projectId }] = await tx`insert into projects (org_id, name) values (${orgA}, 'Runs project') returning id`;
  const [{ id: scenarioId }] = await tx`insert into scenarios (org_id, project_id, name) values (${orgA}, ${projectId}, 'Runs scenario') returning id`;
  await tx`insert into parcels (taxkey, jurisdiction_id) values ('9999999999', 'milwaukee-wi') on conflict do nothing`;
  const [{ id: snapshotId }] = await tx`insert into parcel_snapshots (taxkey, geometry, attributes, address, source_layer, retrieved_at, content_hash)
    values ('9999999999', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), '{}'::jsonb, 'test', 'test', now(), 'runs-' || gen_random_uuid()) returning id`;
  const [{ id: docId }] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status)
    values ('milwaukee-wi', 'ordinance_subchapter', 'runs test doc', 'runs-' || gen_random_uuid(), now(), 'manual_upload', 'active') returning id`;
  return { orgA, orgB, userId, projectId, scenarioId, snapshotId, docId };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const newRun = (tx: postgres.TransactionSql, f: Fixture) =>
  tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set, created_by)
     values (${f.orgA}, ${f.projectId}, ${f.scenarioId}, ${f.snapshotId}, '{}', 'h1', '{"use":"multifamily"}', '{}', ${f.userId}) returning id`.then((r) => r[0]!["id"] as string);
const newRule = (tx: postgres.TransactionSql, fam: string, v: number, params: string, start: string) =>
  tx`insert into zoning_rules (family_id, version, jurisdiction_id, district_code, category, kind, params, criticality, status, effective_start)
     values (${fam}, ${v}, 'milwaukee-wi', 'LB1', 'height', 'max_height_ft', ${params}::jsonb, 'critical', 'approved', ${start}) returning id`.then((r) => r[0]!["id"] as string);

test("zoning_rules: family+version unique; a second version is a new row; rows are append-only", () => rolledBack(owner, async (tx) => {
  const fam = "test-" + crypto.randomUUID();
  const id = await newRule(tx, fam, 1, '{"max_ft":45}', "2025-07-15");
  await newRule(tx, fam, 2, '{"max_ft":40}', "2026-01-01");
  await rejects(tx, (sp) => newRule(sp, fam, 2, "{}", "2026-01-01"), /zoning_rules_family_version_idx/);
  await rejects(tx, (sp) => sp`update zoning_rules set params = '{"max_ft":99}' where id = ${id}`, /append-only/, "55000");
}));

test("citations and rule_citations are append-only and the pair is unique", () => rolledBack(owner, async (tx) => {
  const f = await fixture(tx);
  const [{ id: cit }] = await tx`insert into citations (source_document_id, page_number, section, excerpt) values (${f.docId}, 16, '295-605-2', 'Maximum height 45 ft') returning id`;
  const rule = await newRule(tx, "test-" + crypto.randomUUID(), 1, '{"max_ft":45}', "2025-07-15");
  await tx`insert into rule_citations (zoning_rule_id, citation_id) values (${rule}, ${cit})`;
  await rejects(tx, (sp) => sp`insert into rule_citations (zoning_rule_id, citation_id) values (${rule}, ${cit})`, /rule_citations_rule_citation_idx/);
  await rejects(tx, (sp) => sp`update citations set excerpt = 'edited' where id = ${cit}`, /append-only/, "55000");
  await rejects(tx, (sp) => sp`delete from citations where id = ${cit}`, /append-only/, "55000");
}));

test("feasibility_runs: writable until locked, then frozen; never deletable", () => rolledBack(owner, async (tx) => {
  const f = await fixture(tx);
  const runId = await newRun(tx, f);
  await tx`update feasibility_runs set status = 'running' where id = ${runId}`;
  await rejects(tx, (sp) => sp`delete from feasibility_runs where id = ${runId}`, /locked/, "55000");
  await tx`update feasibility_runs set status = 'succeeded', final_status = 'revise_scenario', route = 'revise_scenario', policy_reasons = '["O3:critical_or_high_fail"]', locked_at = now() where id = ${runId}`;
  await rejects(tx, (sp) => sp`update feasibility_runs set final_status = 'proceed_to_concept_design' where id = ${runId}`, /locked/, "55000");
  const [row] = await tx`select final_status, locked_at from feasibility_runs where id = ${runId}`;
  assert.equal(row?.["final_status"], "revise_scenario");
  assert.ok(row?.["locked_at"]);
}));

test("calculations are append-only", () => rolledBack(owner, async (tx) => {
  const f = await fixture(tx);
  const runId = await newRun(tx, f);
  const [{ id }] = await tx`insert into calculations (org_id, feasibility_run_id, rule_category, finding_status, criticality, calculation_detail, confidence)
    values (${f.orgA}, ${runId}, 'height', 'fail', 'critical', '{"detail":"46 <= 45 → fail"}', 'high') returning id`;
  await rejects(tx, (sp) => sp`update calculations set finding_status = 'pass' where id = ${id}`, /append-only/, "55000");
  await rejects(tx, (sp) => sp`delete from calculations where id = ${id}`, /append-only/, "55000");
}));

test("RLS: the app role sees a run and its calculations only under the owning org; cannot write another org's run", async () => {
  // Rows must be visible to the app connection, so they are committed. Runs cannot be deleted, so
  // the two test orgs stay behind, renamed. (CI databases are fresh per run.)
  const f = await owner.begin(fixture);
  const runId = await owner.begin((tx) => newRun(tx, f));
  await owner`insert into calculations (org_id, feasibility_run_id, rule_category, finding_status, criticality, calculation_detail, confidence)
    values (${f.orgA}, ${runId}, 'height', 'fail', 'critical', '{}', 'high')`;
  try {
    const count = (orgId: string | null) => app.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${orgId ?? ""}, true)`;
      const [r] = await tx`select count(*)::int as n from feasibility_runs where id = ${runId}`;
      const [c] = await tx`select count(*)::int as n from calculations where feasibility_run_id = ${runId}`;
      return [r?.["n"], c?.["n"]];
    });
    assert.deepEqual(await count(f.orgA), [1, 1]);
    assert.deepEqual(await count(f.orgB), [0, 0]);
    assert.deepEqual(await count(null), [0, 0]);
    await assert.rejects(app.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${f.orgA}, true)`;
      await tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set)
        values (${f.orgB}, ${f.projectId}, ${f.scenarioId}, ${f.snapshotId}, '{}', 'h2', '{}', '{}')`;
    }), /row-level security/);
  } finally {
    await owner`update organizations set name = 'runs-test-retired' where id in (${f.orgA}, ${f.orgB})`;
  }
});
