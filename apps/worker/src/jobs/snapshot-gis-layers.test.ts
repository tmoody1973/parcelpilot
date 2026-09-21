import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import type { FetchLike } from "@parcelpilot/zoning-core";
import { snapshotGisLayers, FieldDriftError } from "./snapshot-gis-layers.ts";

// Integration test: real Postgres/PostGIS, fake City service. A temporary registry row 'test.layer' is used and removed.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 2 });
const KEY = "test.layer";
const square = (x: number) => ({ type: "Polygon", coordinates: [[[x, 43], [x + 0.001, 43], [x + 0.001, 43.001], [x, 43.001], [x, 43]]] });
const feat = (id: number, code: string) => ({ type: "Feature", id, geometry: square(-87.9 + id / 1000), properties: { OBJECTID: id, Zoning: code } });
function service(features: ReturnType<typeof feat>[], fields = ["OBJECTID", "Zoning", "SHAPE"]): FetchLike {
  return async (url) => {
    const u = new URL(url);
    let body: unknown;
    if (u.pathname.endsWith("/99") ) body = { name: "Test layer", geometryType: "esriGeometryPolygon", fields: fields.map((name) => ({ name })), maxRecordCount: 2 };
    else if (u.searchParams.get("returnCountOnly")) body = { count: features.length };
    else { const off = Number(u.searchParams.get("resultOffset") ?? 0); const n = Number(u.searchParams.get("resultRecordCount") ?? 2); body = { type: "FeatureCollection", features: features.slice(off, off + n) }; }
    return { ok: true, status: 200, json: async () => body };
  };
}
before(async () => {
  await sql`delete from gis_layers where key = ${KEY}`;
  await sql`insert into gis_layers (key, jurisdiction_id, kind, name, service_url, layer_id, expected_fields, code_field) values (${KEY}, 'milwaukee-wi', 'base_zoning', 'Test layer', 'https://example.test/MapServer', 99, ${["OBJECTID", "Zoning"]}, 'Zoning')`;
});
after(async () => {
  const snaps = await sql<{ id: string }[]>`select s.id from gis_layer_snapshots s join gis_layer_snapshots s2 on s2.id = s.id join gis_layers l on l.id = s.gis_layer_id where l.key = ${KEY}`;
  // snapshots are append-only; test rows stay but the registry row is removed so they are orphaned from future runs
  await sql`update gis_layers set enabled = false, key = ${KEY + "." + Date.now()} where key = ${KEY}`;
  await sql.end();
  void snaps;
});

test("first run pages through the layer (3 features over 2 pages) and inserts one snapshot", async () => {
  const r = await snapshotGisLayers({ sql, fetch: service([feat(1, "LB1"), feat(2, "LB2"), feat(3, "RM4")]), layerKeys: [KEY] });
  assert.equal(r.length, 1); assert.equal(r[0]!.inserted, true); assert.equal(r[0]!.featureCount, 3);
  const [row] = await sql<{ n: number; srid: number }[]>`select count(*)::int as n, min(ST_SRID(geometry)) as srid from gis_layer_snapshot_features f join gis_layer_snapshots s on s.id = f.snapshot_id join gis_layers l on l.id = s.gis_layer_id where l.key = ${KEY}`;
  assert.equal(row!.n, 3); assert.equal(row!.srid, 4326);
});

test("second run with identical data inserts nothing", async () => {
  const r = await snapshotGisLayers({ sql, fetch: service([feat(1, "LB1"), feat(2, "LB2"), feat(3, "RM4")]), layerKeys: [KEY] });
  assert.equal(r[0]!.inserted, false);
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from gis_layer_snapshots s join gis_layers l on l.id = s.gis_layer_id where l.key = ${KEY}`;
  assert.equal(row!.n, 1);
});

test("a changed feature produces a new snapshot", async () => {
  const r = await snapshotGisLayers({ sql, fetch: service([feat(1, "LB1"), feat(2, "LB3"), feat(3, "RM4")]), layerKeys: [KEY] });
  assert.equal(r[0]!.inserted, true);
});

test("field drift aborts before any write", async () => {
  await assert.rejects(snapshotGisLayers({ sql, fetch: service([feat(1, "LB1")], ["OBJECTID", "ZONING_CODE", "SHAPE"]), layerKeys: [KEY] }), (e: unknown) => e instanceof FieldDriftError);
  const [row] = await sql<{ n: number }[]>`select count(*)::int as n from gis_layer_snapshots s join gis_layers l on l.id = s.gis_layer_id where l.key = ${KEY}`;
  assert.equal(row!.n, 2);
});
