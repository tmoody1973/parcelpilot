import type { Page, Route } from "@playwright/test";
import type { GisSummary } from "../lib/dto.ts";

// Deterministic API stubs for the workspace e2e specs. No database or City services involved.

const GEOMETRY = {
  type: "Polygon" as const,
  coordinates: [[
    [-87.965, 43.101],
    [-87.9645, 43.101],
    [-87.9645, 43.1013],
    [-87.965, 43.1013],
    [-87.965, 43.101],
  ]],
};

const EMPTY_GIS: GisSummary = {
  base_zoning: ["LB2"],
  base_zoning_ratios: { LB2: 0.98 },
  gis_ambiguity: false,
  planned_development: [],
  overlays: [],
  special_districts: [],
  floodplain: [],
  coverage_ratio: 0.98,
};

export function resolvedProfile(taxkey: string, address: string) {
  return {
    kind: "resolved",
    profile: {
      taxkey,
      address,
      zoning: "LB2",
      lot_area_sqft: 4800,
      lot_area_suspect: false,
      corner_lot: null,
      nr_units: 1,
      parcel_type: 1,
      gis_datetime: "2026-08-01T00:00:00.000Z",
      geometry: GEOMETRY,
      snapshot_id: "00000000-0000-0000-0000-0000000000aa",
      snapshot_reused: false,
      retrieved_at: "2026-09-01T00:00:00.000Z",
      gis: EMPTY_GIS,
      gis_features: [],
    },
  };
}

export function ambiguousResult() {
  return {
    kind: "ambiguous",
    point: { lon: -87.9647, lat: 43.1012 },
    candidates: [
      { taxkey: "3900011000", address: "1901 N Dr Martin Luther King Jr Dr", unit: "101", zoning: "LB2" },
      { taxkey: "3900011001", address: "1901 N Dr Martin Luther King Jr Dr", unit: "201", zoning: "LB2" },
    ],
  };
}

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
}

// Installs the routes shared by every spec (geocode + project/scenario writes).
export async function stubCommonRoutes(page: Page) {
  await page.route("**/api/geocode**", (route) => json(route, []));
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? json(route, { id: "proj-1", parcel_taxkey: "2500011000", parcel_snapshot_id: null, parcel_address: null, name: "Test project", scenario_count: 0, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z" })
      : json(route, []),
  );
  let seq = 0;
  await page.route("**/api/projects/*/scenarios", (route) => {
    if (route.request().method() !== "POST") return json(route, []);
    seq += 1;
    const body = route.request().postDataJSON() as { name: string; inputs: Record<string, unknown> };
    return json(route, { id: `scn-${seq}`, project_id: "proj-1", name: body.name, status: "draft", inputs: body.inputs, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" });
  });
}

// A locked run shaped like the API's FeasibilityRun. "g01" = the demo concept (height + density fail);
// "g09" = the same with height omitted (insufficient evidence). Numbers mirror the gold drafts.
export function runFixture(kind: "g01" | "g09", scenarioId = "scn-1") {
  const cite = [{ citation_id: "c1", document_id: "198a9062664ed8499838570152f0111392dd126366a4950b0dd3e28f32362f24", page: 16, printed_page: 824, section: "295-605-2", table: "Table 295-605-2" }];
  const pass = (category: string, criticality: string, proposed: number, allowed: number, operator: string) => ({ category, status: "pass", criticality, rule_id: `r-${category}`, rule_version: 1, proposed: { value: proposed, unit: "ft", source: "scenario" }, allowed: { value: allowed, unit: "ft", operator }, calculation_ids: [], citations: cite, missing_inputs: [], confidence: "high" });
  const height = kind === "g01"
    ? { category: "height", status: "fail", criticality: "critical", rule_id: "r-height", rule_version: 1, proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" }, calculation_ids: [], citations: cite, missing_inputs: [], confidence: "high" }
    : { category: "height", status: "insufficient_evidence", criticality: "critical", rule_id: "r-height", rule_version: 1, calculation_ids: [], citations: cite, reason: "missing_input:height_ft", missing_inputs: ["height_ft"], confidence: "low" };
  const findings = [
    { category: "use", status: "pass", criticality: "critical", rule_id: "r-use", rule_version: 1, proposed: { value: "multifamily", source: "scenario" }, allowed: { value: "Y", operator: "in" }, calculation_ids: [], citations: cite, missing_inputs: [], confidence: "high" },
    height,
    pass("setback_front", "high", 5, 70, "<="), pass("setback_side", "high", 0, 0, ">="), pass("setback_rear", "high", 10, 0, ">="),
    { category: "density", status: "fail", criticality: "high", rule_id: "r-density", rule_version: 1, proposed: { value: 28800, unit: "sq ft", source: "scenario" }, allowed: { value: 7000, unit: "sq ft", operator: "<=" }, calculation_ids: [], citations: cite, missing_inputs: [], confidence: "high" },
    { category: "parking", status: "unknown", criticality: "medium", calculation_ids: [], citations: [], reason: "no_rule", missing_inputs: [], confidence: "low" },
    { category: "lot_coverage", status: "unknown", criticality: "medium", calculation_ids: [], citations: [], reason: "no_rule", missing_inputs: [], confidence: "low" },
  ];
  const g01 = kind === "g01";
  return {
    id: `run-${kind}`, scenario_id: scenarioId, project_id: "proj-1", status: "succeeded",
    final_status: g01 ? "revise_scenario" : "insufficient_evidence", route: g01 ? "revise_scenario" : "collect_missing_information", risk: g01 ? "high" : null,
    reasons: g01 ? ["O3:critical_or_high_fail"] : ["O2:missing_required_input"], triggers: [],
    policy_flags: { deterministic_critical_fail: g01, special_district_detected: false, missing_required_input: !g01, gis_ambiguity: false },
    coverage: g01 ? { checked: ["use", "height", "setback_front", "setback_side", "setback_rear", "density"], manual_review: [], unknown: ["parking", "lot_coverage"] } : { checked: ["use", "setback_front", "setback_side", "setback_rear", "density"], manual_review: ["height"], unknown: ["parking", "lot_coverage"] },
    evidence: { citation_validator_passed: true, active_code_version: true, conflicting_sources: false, stale_facts: false, problems: [] },
    findings, scenario_inputs: { use: "multifamily", units: 24, ground_floor_use: "retail" },
    provenance: { parcel_snapshot_id: "00000000-0000-0000-0000-0000000000aa", gis_layer_snapshot_ids: ["00000000-0000-0000-0000-0000000000bb"], rule_version_set: { "lb1-height-max": "r-height" }, input_hash: "abc123", analysis_date: "2026-09-21", parcel_retrieved_at: "2026-09-01T00:00:00.000Z", rules_engine_version: "0.1.0", decision_mode: "rules_only" },
    created_at: "2026-09-21T20:00:00.000Z", locked_at: "2026-09-21T20:00:00.000Z",
  };
}

// POST run → the given fixture; GET runs → []. Install after stubCommonRoutes.
export async function stubRunRoutes(page: Page, kind: "g01" | "g09") {
  await page.route("**/api/scenarios/*/runs", (route) => json(route, []));
  await page.route("**/api/scenarios/*/run", (route) => json(route, runFixture(kind), 201));
}
