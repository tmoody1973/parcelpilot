import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_POLICY_V1 } from "@parcelpilot/contracts";
import { buildBriefingContract, type BriefingRunRecord } from "./briefing-contract.ts";
import { BRIEFING_OUTPUT_STRICT_SCHEMA, writeBriefOpenRouter } from "./briefing-openrouter.ts";

const record: BriefingRunRecord = {
  run: { id: "r", locked_at: "2026-09-22", final_status: "revise_scenario", route: "revise_scenario", risk: "high", reasons: [], triggers: [], coverage: { checked: [], manual_review: [], unknown: [] } },
  parcel: { taxkey: "1", address: null, lot_area_sqft: null, base_zoning: ["LB1"], retrieved_at: null }, scenario: { use: "multifamily", ground_floor_use: "retail" }, findings: [], bundle: null, jev: null,
};
const contract = buildBriefingContract(record, DECISION_POLICY_V1);
const out = { contract_hash: "a".repeat(64), status_echo: "revise_scenario", executive_summary: [{ text: "Preliminary.", kind: "framing", source_ids: [], numbers: null }], status_explanation: [], verified_findings: [], open_questions: [], suggested_actions: [], questions_for_experts: [], disclaimer: "d" };
function stub(status: number, body: unknown) {
  const calls: Array<Record<string, any>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => { calls.push(JSON.parse(init.body as string)); return new Response(typeof body === "string" ? body : JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
const reply = (content: unknown, finish = "stop") => ({ model: "openai/gpt-6-luna-20260922", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: finish }], usage: { prompt_tokens: 26000, completion_tokens: 4000 } });

test("the strict schema lists every property as required and closes every object", () => {
  const walk = (s: any, path: string): void => {
    if (s.type === "object") { assert.equal(s.additionalProperties, false, `${path} closed`); assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} all required`); for (const [k, v] of Object.entries(s.properties)) walk(v, `${path}.${k}`); }
    if (s.type === "array") walk(s.items, `${path}[]`);
    for (const a of s.anyOf ?? []) walk(a, path);
    assert.equal(s.maxLength, undefined, `${path} has no maxLength (checked after parse)`);
  };
  walk(BRIEFING_OUTPUT_STRICT_SCHEMA, "$");
});

test("one request with the strict schema and no-retention routing; nulls stripped; priced from usage", async () => {
  const s = stub(200, reply(out));
  const r = await writeBriefOpenRouter({ contract, contractHash: "a".repeat(64), system: "sys", model: "openai/gpt-6-luna", apiKey: "k", fetchImpl: s.fetchImpl });
  assert.equal(r.status, "ok");
  const body = s.calls[0]!;
  assert.deepEqual([body["model"], body["response_format"].type, body["response_format"].json_schema.strict, body["provider"]], ["openai/gpt-6-luna", "json_schema", true, { require_parameters: true, data_collection: "deny", zdr: true }]);
  assert.equal(body["messages"][0].content, "sys");
  if (r.status === "ok") {
    assert.equal(r.model, "openai/gpt-6-luna-20260922", "the served model is recorded verbatim");
    assert.equal(r.output.executive_summary[0]!.numbers, undefined, "a null optional field is dropped before parsing");
    assert.ok(Math.abs(r.costUsd - (26000 * 0.1 + 4000 * 0.5) / 1e6) < 1e-12);
  }
});

test("HTTP errors, truncation, non-JSON, schema-invalid output, no key and unknown models are failures", async () => {
  const base = { contract, contractHash: "a".repeat(64), system: "s", model: "google/gemini-3.8-flash", apiKey: "k" };
  const cases: Array<[ReturnType<typeof stub>, RegExp]> = [
    [stub(404, { error: { message: "No endpoints found that support the requested parameters" } }), /HTTP 404/],
    [stub(200, reply(out, "length")), /max_tokens/],
    [stub(200, reply("not json")), /no parseable output/],
    [stub(200, reply({ ...out, status_echo: "approved" })), /schema-invalid.*status_echo/],
  ];
  for (const [s, re] of cases) {
    const r = await writeBriefOpenRouter({ ...base, fetchImpl: s.fetchImpl });
    assert.equal(r.status, "failed");
    if (r.status === "failed") assert.match(r.error, re);
  }
  const noKey = stub(200, reply(out));
  assert.equal((await writeBriefOpenRouter({ ...base, apiKey: undefined, fetchImpl: noKey.fetchImpl })).status, "failed");
  assert.equal(noKey.calls.length, 0);
  assert.equal((await writeBriefOpenRouter({ ...base, model: "deepseek/deepseek-v4.1-flash", fetchImpl: noKey.fetchImpl })).status, "failed");
});
