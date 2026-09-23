import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_POLICY_V1, briefingOutputSchemaFor, type BriefingOutput } from "@parcelpilot/contracts";
import { briefingContractHash, buildBriefingContract, type BriefingRunRecord } from "./briefing-contract.ts";
import { repairNotes, writeValidatedBrief } from "./briefing-pipeline.ts";
import type { BriefingCall } from "./briefing-client.ts";

const record: BriefingRunRecord = {
  run: { id: "r1", locked_at: "2026-09-22", final_status: "revise_scenario", route: "revise_scenario", risk: "high", reasons: [], triggers: [], coverage: { checked: ["height"], manual_review: [], unknown: ["parking"] } },
  parcel: { taxkey: "1", address: null, lot_area_sqft: 7000, base_zoning: ["LB1"], retrieved_at: null }, scenario: { use: "multifamily", height_ft: 46, ground_floor_use: "retail" },
  findings: [{ finding: { category: "height", status: "fail", criticality: "critical", calculation_ids: [], citations: [], missing_inputs: [], confidence: "high", proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" } }, calculation_id: "c1" }],
  bundle: null, jev: null,
};
const contract = buildBriefingContract(record, DECISION_POLICY_V1);
const hash = briefingContractHash(contract);
const brief = (over: Partial<BriefingOutput> = {}): BriefingOutput => ({
  contract_hash: hash, status_echo: "revise_scenario", executive_summary: [{ text: "Revise the scenario.", kind: "framing", source_ids: [] }], status_explanation: [],
  verified_findings: [{ finding_id: "f1", sentences: [{ text: "The height is over the limit.", kind: "framing", source_ids: [] }] }],
  open_questions: [], suggested_actions: [{ action_id: "revise_scenario", rationale: { text: "Lower the building.", kind: "advice", source_ids: [] } }], questions_for_experts: [], disclaimer: contract.required_disclaimer, ...over,
});
const ok = (b: BriefingOutput): BriefingCall => ({ status: "ok", output: b, raw: JSON.stringify(b), model: "m", usage: { input_tokens: 1, output_tokens: 1 }, latencyMs: 1, costUsd: 0 });

test("a valid first answer is validated with no repair call", async () => {
  const calls: Array<string[] | undefined> = [];
  const r = await writeValidatedBrief({ contract, contractHash: hash, write: async (repair) => { calls.push(repair); return ok(brief()); } });
  assert.deepEqual([r.outcome, r.attempts.length, calls], ["validated", 1, [undefined]]);
});

test("a failing answer gets exactly one repair call carrying the reasons; a good repair is validated", async () => {
  const calls: Array<string[] | undefined> = [];
  const answers = [brief({ status_echo: "proceed_to_concept_design" }), brief()];
  const r = await writeValidatedBrief({ contract, contractHash: hash, write: async (repair) => { calls.push(repair); return ok(answers[calls.length - 1]!); } });
  assert.deepEqual([r.outcome, r.attempts.length], ["validated", 2]);
  assert.match(calls[1]!.join(" "), /status_echo must be exactly "revise_scenario"/);
});

test("two failing answers fall back; an API failure is not repaired; a non-parsing answer is validated as a schema failure", async () => {
  const bad = await writeValidatedBrief({ contract, contractHash: hash, write: async () => ok(brief({ status_echo: "proceed_to_concept_design" })) });
  assert.deepEqual([bad.outcome, bad.attempts.length], ["fallback", 2]);
  let n = 0;
  const api = await writeValidatedBrief({ contract, contractHash: hash, write: async () => { n++; return { status: "failed", error: "API 529", raw: null, model: null, usage: null, latencyMs: 1, costUsd: null }; } });
  assert.deepEqual([api.outcome, n, api.final.validation], ["fallback", 1, null]);
  const garbled = await writeValidatedBrief({ contract, contractHash: hash, maxRepairs: 0, write: async () => ({ status: "failed", error: "no parseable output", raw: JSON.stringify({ status_echo: "maybe" }), model: "m", usage: null, latencyMs: 1, costUsd: null }) });
  assert.equal(garbled.final.validation?.runs[0]?.effect, "brief_failed");
});

test("repair notes are specific to what failed", () => {
  const notes = repairNotes(contract, [{ validator: "numeric_alignment", result: "fail", effect: "sentence_removed", removed_sentence_ids: ["open_questions[0]"], detail: { numbers: ["32000"] } }]);
  assert.match(notes[0]!, /32000.*never compute/);
});

test("the per-contract schema admits only this contract's ids, actions, hash and status", () => {
  const schema = briefingOutputSchemaFor(contract, hash);
  assert.equal(schema.safeParse(brief()).success, true);
  assert.equal(schema.safeParse(brief({ status_echo: "proceed_to_concept_design" })).success, false);
  assert.equal(schema.safeParse(brief({ suggested_actions: [{ action_id: "hire_a_lawyer", rationale: { text: "x", kind: "advice", source_ids: [] } }] })).success, false);
  assert.equal(schema.safeParse(brief({ verified_findings: [{ finding_id: "f9", sentences: [] }] })).success, false);
  assert.equal(schema.safeParse(brief({ open_questions: [{ text: "x", kind: "fact", source_ids: ["fam-1@1"] }] })).success, false, "no bundle, so no source id is legal");
  const ie = buildBriefingContract({ ...record, run: { ...record.run, final_status: "insufficient_evidence", route: "collect_missing_information" } }, DECISION_POLICY_V1);
  const ieSchema = briefingOutputSchemaFor(ie, briefingContractHash(ie));
  assert.equal(ieSchema.safeParse({ ...brief(), contract_hash: briefingContractHash(ie), status_echo: "insufficient_evidence", suggested_actions: [], executive_summary: [{ text: "x", kind: "finding", source_ids: [] }] }).success, false, "no finding sentences when abstaining");
});
