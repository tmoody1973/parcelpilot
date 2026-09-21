import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeIntersections, type IntersectionRow } from "./gis-summary.ts";

const row = (kind: IntersectionRow["kind"], code: string, ratio: number, layer_key = "zoning.11"): IntersectionRow => ({ layer_key, kind, code, overlap_ratio: ratio, overlap_area_sqft: ratio * 7000 });

test("one district covering the parcel → that district, no ambiguity", () => {
  const s = summarizeIntersections([row("base_zoning", "LB1", 0.999)]);
  assert.deepEqual(s.base_zoning, ["LB1"]); assert.equal(s.gis_ambiguity, false); assert.equal(s.coverage_ratio, 0.999);
});
test("edge-touching neighbours (≈0 area) are ignored", () => {
  const s = summarizeIntersections([row("base_zoning", "LB1", 0.998), row("base_zoning", "RT4", 0.0), row("base_zoning", "RM4", 0.0004)]);
  assert.deepEqual(s.base_zoning, ["LB1"]); assert.equal(s.gis_ambiguity, false);
});
test("88/12 split across two districts → both listed, ambiguity true", () => {
  const s = summarizeIntersections([row("base_zoning", "LB1", 0.88), row("base_zoning", "RT4", 0.12)]);
  assert.deepEqual(s.base_zoning, ["LB1", "RT4"]); assert.equal(s.gis_ambiguity, true); assert.equal(s.base_zoning_ratios["RT4"], 0.12);
});
test("a 0.5% sliver of another district does not trigger ambiguity", () => {
  const s = summarizeIntersections([row("base_zoning", "LB1", 0.995), row("base_zoning", "RT4", 0.005)]);
  assert.deepEqual(s.base_zoning, ["LB1"]); assert.equal(s.gis_ambiguity, false);
});
test("other kinds are grouped by kind and de-duplicated by code", () => {
  const s = summarizeIntersections([
    row("base_zoning", "LB2", 1), row("overlay", "SPROZ-12", 0.4, "zoning.9"), row("overlay", "SPROZ-12", 0.6, "zoning.9"),
    row("planned_development", "DPD 42", 1, "zoning.1"), row("special_district", "TID 88", 0.3, "special_districts.8"), row("floodplain", "AE", 0.2, "FEMA_floodplain.2"), row("floodplain", "X", 0.0002, "FEMA_floodplain.2"),
  ]);
  assert.deepEqual(s.overlays, ["SPROZ-12"]); assert.deepEqual(s.planned_development, ["DPD 42"]); assert.deepEqual(s.special_districts, ["TID 88"]); assert.deepEqual(s.floodplain, ["AE"]);
});
