import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase, ZoningRule, type Coverage, type ParcelFacts, type PolicyInput, type RuleCategory, type ZoningRule as Rule } from "@parcelpilot/contracts";
import { evaluate } from "@parcelpilot/rules-engine";
import { checkCitations } from "./citation-gate.ts";
import { finalStatus } from "./policy.ts";

// MOO-817: every gold case is the reviewer's answer key (PRD §9.2). This runs each one through the exact
// chain a live run uses (engine → citation gate → policy) against the seeded rule data and asserts an exact
// match. No database, no clock: the analysis date is fixed to the day the cases were drafted.
const ANALYSIS_DATE = "2026-09-21";
const ALL: RuleCategory[] = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"];
const goldDir = join(import.meta.dirname, "..", "..", "contracts", "gold");
const rulesDir = join(import.meta.dirname, "..", "..", "contracts", "rules");
const RULES: Rule[] = readdirSync(rulesDir).filter((f) => f.endsWith(".json")).flatMap((f) => (JSON.parse(readFileSync(join(rulesDir, f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r)));
const cases = readdirSync(goldDir).filter((f) => f.endsWith(".json")).sort().map((f) => GoldCase.parse(JSON.parse(readFileSync(join(goldDir, f), "utf8"))));

test("the gold set has at least 50 cases and the rule data covers their districts", () => {
  assert.ok(cases.length >= 50, `${cases.length} cases`);
  const districts = new Set(RULES.map((r) => r.district_code));
  for (const c of cases) for (const d of c.parcel.base_zoning) if (c.parcel.source === "real" || c.district === d) assert.ok(districts.has(d) || d === "RT4" || d === "RS6", `${c.id}: no rules for ${d}`);
});

for (const c of cases) {
  test(`${c.id} ${c.title}`, () => {
    const parcel: ParcelFacts = { lot_area_sqft: c.parcel.lot_area_sqft, lot_area_suspect: c.parcel.lot_area_suspect, base_zoning: c.parcel.base_zoning, planned_development: [], overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, attributes: {} };
    const policyParcel: PolicyInput["parcel"] = { overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, planned_development: [], floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, stacked_condo_candidates: c.parcel.stacked_condo_candidates };
    const e = c.expected;

    if (e.pre_run_block) {
      // A blocked run never evaluates; coverage is all unknown and the policy abstains.
      const coverage: Coverage = { checked: [], manual_review: [], unknown: ALL };
      const r = finalStatus({ findings: [], coverage, evidence: { citation_validator_passed: true, active_code_version: true, conflicting_sources: false, stale_facts: false, problems: [] }, parcel: policyParcel, pre_run_block: e.pre_run_block, decision_mode: "rules_only" });
      assert.deepEqual([r.final_status, r.route, r.reasons, r.triggers, r.policy_flags], [e.final_status, e.route, e.reasons, e.triggers, e.policy_flags]);
      assert.deepEqual(coverage, e.coverage);
      return;
    }

    const out = evaluate({ parcel, scenario: c.scenario, rules: RULES, categories_in_scope: ALL, analysis_date: ANALYSIS_DATE });
    const shas = [...new Set(RULES.flatMap((r) => [...r.citations, ...r.conditions.map((x) => x.citation)]).map((x) => x.document_id))];
    // G15: the cited source is superseded → the gate fails closed. Every other case: sources active.
    const sources = Object.fromEntries(shas.map((sha) => [sha, { status: e.evidence.active_code_version ? "active" as const : "superseded" as const, effective_start: null, effective_end: null }]));
    const evidence = checkCitations({ findings: out.findings, sources, rules: Object.fromEntries(RULES.map((r) => [r.id, { status: r.status }])), analysis_date: ANALYSIS_DATE });
    assert.equal(evidence.citation_validator_passed, e.evidence.citation_validator_passed, `${c.id} citation_validator_passed`);
    assert.equal(evidence.active_code_version, e.evidence.active_code_version, `${c.id} active_code_version`);

    const byCat = Object.fromEntries(out.findings.map((f) => [f.category, f]));
    for (const [cat, exp] of Object.entries(e.findings)) {
      const got = byCat[cat];
      assert.ok(got, `${c.id} ${cat}: no finding`);
      assert.equal(got.status, exp!.status, `${c.id} ${cat} status`);
      assert.equal(got.criticality, exp!.criticality, `${c.id} ${cat} criticality`);
      const strip = (v: { value: number | string; unit?: string | undefined; operator?: string } | undefined) => (v ? { value: v.value, ...(v.unit ? { unit: v.unit } : {}), ...(v.operator ? { operator: v.operator } : {}) } : undefined);
      assert.deepEqual(strip(got.proposed), strip(exp!.proposed), `${c.id} ${cat} proposed`);
      assert.deepEqual(strip(got.allowed), strip(exp!.allowed), `${c.id} ${cat} allowed`);
      if (exp!.reason) assert.equal(got.reason, exp!.reason, `${c.id} ${cat} reason`);
    }
    assert.deepEqual(out.coverage, e.coverage, `${c.id} coverage`);

    const r = finalStatus({ findings: out.findings, coverage: out.coverage, evidence, parcel: policyParcel, decision_mode: "rules_only" });
    assert.equal(r.final_status, e.final_status, `${c.id} final_status`);
    assert.equal(r.route, e.route, `${c.id} route`);
    assert.deepEqual(r.reasons, e.reasons, `${c.id} reasons`);
    assert.deepEqual(r.triggers, e.triggers, `${c.id} triggers`);
    assert.deepEqual(r.policy_flags, e.policy_flags, `${c.id} policy_flags`);
  });
}

// MOO-842: minimum coverage, so no route or category rests on one or two examples. Side and rear setbacks cannot fail
// under the seeded rules (their minimum is 0, "none required"), so they carry no fail minimum.
test("the gold set covers every route and every category that can fail", () => {
  const count = (f: (c: GoldCase) => boolean) => cases.filter(f).length;
  const routes = ["proceed_to_concept_design", "revise_scenario", "contact_city", "engage_zoning_professional", "collect_missing_information", "insufficient_evidence"] as const;
  for (const r of routes) assert.ok(count((c) => c.expected.route === r) >= 3, `route ${r}: ${count((c) => c.expected.route === r)}`);
  assert.ok(count((c) => c.expected.route === "proceed_to_concept_design") >= 12, "at least 12 proceed cases, so precision is measurable");
  for (const cat of ["use", "height", "setback_front", "density"] as const) assert.ok(count((c) => c.expected.findings[cat]?.status === "fail") >= 3, `${cat} fails: ${count((c) => c.expected.findings[cat]?.status === "fail")}`);
  assert.ok(count((c) => c.parcel.source === "real") >= 30, "most cases sit on real parcels");
});
