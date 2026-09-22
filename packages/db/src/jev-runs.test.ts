import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { DECISION_POLICY_V1, type PreparedState } from "@parcelpilot/contracts";
import { preparedStateHash, type JevCall } from "@parcelpilot/zoning-core";
import { recordJevRun } from "./jev-runs.ts";

// MOO-836: the shadow log row, written as app_role under the run's org. Rolled back.
const owner = postgres(process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot", { max: 1 });
test.after(() => owner.end());
class Rollback extends Error {}
const state = { version: "prepared_state.v1", jurisdiction: "milwaukee-wi" } as unknown as PreparedState;
const ok: JevCall = {
  status: "ok", latencyMs: 412, costUsd: 0.000084, raw: { model: "jev-1.13.0" },
  response: {
    model: "jev-1.13.0", usage: { input_tokens: 2000, output_tokens: 40 },
    answers: {
      overall_risk: { type: "score", score: 1.7, legend: { "0": "Low", "1": "Medium", "2": "High" }, probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 }, confidence: 0.8 },
      manual_review_required: { type: "noul", noul: 0.9 },
      recommended_route: { type: "choice", choice: "revise_scenario", probabilities: { revise_scenario: 0.8 }, confidence: 0.75 },
      summary_safe_to_display: { type: "noul", noul: 0.8 },
    },
  },
};

test("a shadow call is logged under the run's org, never as used by policy; a failed call is logged too", async () => {
  await owner.begin(async (tx) => {
    const [{ id: org }] = await tx`insert into organizations (name, slug) values ('jr', 'jr-' || gen_random_uuid()) returning id`;
    const [{ id: project }] = await tx`insert into projects (org_id, name) values (${org}, 'p') returning id`;
    const [{ id: scenario }] = await tx`insert into scenarios (org_id, project_id, name) values (${org}, ${project}, 's') returning id`;
    await tx`insert into parcels (taxkey, jurisdiction_id) values ('9999999997', 'milwaukee-wi') on conflict do nothing`;
    const [{ id: snap }] = await tx`insert into parcel_snapshots (taxkey, geometry, attributes, address, source_layer, retrieved_at, content_hash)
      values ('9999999997', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), '{}'::jsonb, 't', 't', now(), 'jr-' || gen_random_uuid()) returning id`;
    const [{ id: run }] = await tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set, decision_mode, status, final_status, route, locked_at)
      values (${org}, ${project}, ${scenario}, ${snap}, '{}', 'h', '{}', '{}', 'shadow', 'succeeded', 'revise_scenario', 'revise_scenario', now()) returning id`;
    await tx`set local role app_role`;
    await tx`select set_config('app.org_id', ${org}, true)`;
    await recordJevRun(tx, { orgId: org, runId: run, decisionMode: "shadow", state, call: ok, policy: DECISION_POLICY_V1 });
    await recordJevRun(tx, { orgId: org, runId: run, decisionMode: "shadow", state, call: { status: "failed", error: "timeout after 2000 ms", raw: null, latencyMs: 2001 }, policy: DECISION_POLICY_V1 });
    const rows = await tx`select status, model_version, recommended_route, route_confidence::float as c, answers->'overall_risk'->>'bucket' as bucket, input_state_hash, question_set_version, used_by_policy, error, input_tokens, cost_estimate_usd::float as cost from jev_runs where feasibility_run_id = ${run} order by status`; // enum order: ok, failed
    assert.deepEqual(rows.map((r) => [r["status"], r["model_version"], r["recommended_route"], r["bucket"], r["used_by_policy"], r["error"]]), [
      ["ok", "jev-1.13.0", "revise_scenario", "high", false, null],
      ["failed", null, null, null, false, "timeout after 2000 ms"],
    ]);
    assert.equal(rows[0]!["input_state_hash"], preparedStateHash(state));
    assert.equal(rows[0]!["question_set_version"], "jev_questions.v1");
    assert.deepEqual([rows[0]!["c"], rows[0]!["input_tokens"], rows[0]!["cost"]], [0.75, 2000, 0.000084]);
    const [cmp] = await tx`select rules_only_route, jev_route, jev_agrees_rules_only, jev_unsafe_permissive from decision_comparisons where feasibility_run_id = ${run}`;
    assert.deepEqual([cmp!["rules_only_route"], cmp!["jev_agrees_rules_only"], cmp!["jev_unsafe_permissive"]], ["revise_scenario", cmp!["jev_route"] === "revise_scenario", false]);
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
});
