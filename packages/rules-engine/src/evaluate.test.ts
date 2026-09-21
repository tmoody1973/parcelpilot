import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase, ZoningRule, type ParcelFacts, type ScenarioInputs } from "@parcelpilot/contracts";
import { evaluate } from "./evaluate.ts";
import { LB1_RULES, V1_CATEGORIES } from "./fixtures/lb1.ts";

const parcel: ParcelFacts = { lot_area_sqft: 7000, lot_area_suspect: false, base_zoning: ["LB1"], planned_development: [], overlays: [], special_districts: [], floodplain: [], gis_ambiguity: false, attributes: {} };
const ok: ScenarioInputs = { use: "multifamily", units: 5, stories: 3, height_ft: 44, setback_front_ft: 5, setback_side_ft: 0, setback_rear_ft: 10, ground_floor_use: "retail" };
const DATE = "2026-09-21";
const ALL = [...V1_CATEGORIES, "parking", "lot_coverage"] as const;
const goldPath = join(import.meta.dirname, "..", "..", "contracts", "gold");
const gold = (id: string) => GoldCase.parse(JSON.parse(readFileSync(join(goldPath, `${id}.json`), "utf8")));
const factsOf = (p: ReturnType<typeof gold>["parcel"]): ParcelFacts => ({ lot_area_sqft: p.lot_area_sqft, lot_area_suspect: p.lot_area_suspect, base_zoning: p.base_zoning, planned_development: [], overlays: p.overlays, special_districts: p.special_districts, floodplain: p.floodplain, gis_ambiguity: p.gis_ambiguity, attributes: {} });

test("coverage buckets follow finding status; every category in scope appears exactly once", () => {
  const out = evaluate({ parcel, scenario: { ...ok, height_ft: undefined }, rules: LB1_RULES, categories_in_scope: [...ALL], analysis_date: DATE });
  assert.deepEqual(out.coverage, { checked: ["use", "setback_front", "setback_side", "setback_rear", "density"], manual_review: ["height"], unknown: ["parking", "lot_coverage"] });
  assert.equal(out.findings.length, ALL.length);
});

test("two base districts → verify with multiple_districts on every category, no calculations", () => {
  const out = evaluate({ parcel: { ...parcel, base_zoning: ["LB1", "RT4"] }, scenario: ok, rules: LB1_RULES, categories_in_scope: [...V1_CATEGORIES], analysis_date: DATE });
  assert.ok(out.findings.every((f) => f.status === "verify" && f.reason === "multiple_districts"));
  assert.equal(out.calculations.length, 0);
  assert.equal(out.findings.find((f) => f.category === "use")?.criticality, "critical");
});

test("rules for another district, a future start, or an ended version are ignored", () => {
  const foreign = LB1_RULES.map((r) => ({ ...r, district_code: "LB2" }));
  const future = LB1_RULES.map((r) => ({ ...r, effective_start: "2027-01-01" }));
  const ended = LB1_RULES.map((r) => ({ ...r, effective_end: "2026-01-01" }));
  for (const rules of [foreign, future, ended]) {
    const out = evaluate({ parcel, scenario: ok, rules, categories_in_scope: ["height"], analysis_date: DATE });
    assert.equal(out.findings[0]?.status, "unknown");
  }
});

test("a kind under the wrong category or params of the wrong shape are rejected at the boundary", () => {
  const bad = { ...LB1_RULES[1]!, category: "setback_front" };
  assert.throws(() => ZoningRule.parse(bad), /cannot sit under/);
  assert.throws(() => ZoningRule.parse({ ...LB1_RULES[1]!, params: { max_ft: "tall" } }), /params do not match/);
});

test("two rules on one category combine: both pass → pass; one fail → fail with both calculations kept", () => {
  const pass = evaluate({ parcel, scenario: ok, rules: LB1_RULES, categories_in_scope: ["setback_front"], analysis_date: DATE });
  assert.equal(pass.findings[0]?.status, "pass");
  assert.equal(pass.calculations.length, 2);
  const fail = evaluate({ parcel, scenario: { ...ok, setback_front_ft: 75 }, rules: LB1_RULES, categories_in_scope: ["setback_front"], analysis_date: DATE });
  assert.equal(fail.findings[0]?.status, "fail");
  assert.equal(fail.findings[0]?.rule_id, "lb1-front-max-v1");
  assert.deepEqual(fail.findings[0]?.calculation_ids, ["setback_front:lb1-front-min-v1", "setback_front:lb1-front-max-v1"]);
});

test("calculation detail carries the arithmetic path", () => {
  const out = evaluate({ parcel, scenario: { ...ok, units: 24 }, rules: LB1_RULES, categories_in_scope: ["density"], analysis_date: DATE });
  assert.equal(out.calculations[0]?.detail, "density: 24 units × 1200 sq ft/unit = 28800 sq ft; lot 7000 sq ft; 28800 <= 7000 → fail");
});

// Deterministic generator (LCG) so the property test is reproducible without a dependency.
function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
test("property: idempotent, and no pass without a rule id and a citation (300 random states)", () => {
  const rnd = lcg(20260921);
  const maybe = <T,>(v: T): T | undefined => (rnd() < 0.2 ? undefined : v);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  for (let i = 0; i < 300; i++) {
    const scenario: ScenarioInputs = {
      use: pick(["multifamily", "retail", "office", "heavy_industrial", "mixed_use"]),
      units: maybe(Math.floor(rnd() * 40)), height_ft: maybe(Math.floor(rnd() * 80)),
      setback_front_ft: maybe(Math.floor(rnd() * 90)), setback_side_ft: maybe(Math.floor(rnd() * 20)), setback_rear_ft: maybe(Math.floor(rnd() * 40)),
      ground_floor_use: pick(["retail", "residential", "none"]),
    };
    const p: ParcelFacts = { ...parcel, lot_area_sqft: rnd() < 0.1 ? null : Math.floor(rnd() * 30000), lot_area_suspect: rnd() < 0.1, base_zoning: rnd() < 0.1 ? ["LB1", "RT4"] : ["LB1"] };
    const input = { parcel: p, scenario, rules: LB1_RULES, categories_in_scope: [...ALL], analysis_date: DATE };
    const a = evaluate(input);
    const b = evaluate(structuredClone(input));
    assert.deepEqual(a, b, `run ${i} not idempotent`);
    for (const f of a.findings) {
      if (f.status === "pass") assert.ok(f.rule_id && f.citations.length >= 1, `run ${i}: pass without rule/citation in ${f.category}`);
      if (f.status === "pass" || f.status === "fail") assert.ok(f.proposed && f.allowed);
    }
    assert.equal(new Set(a.calculations.map((c) => c.id)).size, a.calculations.length, "calculation ids unique");
  }
});

test("G01 (demo parcel, 24 units, 46 ft): height fail, density fail, setbacks pass, use pass", () => {
  const g = gold("G01");
  const out = evaluate({ parcel: factsOf(g.parcel), scenario: g.scenario, rules: LB1_RULES, categories_in_scope: [...ALL], analysis_date: DATE });
  const by = Object.fromEntries(out.findings.map((f) => [f.category, f]));
  assert.equal(by.height?.status, "fail"); assert.equal(by.height?.proposed?.value, 46); assert.equal(by.height?.allowed?.value, 45);
  assert.equal(by.density?.status, "fail"); assert.equal(by.density?.proposed?.value, 28800); assert.equal(by.density?.allowed?.value, 7000);
  assert.equal(by.use?.status, "pass");
  for (const c of ["setback_front", "setback_side", "setback_rear"]) assert.equal(by[c]?.status, "pass", c);
  assert.deepEqual(out.coverage.unknown, ["parking", "lot_coverage"]);
  for (const c of V1_CATEGORIES) assert.equal(by[c]?.status, g.expected.findings[c]?.status, `G01 ${c} matches the gold draft`);
});

test("G02 revised demo passes every v1 category; G09 missing height → insufficient_evidence; G10 office → unknown; G14 sliver → verify", () => {
  const status = (id: string, category: string) => {
    const g = gold(id);
    const out = evaluate({ parcel: factsOf(g.parcel), scenario: g.scenario, rules: LB1_RULES, categories_in_scope: [...V1_CATEGORIES], analysis_date: DATE });
    return out.findings.find((f) => f.category === category);
  };
  const g02 = gold("G02");
  const all = evaluate({ parcel: factsOf(g02.parcel), scenario: g02.scenario, rules: LB1_RULES, categories_in_scope: [...V1_CATEGORIES], analysis_date: DATE });
  assert.ok(all.findings.every((f) => f.status === "pass"), JSON.stringify(all.findings.map((f) => [f.category, f.status])));
  assert.equal(status("G09", "height")?.reason, "missing_input:height_ft");
  assert.equal(status("G10", "use")?.status, "unknown");
  assert.equal(status("G14", "height")?.reason, "multiple_districts");
  assert.equal(status("G05", "use")?.reason, "condition_unevaluable:street_classification");
});
