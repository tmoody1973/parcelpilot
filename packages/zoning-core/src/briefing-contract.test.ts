import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_POLICY_V1, type EvidenceBundle, type EvidenceItem, type Finding } from "@parcelpilot/contracts";
import { allowedNextActions, briefingContractHash, buildBriefingContract, type BriefingRunRecord } from "./briefing-contract.ts";
import { writeBrief } from "./briefing-client.ts";

const SHA = "d".repeat(64);
const item = (n: number, category: string, section: string, reason: string, text: string): EvidenceItem => ({
  source_id: `fam-${n}@1`, chunk_id: `c${n}`, official_url: "https://example.test/sub6.pdf", document_title: "Subchapter 6", document_sha256: SHA,
  section, page: 16, printed_page: 14, anchors: [{ page: 16 }], verbatim_excerpt: text, status: "active", category: category as never,
  subquestion: "q", required_context_type: null, selection_reason: reason, rank: n, footnote_markers: [], token_count: 10,
});
const bundle: EvidenceBundle = {
  version: "evidence_bundle.v1", run_id: "run1", retrieval_run_ids: ["r"], analysis_date: "2026-09-22", embedding_version_id: null, token_budget: 6000, tokens_used: 30,
  items: [
    item(1, "height", "295-605-2", "signed-off rule row; fused", "Table 295-605-2. Height, maximum (ft.). LB1: 45."),
    item(2, "height", "295-605-2-f", "fused", "Building height is measured from grade."),
    item(3, "use", "295-603", "signed-off rule row; fused", "Multi-family dwelling: Y."),
  ],
  required_context: {}, flags: { active_version_confirmed: true, overlay_detected: false, coverage_gaps: [], dropped_for_budget: 0, refused_inactive: 0 },
};
const f = (category: Finding["category"], status: Finding["status"], extra: Partial<Finding> = {}): Finding =>
  ({ category, status, criticality: "critical", calculation_ids: [], citations: [], missing_inputs: [], confidence: "high", ...extra });
const record = (over: Partial<BriefingRunRecord["run"]> = {}, rest: Partial<BriefingRunRecord> = {}): BriefingRunRecord => ({
  run: { id: "run1", locked_at: "2026-09-22 18:00:00+00", final_status: "revise_scenario", route: "revise_scenario", risk: "high", reasons: ["O3:critical_or_high_fail"], triggers: [], coverage: { checked: ["use", "height"], manual_review: [], unknown: ["parking"] }, ...over },
  parcel: { taxkey: "2050114000", address: "4843 N Green Bay Av", lot_area_sqft: 7000, base_zoning: ["LB1"], retrieved_at: "2026-09-21" },
  scenario: { use: "multifamily", units: 24, height_ft: 46, ground_floor_use: "retail" },
  findings: [
    { finding: f("use", "pass", { citations: [{ document_id: SHA, page: 16, section: "295-603" }] }), calculation_id: "calc-use" },
    { finding: f("height", "fail", { proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" } }), calculation_id: "calc-height" },
  ],
  bundle, jev: { overall_risk: "high", recommended_route: "revise_scenario", confidence: 0.9 },
  ...rest,
});

test("a brief is refused for a run that is not locked", () => {
  assert.throws(() => buildBriefingContract(record({ locked_at: null }), DECISION_POLICY_V1), /not locked/);
});

test("the contract's corpus text is exactly the frozen bundle's excerpts, and findings cite them", () => {
  const c = buildBriefingContract(record(), DECISION_POLICY_V1);
  const bundleText = new Set(bundle.items.map((i) => i.verbatim_excerpt));
  assert.equal(c.evidence_bundle.length, bundle.items.length);
  for (const e of c.evidence_bundle) assert.ok(bundleText.has(e.verbatim_excerpt), `excerpt ${e.source_id} is verbatim from the bundle`);
  const ids = new Set(c.evidence_bundle.map((e) => e.source_id));
  for (const vf of c.verified_findings) for (const s of vf.source_ids) assert.ok(ids.has(s), `${vf.finding_id} cites only bundle ids`);
  assert.deepEqual(c.verified_findings.map((v) => [v.finding_id, v.category, v.proposed, v.allowed, v.calculation_id, v.source_ids]), [
    ["f1", "use", null, null, "calc-use", ["fam-3@1"]], // matched by its own citation
    ["f2", "height", "46 ft", "≤ 45 ft", "calc-height", ["fam-1@1"]], // no citation: the signed-off rule row pinned for height
  ]);
  assert.deepEqual([c.final_decision.status, c.jev_decision?.may_not_override_policy, c.unknown_or_unsupported_categories, c.required_disclaimer], ["revise_scenario", true, ["parking"], "Preliminary zoning screen — not an official zoning determination."]);
});

test("no bundle means no corpus text, and the hash is stable under key order", () => {
  const c = buildBriefingContract(record({}, { bundle: null, jev: null }), DECISION_POLICY_V1);
  assert.deepEqual([c.evidence_bundle, c.verified_findings[1]!.source_ids, c.jev_decision], [[], [], null]);
  const a = buildBriefingContract(record(), DECISION_POLICY_V1);
  const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
  assert.equal(briefingContractHash(reordered), briefingContractHash(a));
  assert.match(briefingContractHash(a), /^[0-9a-f]{64}$/);
});

test("allowed next actions follow decision 013, and insufficient evidence allows only the status list", () => {
  const p = DECISION_POLICY_V1;
  assert.deepEqual(allowedNextActions(p, { status: "verify_before_committing", triggers: ["overlay:SPROZ"], findings: [f("parking", "verify")] }),
    ["engage_zoning_professional", "request_early_city_zoning_review", "contact_city", "confirm_parking_configuration"]);
  assert.deepEqual(allowedNextActions(p, { status: "insufficient_evidence", triggers: ["overlay:SPROZ"], findings: [f("height", "insufficient_evidence", { missing_inputs: ["height_ft"] })] }),
    ["collect_missing_information", "contact_city"]);
  assert.deepEqual(allowedNextActions(p, { status: "revise_scenario", triggers: [], findings: [f("height", "insufficient_evidence", { missing_inputs: ["height_ft"] })] }),
    ["revise_scenario", "engage_zoning_professional", "collect_missing_information"]);
});

// A stand-in for the SDK client: only messages.parse is used.
const fakeClient = (reply: unknown) => ({ messages: { parse: async () => { if (reply instanceof Error) throw reply; return reply; } } }) as never;
const okOutput = { contract_hash: "a".repeat(64), status_echo: "revise_scenario", executive_summary: [], status_explanation: [], verified_findings: [], open_questions: [], suggested_actions: [], questions_for_experts: [], disclaimer: "d" };
const response = (over: Record<string, unknown> = {}) => ({ model: "claude-sonnet-5", stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 8000, output_tokens: 2000 }, content: [{ type: "text", text: JSON.stringify(okOutput) }], parsed_output: okOutput, ...over });

test("the client prices a complete answer and fails on refusal, truncation, missing output or an unknown model", async () => {
  const contract = buildBriefingContract(record(), DECISION_POLICY_V1);
  const base = { contract, contractHash: "a".repeat(64), system: "s", model: "claude-sonnet-5" };
  const ok = await writeBrief({ ...base, client: fakeClient(response()) });
  assert.equal(ok.status, "ok");
  if (ok.status === "ok") assert.ok(Math.abs(ok.costUsd - (8000 * 2 + 2000 * 10) / 1e6) < 1e-12, "priced at $2 / $10 per Mtok");
  for (const [over, re] of [[{ stop_reason: "refusal", stop_details: { category: "cyber" } }, /refusal:cyber/], [{ stop_reason: "max_tokens" }, /max_tokens/], [{ parsed_output: null }, /no parseable output/]] as const) {
    const r = await writeBrief({ ...base, client: fakeClient(response(over)) });
    assert.equal(r.status, "failed");
    if (r.status === "failed") { assert.match(r.error, re); assert.ok(r.raw !== null, "raw text kept for the log"); }
  }
  const thrown = await writeBrief({ ...base, client: fakeClient(new Error("socket hang up")) });
  assert.deepEqual([thrown.status, thrown.status === "failed" && /socket hang up/.test(thrown.error)], ["failed", true]);
  const unknown = await writeBrief({ ...base, model: "claude-opus-5", client: fakeClient(response()) });
  assert.equal(unknown.status, "failed", "only the two evaluated models are callable");
});
