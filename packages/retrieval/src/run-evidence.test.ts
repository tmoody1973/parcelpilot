import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { activateVersion, embedChunks, ensureVersion, localHashProvider, type Provider } from "@parcelpilot/db";
import { assembleBundle } from "./bundle.ts";
import { attachEvidence, bundleHash, canonicalJson, evidenceTokenBudget, subquestionsFor, type RunEvidenceInput } from "./run-evidence.ts";

// MOO-835. The owner connection builds a throwaway world, then the test becomes app_role scoped to one org, exactly as
// the web app does, so RLS applies to every retrieval and bundle row. Everything rolls back.
const owner = postgres(process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot", { max: 1 });
test.after(() => owner.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await owner.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const asApp = async (tx: postgres.TransactionSql, orgId: string) => { await tx`set local role app_role`; await tx`select set_config('app.org_id', ${orgId}, true)`; };
const model: Provider = { ...localHashProvider(), model: "run-evidence-test" };
const CATS = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;

async function world(tx: postgres.TransactionSql) {
  const J = "re-" + crypto.randomUUID().slice(0, 8);
  await tx`insert into jurisdictions (id, name, state) values (${J}, 'run evidence test', 'WI')`;
  const [{ id: doc }] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values (${J}, 'ordinance_subchapter', 're doc', ${"b".repeat(64)}, now(), 'manual_upload', 'active', '2025-07-15') returning id`;
  const chunk = (section: string, type: string, text: string, districts: string[], cats: string[]) =>
    tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, subchapter, section, source_type, district_codes, rule_categories, source_document_id, page_start, text, status, effective_start)
      values ('re-' || gen_random_uuid(), 1, ${J}, '295', '6', ${section}, ${type}::code_source_type, ${districts}, ${cats}::rule_category[], ${doc}, 16, ${text}, 'active', '2025-07-15')`;
  await chunk("295-605-2", "table_row", "Table 295-605-2. Height, maximum (ft.). LB1: 45; LB2: 60.", ["LB1", "LB2"], ["height"]);
  await chunk("295-605-2-f", "ordinance_text", "Building height is measured from grade to the top of the roof.", [], ["height"]);
  await chunk("295-603", "ordinance_text", "Uses in commercial districts: multi-family dwelling, retail establishment.", ["LB1"], ["use"]);
  await chunk("295-403", "ordinance_text", "Parking spaces required per dwelling unit in LB1.", [], ["parking"]);
  await chunk("295-601", "ordinance_text", "The LB1 local business district purpose: pedestrian-oriented commercial areas.", ["LB1"], []);
  await tx`update embedding_versions set is_active = false where is_active`; // the real OpenAI version may be active here (rolled back)
  const v = await ensureVersion(tx, model);
  await embedChunks(tx, model, v, { documentIds: [doc] });
  await activateVersion(tx, v.id);
  const run = async (tag: string) => {
    const [{ id: org }] = await tx`insert into organizations (name, slug) values (${tag}, ${"re-" + tag + "-"} || gen_random_uuid()) returning id`;
    const [{ id: project }] = await tx`insert into projects (org_id, name) values (${org}, 'p') returning id`;
    const [{ id: scenario }] = await tx`insert into scenarios (org_id, project_id, name) values (${org}, ${project}, 's') returning id`;
    await tx`insert into parcels (taxkey, jurisdiction_id) values ('9999999998', 'milwaukee-wi') on conflict do nothing`;
    const [{ id: snap }] = await tx`insert into parcel_snapshots (taxkey, geometry, attributes, address, source_layer, retrieved_at, content_hash)
      values ('9999999998', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), '{}'::jsonb, 't', 't', now(), 're-' || gen_random_uuid()) returning id`;
    const [{ id }] = await tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set, status, final_status, route, locked_at)
      values (${org}, ${project}, ${scenario}, ${snap}, '{}', 'h', '{}', '{}', 'succeeded', 'revise_scenario', 'revise_scenario', now()) returning id`;
    return { org: org as string, run: id as string };
  };
  return { J, v, run };
}
const input = (J: string, r: { org: string; run: string }): RunEvidenceInput => ({
  runId: r.run, orgId: r.org, jurisdictionId: J, districts: ["LB1"], overlays: [], analysisDate: "2026-09-22",
  categories: CATS, scenario: { use: "multifamily", ground_floor_use: "retail" }, tokenBudget: 6000,
});

test("questions: the M4 wording for six categories, templates for parking and lot coverage, then the district", () => {
  const q = subquestionsFor({ districts: ["LB1"], categories: [...CATS, "made_up"], scenario: { use: "multifamily", ground_floor_use: "retail" } });
  assert.deepEqual(q.map(([c]) => c), [...CATS, null], "unknown categories are skipped, never guessed");
  assert.equal(q[0]![1], "Is a multi-family dwelling allowed in LB1, with retail on the ground floor?");
  assert.equal(q[1]![1], "maximum and minimum building height in LB1");
  assert.equal(q.at(-1)![1], "LB1 district purpose and where it applies");
});

test("the token budget comes from config and refuses nonsense", () => {
  assert.equal(evidenceTokenBudget({}), 6000);
  assert.equal(evidenceTokenBudget({ EVIDENCE_TOKEN_BUDGET: "4000" }), 4000);
  assert.throws(() => evidenceTokenBudget({ EVIDENCE_TOKEN_BUDGET: "-1" }), /positive integer/);
  assert.throws(() => evidenceTokenBudget({ EVIDENCE_TOKEN_BUDGET: "lots" }), /positive integer/);
});

test("canonical JSON ignores key order at every depth", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), canonicalJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]), "array order still matters");
});

test("a locked run gets a frozen bundle under its own org; replay gives the same hash; the run is untouched", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const a = await w.run("a");
  const b = await w.run("b");
  const [before] = await tx`select final_status, route, locked_at from feasibility_runs where id = ${a.run}`;
  await asApp(tx, a.org);
  const got = await attachEvidence(tx, input(w.J, a));
  assert.equal(got.status, "assembled", got.status === "unavailable" ? got.error : "");
  if (got.status !== "assembled") return;
  assert.equal(got.retrievalRunIds.length, CATS.length + 1, "one retrieval run per category plus the district question");
  assert.equal(got.bundle.run_id, a.run);
  assert.ok(got.bundle.items.length > 0 && got.bundle.items.every((i) => i.status === "active"));
  const [row] = await tx`select status, bundle, bundle_sha256, retrieval_run_ids from run_evidence_bundles where feasibility_run_id = ${a.run}`;
  assert.equal(row!["status"], "assembled");
  assert.equal(row!["bundle_sha256"], got.sha256);
  assert.equal(bundleHash(row!["bundle"]), got.sha256, "the stored JSON hashes to the stored hash (jsonb key reordering does not matter)");
  const replay = await assembleBundle(tx, { retrievalRunIds: row!["retrieval_run_ids"], tokenBudget: 6000, analysisDate: "2026-09-22", runId: a.run });
  assert.equal(bundleHash(replay), got.sha256, "re-assembling from the same retrieval runs gives the same hash");
  const orgs = await tx`select distinct org_id from retrieval_runs where feasibility_run_id = ${a.run}`;
  assert.deepEqual(orgs.map((o) => o["org_id"]), [a.org], "retrieval rows carry the run's org, never null");
  await assert.rejects(tx.savepoint((sp) => sp`update run_evidence_bundles set bundle_sha256 = ${"c".repeat(64)} where feasibility_run_id = ${a.run}`), /append-only|permission denied/);
  const [after] = await tx`select final_status, route, locked_at from feasibility_runs where id = ${a.run}`;
  assert.deepEqual(after, before, "evidence never changes the run's status or route");

  await tx`select set_config('app.org_id', ${b.org}, true)`; // now org B
  const [{ n }] = await tx`select count(*)::int as n from run_evidence_bundles where feasibility_run_id = ${a.run}`;
  const [{ m }] = await tx`select count(*)::int as m from retrieval_runs where feasibility_run_id = ${a.run}`;
  assert.deepEqual([n, m], [0, 0], "org B sees none of org A's evidence");
}));

test("no active embedding version: the run is recorded as unavailable, with no half-written retrieval rows", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const a = await w.run("a");
  await tx`update embedding_versions set is_active = false where id = ${w.v.id}`;
  await asApp(tx, a.org);
  const got = await attachEvidence(tx, input(w.J, a));
  assert.equal(got.status, "unavailable");
  const [row] = await tx`select status, bundle, error from run_evidence_bundles where feasibility_run_id = ${a.run}`;
  assert.equal(row!["status"], "unavailable");
  assert.equal(row!["bundle"], null);
  assert.match(row!["error"] as string, /embedding version/);
  const [{ n }] = await tx`select count(*)::int as n from retrieval_runs where feasibility_run_id = ${a.run}`;
  assert.equal(n, 0, "the savepoint rolled back any retrieval rows");
  const [run] = await tx`select final_status from feasibility_runs where id = ${a.run}`;
  assert.equal(run!["final_status"], "revise_scenario", "the run's status is unchanged");
}));
