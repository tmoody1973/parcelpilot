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
    const body = route.request().postDataJSON() as { name: string; units?: number };
    return json(route, { id: `scn-${seq}`, project_id: "proj-1", name: body.name, use: "residential", units: body.units ?? null, height_ft: null, stories: null, parking_spaces: null, ground_floor_commercial_sqft: null, status: "draft", created_at: "2026-09-01T00:00:00Z" });
  });
}
