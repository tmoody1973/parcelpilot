import { test } from "node:test";
import assert from "node:assert/strict";
import type { FindingStatus, ParcelFacts, RuleCategory, ScenarioInputs, ZoningRule } from "@parcelpilot/contracts";
import { evaluate } from "./evaluate.ts";
import { LB1_RULES, V1_CATEGORIES } from "./fixtures/lb1.ts";

const parcel: ParcelFacts = { lot_area_sqft: 7000, lot_area_suspect: false, base_zoning: ["LB1"], planned_development: [], overlays: [], special_districts: [], floodplain: [], gis_ambiguity: false, attributes: {} };
const ok: ScenarioInputs = { use: "multifamily", units: 5, stories: 3, height_ft: 44, setback_front_ft: 5, setback_side_ft: 0, setback_rear_ft: 10, ground_floor_use: "retail" };
const DATE = "2026-09-21";

// An always-active footnote the engine cannot test → verify, for any category.
const unevaluable = (r: ZoningRule): ZoningRule => ({ ...r, conditions: [{ id: "corner_lot", description: "Corner lots differ.", evaluable: false, effect: { status: "verify" }, citation: r.citations[0]! }] });

function run(category: RuleCategory, scenario: ScenarioInputs, opts: { rules?: ZoningRule[]; parcel?: ParcelFacts } = {}) {
  const out = evaluate({ parcel: opts.parcel ?? parcel, scenario, rules: opts.rules ?? LB1_RULES, categories_in_scope: [category], analysis_date: DATE });
  return out.findings[0]!;
}

// Per category: the scenario or rule tweak that produces each status. `null` = unreachable by design.
const CASES: Record<(typeof V1_CATEGORIES)[number], Record<FindingStatus, (() => ReturnType<typeof run>) | null>> = {
  use: {
    pass: () => run("use", ok),
    fail: () => run("use", { ...ok, use: "adult_retail" }),
    unknown: () => run("use", { ...ok, use: "data_center" }),
    verify: () => run("use", { ...ok, ground_floor_use: "residential" }),
    insufficient_evidence: null, // `use` is a required scenario field; it cannot be missing
  },
  height: {
    pass: () => run("height", ok),
    fail: () => run("height", { ...ok, height_ft: 46 }),
    unknown: () => run("height", ok, { rules: LB1_RULES.filter((r) => r.category !== "height") }),
    verify: () => run("height", ok, { rules: LB1_RULES.map((r) => (r.category === "height" ? unevaluable(r) : r)) }),
    insufficient_evidence: () => run("height", { ...ok, height_ft: undefined }),
  },
  setback_front: {
    pass: () => run("setback_front", ok),
    fail: () => run("setback_front", { ...ok, setback_front_ft: 80 }),
    unknown: () => run("setback_front", ok, { rules: LB1_RULES.filter((r) => r.category !== "setback_front") }),
    verify: () => run("setback_front", ok, { rules: LB1_RULES.map((r) => (r.category === "setback_front" ? unevaluable(r) : r)) }),
    insufficient_evidence: () => run("setback_front", { ...ok, setback_front_ft: undefined }),
  },
  setback_side: {
    pass: () => run("setback_side", ok),
    fail: () => run("setback_side", ok, { rules: LB1_RULES.map((r) => (r.id === "lb1-side-min-v1" ? { ...r, params: { min_ft: 5 } } : r)) }),
    unknown: () => run("setback_side", ok, { rules: LB1_RULES.filter((r) => r.category !== "setback_side") }),
    verify: () => run("setback_side", ok, { rules: LB1_RULES.map((r) => (r.category === "setback_side" ? unevaluable(r) : r)) }),
    insufficient_evidence: () => run("setback_side", { ...ok, setback_side_ft: undefined }),
  },
  setback_rear: {
    pass: () => run("setback_rear", ok),
    fail: () => run("setback_rear", ok, { rules: LB1_RULES.map((r) => (r.id === "lb1-rear-min-v1" ? { ...r, params: { min_ft: 15 } } : r)) }),
    unknown: () => run("setback_rear", ok, { rules: LB1_RULES.filter((r) => r.category !== "setback_rear") }),
    verify: () => run("setback_rear", ok, { rules: LB1_RULES.map((r) => (r.category === "setback_rear" ? unevaluable(r) : r)) }),
    insufficient_evidence: () => run("setback_rear", { ...ok, setback_rear_ft: undefined }),
  },
  density: {
    pass: () => run("density", ok),
    fail: () => run("density", { ...ok, units: 24 }),
    unknown: () => run("density", ok, { rules: LB1_RULES.filter((r) => r.category !== "density") }),
    verify: () => run("density", ok, { parcel: { ...parcel, lot_area_suspect: true } }),
    insufficient_evidence: () => run("density", { ...ok, units: undefined }),
  },
};

for (const category of V1_CATEGORIES) {
  for (const status of ["pass", "fail", "unknown", "verify", "insufficient_evidence"] as const) {
    const make = CASES[category][status];
    test(`${category} → ${status}${make ? "" : " (unreachable by design)"}`, () => {
      if (!make) return;
      const f = make();
      assert.equal(f.status, status);
      assert.equal(f.category, category);
      if (status === "pass" || status === "fail") {
        assert.ok(f.rule_id && f.rule_version, "settled finding names its rule");
        assert.ok(f.citations.length >= 1, "settled finding carries a citation");
        assert.ok(f.proposed && f.allowed, "settled finding shows proposed vs allowed");
        assert.equal(f.confidence, "high");
      } else {
        assert.equal(f.confidence, "low");
        assert.ok(f.reason, "non-settled finding states a reason");
      }
      if (status === "insufficient_evidence") assert.ok(f.missing_inputs.length >= 1 && f.reason?.startsWith("missing_input:"));
      if (status === "unknown") assert.ok(f.reason?.startsWith("no_rule"));
      if (status === "verify") assert.match(f.reason!, /^(condition_unevaluable:|fact_suspect:|use_label:)/);
    });
  }
}

test("use label L (limited) is verify, never pass; N is fail", () => {
  assert.equal(run("use", { ...ok, use: "retail" }).reason, "use_label:L");
  assert.equal(run("use", { ...ok, use: "adult_retail" }).allowed?.value, "N");
});

test("an evaluable condition overrides a param and lowers confidence to medium", () => {
  const rules = LB1_RULES.map((r): ZoningRule => (r.id === "lb1-height-max-v1"
    ? { ...r, conditions: [{ id: "adjacent_residential", description: "Lower cap next to residential.", when: { fact: "parcel.attributes.adjacent_residential", op: "==", value: true }, evaluable: true, effect: { param: "max_ft", value: 40 }, citation: r.citations[0]! }] }
    : r));
  const f = run("height", ok, { rules, parcel: { ...parcel, attributes: { adjacent_residential: true } } });
  assert.equal(f.status, "fail"); // 44 > 40
  assert.equal(f.allowed?.value, 40);
  assert.equal(f.confidence, "medium");
  const inactive = run("height", ok, { rules, parcel: { ...parcel, attributes: { adjacent_residential: false } } });
  assert.equal(inactive.status, "pass");
  const unknownFact = run("height", ok, { rules });
  assert.equal(unknownFact.status, "verify");
  assert.equal(unknownFact.reason, "condition_unevaluable:adjacent_residential");
});
