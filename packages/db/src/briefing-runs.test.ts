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

// MOO-841: the citation-support check through the recorded path. The brief cites the one bundle row in a `code`
// sentence, so there is exactly one (sentence, excerpt) pair to ask about.
async function withBundle(tx: postgres.TransactionSql, w: { org: string; run: string }) {
  const item = { source_id: "fam-1@1", chunk_id: "c1", official_url: null, document_title: "Subchapter 6", document_sha256: "d".repeat(64), section: "295-605-2", page: 16, printed_page: 14,
    anchors: [{ page: 16 }], verbatim_excerpt: "Table 295-605-2. Height, maximum (ft.). LB1: 45.", status: "active", category: "height", subquestion: "q", required_context_type: null,
    selection_reason: "signed-off rule row", rank: 1, footnote_markers: [], token_count: 10 };
  const bundle = { version: "evidence_bundle.v1", run_id: w.run, retrieval_run_ids: [], analysis_date: "2026-09-22", embedding_version_id: null, token_budget: 6000, tokens_used: 10, items: [item],
    required_context: {}, flags: { active_version_confirmed: true, overlay_detected: false, coverage_gaps: [], dropped_for_budget: 0, refused_inactive: 0 } };
  await tx`insert into run_evidence_bundles (org_id, feasibility_run_id, status, retrieval_run_ids, token_budget, bundle, bundle_sha256) values (${w.org}, ${w.run}, 'assembled', array[gen_random_uuid()], 6000, ${tx.json(bundle as never)}, ${"e".repeat(64)})`;
}
const CODE_SENTENCE = "Table 295-605-2 sets a minimum front setback for LB1.";
const citingModel = (() => {
  const m = fakeModel({ wrongFirst: false });
  const write = (async (i: never) => {
    const call = await (m.write as unknown as (x: never) => Promise<BriefingCall & { output: any; raw: string }>)(i);
    const output = { ...call.output, executive_summary: [...call.output.executive_summary, { text: CODE_SENTENCE, kind: "code", source_ids: ["fam-1@1"] }] };
    return { ...call, output, raw: JSON.stringify(output) };
  }) as never;
  return { write };
})();
// Counts every network request made while `fn` runs.
async function countingFetch<T>(fn: () => Promise<T>, answer?: (body: any) => unknown): Promise<{ result: T; requests: number }> {
  const real = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (_: unknown, init: { body: string }) => {
    requests++;
    return new Response(JSON.stringify(answer ? answer(JSON.parse(init.body)) : {}), { status: 200 });
  }) as never;
  try { return { result: await fn(), requests }; } finally { globalThis.fetch = real; }
}

test("citation support off (the default): no JEV request, no citation_support row", async () => {
  await owner.begin(async (tx) => {
    const w = await world(tx, "cs-off");
    await withBundle(tx, w);
    await tx`set local role app_role`;
    await tx`select set_config('app.org_id', ${w.org}, true)`;
    const { result: r, requests } = await countingFetch(() => briefRun(tx, w.run, { orgId: w.org, model: "fake-model-1", system: "s", write: citingModel.write }));
    assert.equal(requests, 0, "request counter");
    assert.equal(r.outcome, "validated");
    const [{ n }] = await tx`select count(*)::int as n from validation_runs where briefing_run_id = ${r.briefingRunIds[0]!} and validator = 'citation_support'`;
    assert.equal(n, 0);
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
});

test("citation support on: one request, the unsupported sentence is removed, a pointer-only review task is written", async () => {
  await owner.begin(async (tx) => {
    const w = await world(tx, "cs-on");
    await withBundle(tx, w);
    await tx`set local role app_role`;
    await tx`select set_config('app.org_id', ${w.org}, true)`;
    const unsure = (body: { model: string; questions: Record<string, unknown> }) => ({
      model: body.model, usage: { input_tokens: 500, output_tokens: 0 },
      answers: Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: "choice", choice: "says_nothing", confidence: 0.55, probabilities: { says_nothing: 0.55, supports: 0.3, contradicts: 0.15 } }])),
    });
    const { result: r, requests } = await countingFetch(() => briefRun(tx, w.run, { orgId: w.org, model: "fake-model-1", system: "s", write: citingModel.write, citationSupport: { apiKey: "k" } }), unsure);
    assert.equal(requests, 1, "all pairs in one request");
    assert.equal(r.outcome, "validated");
    const [brief] = await tx`select validated_output from briefing_runs where id = ${r.briefingRunIds[0]!}`;
    assert.ok(!JSON.stringify(brief!["validated_output"]).includes(CODE_SENTENCE), "sentence removed from the stored brief");
    const [cs] = await tx`select result, effect, removed_sentence_ids, detail from validation_runs where briefing_run_id = ${r.briefingRunIds[0]!} and validator = 'citation_support'`;
    assert.deepEqual([cs!["result"], cs!["effect"], cs!["removed_sentence_ids"]], ["fail", "sentence_removed", ["executive_summary[1]"]]);
    assert.equal((cs!["detail"] as { pairs: unknown[] }).pairs.length, 1, "per-pair answer logged");
    assert.equal(r.reviewTaskIds.length, 1);
    const [task] = await tx`select task_type, entity_type, entity_id, reason from review_tasks where id = ${r.reviewTaskIds[0]!}`;
    assert.deepEqual([task!["task_type"], task!["entity_type"], task!["entity_id"]], ["citation_support_review", "briefing_run", r.briefingRunIds[0]]);
    assert.equal(task!["reason"], "citation_support: executive_summary[1] says_nothing at 0.55");
    assert.ok(!String(task!["reason"]).includes("setback"), "no sentence text in the shared table");
    throw new Rollback();
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
});
