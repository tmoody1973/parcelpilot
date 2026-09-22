import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { DECISION_POLICY_V1 } from "@parcelpilot/contracts";
import { decisionPolicyVersionId } from "./decision-policy.ts";

// MOO-834 (migration 0019) against the compose DB. Every write rolls back: locked runs and append-only logs can never
// be deleted, so ordinary cleanup would fail.
const owner = postgres(process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot", { max: 1 });
test.after(() => owner.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await owner.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const rejects = (tx: postgres.TransactionSql, run: (sp: postgres.TransactionSql) => Promise<unknown>, re: RegExp) =>
  assert.rejects(tx.savepoint(run), (e: unknown) => { assert.match(String(e), re); return true; });
// Become the app role for the rest of the transaction, scoped to one org, so RLS applies as it does for the web app.
const asApp = async (tx: postgres.TransactionSql, orgId: string) => { await tx`set local role app_role`; await tx`select set_config('app.org_id', ${orgId}, true)`; };
const HASH = "a".repeat(64);

async function lockedRun(tx: postgres.TransactionSql, tag: string) {
  const [{ id: org }] = await tx`insert into organizations (name, slug) values (${tag}, ${"dl-" + tag + "-"} || gen_random_uuid()) returning id`;
  const [{ id: project }] = await tx`insert into projects (org_id, name) values (${org}, 'p') returning id`;
  const [{ id: scenario }] = await tx`insert into scenarios (org_id, project_id, name) values (${org}, ${project}, 's') returning id`;
  await tx`insert into parcels (taxkey, jurisdiction_id) values ('9999999999', 'milwaukee-wi') on conflict do nothing`;
  const [{ id: snap }] = await tx`insert into parcel_snapshots (taxkey, geometry, attributes, address, source_layer, retrieved_at, content_hash)
    values ('9999999999', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), '{}'::jsonb, 't', 't', now(), 'dl-' || gen_random_uuid()) returning id`;
  const [{ id: run }] = await tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set,
      decision_mode, status, final_status, route, locked_at, gold_case_id, gold_case_version, gold_expected_status, gold_expected_route)
    values (${org}, ${project}, ${scenario}, ${snap}, '{}', 'h', '{}', '{}', 'shadow', 'succeeded', 'verify_before_committing', 'engage_zoning_professional', now(),
      'G05', 1, 'verify_before_committing', 'engage_zoning_professional') returning id`;
  return { org: org as string, run: run as string };
}
const jevRow = (tx: postgres.TransactionSql, r: { org: string; run: string }, route: string, extra: Partial<{ status: string; error: string | null; used: boolean; mode: string }> = {}) =>
  tx`insert into jev_runs (org_id, feasibility_run_id, provider, decision_mode, input_state, input_state_hash, question_set_version, model_version, answers, recommended_route, route_confidence, status, error, used_by_policy)
     values (${r.org}, ${r.run}, 'jev', ${extra.mode ?? "shadow"}, '{}', ${HASH}, 'q.v1', 'jev-1.13', '{}', ${route}, 0.8, ${extra.status ?? "ok"}, ${extra.error ?? null}, ${extra.used ?? false}) returning id`.then((x) => x[0]!["id"] as string);

test("policy v1 is seeded, equals the code's copy, and carries the 05 §4.6 values", () => rolledBack(async (tx) => {
  const t = DECISION_POLICY_V1.thresholds;
  assert.deepEqual([t.manual_review_true_at, t.summary_safe_false_below, t.route_confidence_min, t.risk_medium_at, t.risk_high_at, t.jev_timeout_ms], [0.35, 0.65, 0.7, 0.5, 1.5, 2000]);
  const id = await decisionPolicyVersionId(tx, DECISION_POLICY_V1);
  assert.match(id, /^[0-9a-f-]{36}$/);
  await assert.rejects(decisionPolicyVersionId(tx, { ...DECISION_POLICY_V1, thresholds: { ...t, manual_review_true_at: 0.5 } }), /differs from the code's copy/);
  await assert.rejects(decisionPolicyVersionId(tx, { ...DECISION_POLICY_V1, version: "decision_policy.v99" }), /not in decision_policy_versions/);
  await rejects(tx, (sp) => sp`update decision_policy_versions set config = '{}' where id = ${id}`, /append-only/);
  await asApp(tx, "00000000-0000-0000-0000-000000000000");
  const [{ n }] = await tx`select count(*)::int as n from decision_policy_versions`;
  assert.ok(n >= 1, "every role can read the policy");
  await rejects(tx, (sp) => sp`insert into decision_policy_versions (version, config) values ('decision_policy.v9', '{"version":"decision_policy.v9"}')`, /permission denied/);
}));

test("jev_runs, briefing_runs and validation_runs are append-only and enforce their shape", () => rolledBack(async (tx) => {
  const r = await lockedRun(tx, "a");
  const jev = await jevRow(tx, r, "engage_zoning_professional");
  await rejects(tx, (sp) => sp`update jev_runs set recommended_route = 'proceed_to_concept_design' where id = ${jev}`, /append-only/);
  await rejects(tx, (sp) => sp`delete from jev_runs where id = ${jev}`, /append-only/);
  await rejects(tx, (sp) => jevRow(sp, r, "engage_zoning_professional", { used: true }), /jev_runs_shadow_never_used/);
  await rejects(tx, (sp) => jevRow(sp, r, "engage_zoning_professional", { status: "failed" }), /jev_runs_failed_has_error/);
  await jevRow(tx, r, "engage_zoning_professional", { status: "failed", error: "timeout after 2000 ms" });
  const [{ id: brief }] = await tx`insert into briefing_runs (org_id, feasibility_run_id, contract, contract_hash, prompt_version, schema_version, outcome, error)
    values (${r.org}, ${r.run}, '{}', ${HASH}, 'briefing.v1', 'briefing_output.v1', 'fallback', 'status_lock failed') returning id`;
  await rejects(tx, (sp) => sp`insert into briefing_runs (org_id, feasibility_run_id, contract, contract_hash, prompt_version, schema_version, outcome)
    values (${r.org}, ${r.run}, '{}', ${HASH}, 'briefing.v1', 'briefing_output.v1', 'validated')`, /briefing_runs_validated_has_output/);
  await tx`insert into validation_runs (org_id, briefing_run_id, validator, result, effect) values (${r.org}, ${brief}, 'status_lock', 'fail', 'brief_failed')`;
  await rejects(tx, (sp) => sp`insert into validation_runs (org_id, briefing_run_id, validator, result) values (${r.org}, ${brief}, 'status_lock', 'pass')`, /validation_runs_one_per_validator/);
  await rejects(tx, (sp) => sp`insert into validation_runs (org_id, briefing_run_id, validator, result, effect) values (${r.org}, ${brief}, 'schema', 'pass', 'sentence_removed')`, /validation_runs_pass_has_no_effect/);
  await rejects(tx, (sp) => sp`update briefing_runs set outcome = 'validated' where id = ${brief}`, /append-only/);
  await rejects(tx, (sp) => sp`update feasibility_runs set gold_case_id = null where id = ${r.run}`, /locked/);
}));

test("org A cannot read org B's jev_runs, briefing_runs, validation_runs or decision_comparisons", () => rolledBack(async (tx) => {
  const a = await lockedRun(tx, "a");
  const b = await lockedRun(tx, "b");
  await jevRow(tx, a, "engage_zoning_professional");
  await jevRow(tx, b, "engage_zoning_professional");
  for (const r of [a, b]) {
    const [{ id }] = await tx`insert into briefing_runs (org_id, feasibility_run_id, contract, contract_hash, prompt_version, schema_version, outcome) values (${r.org}, ${r.run}, '{}', ${HASH}, 'b.v1', 's.v1', 'fallback') returning id`;
    await tx`insert into validation_runs (org_id, briefing_run_id, validator, result) values (${r.org}, ${id}, 'schema', 'skipped')`;
  }
  await asApp(tx, a.org);
  for (const table of ["jev_runs", "briefing_runs", "validation_runs", "decision_comparisons"]) {
    const orgs = (await tx`select distinct org_id from ${tx(table)} where org_id in (${a.org}, ${b.org})`).map((x) => x["org_id"]);
    assert.deepEqual(orgs, [a.org], `${table}: only org A's rows are visible`);
  }
  await rejects(tx, (sp) => jevRow(sp, b, "engage_zoning_professional"), /row-level security/);
}));

test("decision_comparisons: agreement, expert label, latest call wins, and unsafe-permissive", () => rolledBack(async (tx) => {
  const r = await lockedRun(tx, "a");
  const view = () => tx`select * from decision_comparisons where feasibility_run_id = ${r.run}`.then((x) => x[0]!);
  await jevRow(tx, r, "engage_zoning_professional");
  let v = await view();
  assert.equal(v["rules_only_route"], "engage_zoning_professional");
  assert.equal(v["expert_route"], "engage_zoning_professional");
  assert.equal(v["gold_case_id"], "G05");
  assert.equal(v["jev_agrees_rules_only"], true);
  assert.equal(v["jev_agrees_expert"], true);
  assert.equal(v["jev_unsafe_permissive"], false);
  await tx`insert into jev_runs (org_id, feasibility_run_id, provider, decision_mode, input_state, input_state_hash, question_set_version, model_version, answers, recommended_route, status, created_at)
    values (${r.org}, ${r.run}, 'jev', 'shadow', '{}', ${HASH}, 'q.v1', 'jev-1.13', '{}', 'proceed_to_concept_design', 'ok', now() + interval '1 second')`;
  v = await view();
  assert.equal(v["jev_route"], "proceed_to_concept_design", "the latest JEV call is the one compared");
  assert.equal(v["jev_agrees_rules_only"], false);
  assert.equal(v["jev_unsafe_permissive"], true, "proceed where rules and expert require review is unsafe-permissive");
  assert.equal(v["baseline_route"], null);
  const [{ n }] = await tx`select count(*)::int as n from decision_comparisons where feasibility_run_id = ${r.run}`;
  assert.equal(n, 1, "one comparison row per run");
}));
