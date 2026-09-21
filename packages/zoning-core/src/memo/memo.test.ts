import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, MemoInput } from "@parcelpilot/contracts";
import { renderMemo } from "./render.ts";
import { validateMemo } from "./validate.ts";

// The demo parcel with the G01 concept, exactly as a locked run would hand it over (ids fixed for determinism).
const SUB6 = "198a9062664ed8499838570152f0111392dd126366a4950b0dd3e28f32362f24";
const design = { citation_id: "c-design", document_id: SUB6, page: 16, printed_page: 824, section: "295-605-2", table: "Table 295-605-2" };
const useTable = { citation_id: "c-use", document_id: SUB6, page: 2, printed_page: 812, section: "295-603-1", table: "Table 295-603-1" };
const f = (category: Finding["category"], status: Finding["status"], criticality: Finding["criticality"], extra: Partial<Finding> = {}): Finding =>
  ({ category, status, criticality, calculation_ids: [], citations: [], missing_inputs: [], confidence: status === "pass" || status === "fail" ? "high" : "low", ...extra });

export const G01_MEMO: MemoInput = {
  version: "memo_input.v1",
  run: { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-21T21:00:00.000Z", locked_at: "2026-09-21T21:00:00.000Z", analysis_date: "2026-09-21", decision_mode: "rules_only", rules_engine_version: "0.1.0" },
  decision: { final_status: "revise_scenario", route: "revise_scenario", risk: "high", reasons: ["O3:critical_or_high_fail"], triggers: [], policy_flags: { deterministic_critical_fail: true, special_district_detected: false, missing_required_input: false, gis_ambiguity: false } },
  coverage: { checked: ["use", "height", "setback_front", "setback_side", "setback_rear", "density"], manual_review: [], unknown: ["parking", "lot_coverage"] },
  evidence: { citation_validator_passed: true, active_code_version: true, conflicting_sources: false, stale_facts: false, problems: [] },
  findings: [
    f("use", "pass", "critical", { rule_id: "r-use", rule_version: 1, proposed: { value: "multifamily", source: "scenario" }, allowed: { value: "Y", operator: "in" }, citations: [useTable] }),
    f("height", "fail", "critical", { rule_id: "r-h", rule_version: 1, proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" }, citations: [design] }),
    f("setback_front", "pass", "high", { rule_id: "r-f", rule_version: 1, proposed: { value: 5, unit: "ft", source: "scenario" }, allowed: { value: 70, unit: "ft", operator: "<=" }, citations: [design] }),
    f("setback_side", "pass", "high", { rule_id: "r-s", rule_version: 1, proposed: { value: 0, unit: "ft", source: "scenario" }, allowed: { value: 0, unit: "ft", operator: ">=" }, citations: [design] }),
    f("setback_rear", "pass", "high", { rule_id: "r-r", rule_version: 1, proposed: { value: 10, unit: "ft", source: "scenario" }, allowed: { value: 0, unit: "ft", operator: ">=" }, citations: [design] }),
    f("density", "fail", "high", { rule_id: "r-d", rule_version: 1, proposed: { value: 28800, unit: "sq ft", source: "scenario" }, allowed: { value: 7000, unit: "sq ft", operator: "<=" }, citations: [design] }),
    f("parking", "unknown", "medium", { reason: "no_rule" }),
    f("lot_coverage", "unknown", "medium", { reason: "no_rule" }),
  ],
  scenario: { name: "Demo concept (G01)", inputs: { use: "multifamily", units: 24, stories: 4, height_ft: 46, footprint_sqft: 5200, setback_front_ft: 5, setback_side_ft: 0, setback_rear_ft: 10, parking_spaces: 12, ground_floor_use: "retail", ground_floor_commercial_sqft: 3000 } },
  parcel: { taxkey: "2050114000", address: "4843 N GREEN BAY AV", lot_area_sqft: 7000, lot_area_suspect: false, base_zoning: ["LB1"], overlays: [], special_districts: [], planned_development: [], floodplain: [], gis_ambiguity: false, retrieved_at: "2026-09-21T20:00:00.000Z", snapshot_id: "22222222-2222-4222-8222-222222222222" },
  provenance: { gis_layer_snapshot_ids: ["33333333-3333-4333-8333-333333333333"], rule_version_set: { "lb1-height-max": "44444444-4444-4444-8444-444444444444" }, input_hash: "95a56ab35c6f0000000000000000000000000000000000000000000000000000" },
  sources: { [SUB6]: { title: "Chapter 295 Subchapter 6 — Commercial Districts", published_marker: "7/15/2025", status: "active", official_url: null } },
  project: { name: "4843 N GREEN BAY AV" },
};

const golden = join(import.meta.dirname, "__golden__", "g01.html");

test("golden file: the demo memo renders byte-for-byte the same (UPDATE_GOLDEN=1 to regenerate)", () => {
  const html = renderMemo(G01_MEMO);
  if (process.env["UPDATE_GOLDEN"] || !existsSync(golden)) writeFileSync(golden, html);
  assert.equal(html, readFileSync(golden, "utf8"), "memo output changed; review the diff and rerun with UPDATE_GOLDEN=1 if intended");
});

test("the demo memo carries every required section and passes all validators", () => {
  const html = renderMemo(G01_MEMO);
  for (const s of ["Preliminary zoning screen — not an official zoning determination.", "Revise scenario", "Next action", "Parcel facts", "Scenario", "Findings", "Not covered by this screen", "Routing triggers", "Provenance"]) assert.ok(html.includes(s), s);
  assert.ok(html.includes("Table 295-605-2, p. 824") && html.includes("Table 295-603-1, p. 812"), "citations show table and printed page");
  assert.ok(html.includes("28,800 sq ft") && html.includes("&lt;= 7,000 sq ft"), "density proposed vs allowed");
  assert.ok(html.includes("Not checked at all (no reviewed rule yet): Parking, Lot coverage."));
  assert.ok(html.includes("Checked 6 of 8 categories"));
  assert.ok(html.includes("stamp 7/15/2025"));
  assert.deepEqual(validateMemo(html, G01_MEMO), { passed: true, problems: [] });
});

test("validators reject a verdict word, a number not in the run, and a page not cited", () => {
  const html = renderMemo(G01_MEMO);
  assert.deepEqual(validateMemo(html.replace("Revise scenario", "This project is approved by right"), G01_MEMO).problems, ["banned_phrase:approved", "banned_phrase:by right"]); // banned-ok: the validator under test
  assert.deepEqual(validateMemo(html.replace("28,800 sq ft", "29,000 sq ft"), G01_MEMO).problems, ["numeric_alignment:29000"]);
  assert.deepEqual(validateMemo(html.replace("p. 824", "p. 999"), G01_MEMO).problems, ["numeric_alignment:999", "citation_membership:p.999"]);
});

test("renders every status and the abstention actions without a verdict word", () => {
  for (const status of ["proceed_to_concept_design", "verify_before_committing", "insufficient_evidence"] as const) {
    const input: MemoInput = { ...G01_MEMO, decision: { ...G01_MEMO.decision, final_status: status, route: status === "insufficient_evidence" ? "collect_missing_information" : status === "verify_before_committing" ? "contact_city" : "proceed_to_concept_design", risk: status === "insufficient_evidence" ? null : "low", triggers: status === "verify_before_committing" ? ["special_district:NORTH 27TH - WEST FOND DU LAC"] : [] } };
    const html = renderMemo(input);
    const v = validateMemo(html, input);
    assert.ok(v.passed, `${status}: ${v.problems.join(", ")}`);
    if (status === "insufficient_evidence") assert.ok(html.includes("Collect the missing information") && html.includes("Contact the Department of City Development"));
    if (status === "verify_before_committing") assert.ok(html.includes("Special district: NORTH 27TH - WEST FOND DU LAC"));
  }
});
