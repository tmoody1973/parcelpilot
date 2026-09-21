import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { computeIntersections } from "./gis-intersections.ts";

// Integration test with synthetic layers over a parcel placed in Lake Michigan, where no real City layer reaches.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 2 });
const X0 = -87.0, Y0 = 43.0, W = 0.001, H = 0.001; // parcel square
const poly = (x0: number, y0: number, x1: number, y1: number) => JSON.stringify({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const stamp = Date.now();
const layerIds: Record<string, string> = {};
let parcelSnapshotId = "";

async function addLayer(key: string, kind: string, codeField: string, features: Array<{ geom: string; attrs: Record<string, unknown> }>) {
  const [l] = await sql<{ id: string }[]>`insert into gis_layers (key, jurisdiction_id, kind, name, service_url, layer_id, expected_fields, code_field) values (${key}, 'milwaukee-wi', ${kind}::gis_layer_kind, ${key}, 'https://example.test/MapServer', 1, ${["OBJECTID", codeField]}, ${codeField}) returning id`;
  layerIds[key] = l!.id;
  const [s] = await sql<{ id: string }[]>`insert into gis_layer_snapshots (gis_layer_id, fetched_at, feature_count, content_hash, source_fields) values (${l!.id}, now(), ${features.length}, ${"test-" + stamp + key}, ${["OBJECTID", codeField]}) returning id`;
  let i = 1;
  for (const f of features) await sql`insert into gis_layer_snapshot_features (snapshot_id, object_id, geometry, attributes) values (${s!.id}, ${i++}, ST_SetSRID(ST_GeomFromGeoJSON(${f.geom}), 4326), ${sql.json(f.attrs as never)})`;
}

before(async () => {
  const taxkey = `TEST${stamp}`.slice(0, 14);
  await sql`insert into parcels (taxkey, jurisdiction_id) values (${taxkey}, 'milwaukee-wi')`;
  const [p] = await sql<{ id: string }[]>`insert into parcel_snapshots (taxkey, geometry, attributes, address, zoning, lot_area_sqft, source_layer, retrieved_at, content_hash)
    values (${taxkey}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${poly(X0, Y0, X0 + W, Y0 + H)}), 4326)), '{}'::jsonb, 'Lake Michigan test parcel', 'LB1', 7000, 'test', now(), ${"h" + stamp}) returning id`;
  parcelSnapshotId = p!.id;
  // base zoning: LB1 covers 88% (left 88% of the square), RT4 covers the right 12%; RM4 only touches the top edge (0 area)
  await addLayer(`test.zoning.${stamp}`, "base_zoning", "Zoning", [
    { geom: poly(X0 - 0.01, Y0 - 0.01, X0 + W * 0.88, Y0 + H + 0.01), attrs: { OBJECTID: 1, Zoning: "LB1" } },
    { geom: poly(X0 + W * 0.88, Y0 - 0.01, X0 + W + 0.01, Y0 + H + 0.01), attrs: { OBJECTID: 2, Zoning: "RT4" } },
    { geom: poly(X0 - 0.01, Y0 + H, X0 + W + 0.01, Y0 + H + 0.01), attrs: { OBJECTID: 3, Zoning: "RM4" } },
  ]);
  await addLayer(`test.overlay.${stamp}`, "overlay", "SPROD_NAME", [{ geom: poly(X0 - 0.01, Y0 - 0.01, X0 + W * 0.5, Y0 + H + 0.01), attrs: { OBJECTID: 1, SPROD_NAME: "Test SPROZ" } }]);
});
after(async () => {
  for (const key of Object.keys(layerIds)) await sql`update gis_layers set enabled = false where id = ${layerIds[key]}`; // rows are append-only; disabling removes them from future runs
  await sql.end();
});

test("88/12 split → both districts, gis_ambiguity true; edge-touching RM4 ignored; overlay detected", async () => {
  const { summary, rows, inserted } = await computeIntersections(sql, parcelSnapshotId);
  assert.ok(inserted >= 3, `expected ≥3 rows inserted, got ${inserted}`);
  assert.deepEqual(summary.base_zoning, ["LB1", "RT4"]);
  assert.equal(summary.gis_ambiguity, true);
  assert.ok(Math.abs(summary.base_zoning_ratios["LB1"]! - 0.88) < 0.01, `LB1 ratio ${summary.base_zoning_ratios["LB1"]}`);
  assert.ok(Math.abs(summary.base_zoning_ratios["RT4"]! - 0.12) < 0.01);
  assert.deepEqual(summary.overlays, ["Test SPROZ"]);
  const rm4 = rows.find((r) => r.code === "RM4");
  assert.ok(!rm4 || rm4.overlap_ratio < 0.001, "edge-touch neighbour must have ~0 overlap");
  const lb1 = rows.find((r) => r.code === "LB1")!; const rt4 = rows.find((r) => r.code === "RT4")!;
  // area and ratio must describe the same parcel: area/ratio is the parcel area for both districts
  const parcelFromLb1 = lb1.overlap_area_sqft / lb1.overlap_ratio, parcelFromRt4 = rt4.overlap_area_sqft / rt4.overlap_ratio;
  assert.ok(Math.abs(parcelFromLb1 - parcelFromRt4) / parcelFromLb1 < 0.01, `inconsistent parcel area ${parcelFromLb1} vs ${parcelFromRt4}`);
  assert.ok(lb1.overlap_area_sqft > 0);
});

test("recomputing inserts nothing new (idempotent)", async () => {
  const { inserted, rows } = await computeIntersections(sql, parcelSnapshotId);
  assert.equal(inserted, 0); assert.ok(rows.length >= 3);
});

test("gis_intersections is append-only", async () => {
  await assert.rejects(sql`delete from gis_intersections where parcel_snapshot_id = ${parcelSnapshotId}`, /append-only|permission denied/);
});
