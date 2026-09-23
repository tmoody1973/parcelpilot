import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { BriefingCall } from "@parcelpilot/zoning-core";
import { briefRun } from "./briefing-runs.ts";

// MOO-838: a brief for a stored run, written by a fake model, validated, repaired once, recorded. Rolled back.
const owner = postgres(process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot", { max: 1 });
test.after(() => owner.end());
class Rollback extends Error {}

async function world(tx: postgres.TransactionSql, tag: string) {
  const [{ id: org }] = await tx`insert into organizations (name, slug) values (${tag}, ${"br-" + tag + "-"} || gen_random_uuid()) returning id`;
  const [{ id: project }] = await tx`insert into projects (org_id, name) values (${org}, 'p') returning id`;
  const [{ id: scenario }] = await tx`insert into scenarios (org_id, project_id, name) values (${org}, ${project}, 's') returning id`;
  await tx`insert into parcels (taxkey, jurisdiction_id) values ('9999999996', 'milwaukee-wi') on conflict do nothing`;
  const [{ id: snap }] = await tx`insert into parcel_snapshots (taxkey, geometry, attributes, address, source_layer, retrieved_at, content_hash, lot_area_sqft)
    values ('9999999996', ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), '{}'::jsonb, '1 Test St', 't', now(), 'br-' || gen_random_uuid(), 7000) returning id`;
  const stored = { risk: "high", reasons: ["O3:critical_or_high_fail"], triggers: [], coverage: { checked: ["height"], manual_review: [], unknown: ["parking"] } };
  const [{ id: run }] = await tx`insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set, status, final_status, route, policy_reasons, locked_at)
    values (${org}, ${project}, ${scenario}, ${snap}, '{}', 'h', ${tx.json({ use: "multifamily", height_ft: 46, ground_floor_use: "retail" })}, '{}', 'succeeded', 'revise_scenario', 'revise_scenario', ${tx.json(stored)}, now()) returning id`;
  const finding = { category: "height", status: "fail", criticality: "critical", calculation_ids: [], citations: [], missing_inputs: [], confidence: "high", proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" } };
  await tx`insert into calculations (org_id, feasibility_run_id, rule_category, finding_status, criticality, calculation_detail, confidence) values (${org}, ${run}, 'height', 'fail', 'critical', ${tx.json({ finding })}, 'high')`;
  return { org: org as string, run: run as string };
}
// A fake model: answers from the contract it is given, wrong on the first call when asked to be.
function fakeModel(opts: { wrongFirst: boolean }) {
  const repairs: Array<string[] | undefined> = [];
  const write = (async (i: { contract: any; contractHash: string; repair?: string[] }) => {
    repairs.push(i.repair);
    const wrong = opts.wrongFirst && repairs.length === 1;
    const output = {
      contract_hash: i.contractHash, status_echo: wrong ? "proceed_to_concept_design" : i.contract.final_decision.status,
      executive_summary: [{ text: "Revise the scenario: the building is taller than allowed.", kind: "framing", source_ids: [] }],
      status_explanation: [], open_questions: [], questions_for_experts: [],
      verified_findings: i.contract.verified_findings.map((f: any) => ({ finding_id: f.finding_id, sentences: [{ text: `The ${f.category} check did not pass.`, kind: "framing", source_ids: [] }] })),
      suggested_actions: [{ action_id: "revise_scenario", rationale: { text: "Lower the building.", kind: "advice", source_ids: [] } }],
      disclaimer: i.contract.required_disclaimer,
    };
    return { status: "ok", output, raw: JSON.stringify(output), model: "fake-model-1", usage: { input_tokens: 100, output_tokens: 50 }, latencyMs: 5, costUsd: 0.001 } as BriefingCall;
  }) as never;
  return { write, repairs };
}

test("a valid brief is recorded as validated, with the cleaned brief and one row per validator", async () => {
  await owner.begin(async (tx) => {
    const w = await world(tx, "a");
    await tx`set local role app_role`;
    await tx`select set_config('app.org_id', ${w.org}, true)`;
    const m = fakeModel({ wrongFirst: false });
    const r = await briefRun(tx, w.run, { orgId: w.org, model: "fake-model-1", system: "s", write: m.write });
    assert.deepEqual([r.outcome, r.attempts, m.repairs], ["validated", 1, [undefined]]);
    const [row] = await tx`select outcome, error, validated_output is not null as has_output, model_version from briefing_runs where id = ${r.briefingRunIds[0]!}`;
    assert.deepEqual([row!["outcome"], row!["error"], row!["has_output"], row!["model_version"]], ["validated", null, true, "fake-model-1"]);
    const checks = await tx`select validator, result from validation_runs where briefing_run_id = ${r.briefingRunIds[0]!} order by created_at`;
    assert.equal(checks.length, 11);
    assert.ok(checks.every((c) => c["result"] === "pass"));
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
});

test("a failing first answer gets one repair; both attempts are recorded; org B sees none of it", async () => {
  await owner.begin(async (tx) => {
    const a = await world(tx, "a");
    const b = await world(tx, "b");
    await tx`set local role app_role`;
    await tx`select set_config('app.org_id', ${a.org}, true)`;
    const m = fakeModel({ wrongFirst: true });
    const r = await briefRun(tx, a.run, { orgId: a.org, model: "fake-model-1", system: "s", write: m.write });
    assert.deepEqual([r.outcome, r.attempts], ["validated", 2]);
    assert.match(m.repairs[1]!.join(" "), /status_echo must be exactly "revise_scenario"/);
    const rows = await tx`select outcome, error from briefing_runs where feasibility_run_id = ${a.run} order by created_at`;
    assert.deepEqual(rows.map((x) => x["outcome"]), ["fallback", "validated"]);
    assert.match(rows[0]!["error"] as string, /validators failed: status_lock/);
    const [lock] = await tx`select effect from validation_runs where briefing_run_id = ${r.briefingRunIds[0]!} and validator = 'status_lock'`;
    assert.equal(lock!["effect"], "brief_failed");
    await tx`select set_config('app.org_id', ${b.org}, true)`;
    const [{ n }] = await tx`select count(*)::int as n from briefing_runs where feasibility_run_id = ${a.run}`;
    const [{ m: v }] = await tx`select count(*)::int as m from validation_runs where briefing_run_id = any(${r.briefingRunIds}::uuid[])`;
    assert.deepEqual([n, v], [0, 0], "org B sees none of org A's briefs or checks");
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
});
