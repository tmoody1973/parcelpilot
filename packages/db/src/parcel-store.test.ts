import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { toFacts } from "@parcelpilot/zoning-core";
import { createParcelStore } from "./parcel-store.ts";

// Integration test: real Postgres + PostGIS from docker compose (migrations applied).
const SERVICE = process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot";
const sql = postgres(SERVICE, { max: 1 });
const store = createParcelStore(sql);
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "zoning-core", "test-fixtures", "parcel-taxkey-2050114000.geojson"), "utf8"));
const facts = toFacts(fixture.features[0]);
after(async () => { await sql.end(); });

test("insert stores a MultiPolygon in EPSG:4326 with a positive area, and findRecent returns it", async () => {
  const now = new Date();
  const { id } = await store.insert(facts, now);
  const [row] = await sql<{ srid: number; gtype: string; area_sqm: number; zoning: string }[]>`
    select ST_SRID(geometry) as srid, GeometryType(geometry) as gtype, ST_Area(geometry::geography) as area_sqm, zoning from parcel_snapshots where id = ${id}`;
  assert.equal(row!.srid, 4326); assert.equal(row!.gtype, "MULTIPOLYGON"); assert.equal(row!.zoning, "LB1");
  assert.ok(row!.area_sqm > 500 && row!.area_sqm < 800, `area ${row!.area_sqm} m² should be ≈ 650 m² (7,000 sq ft)`);
  const found = await store.findRecent(facts.taxkey, facts.content_hash, new Date(now.getTime() - 60_000));
  assert.equal(found?.id, id);
  assert.equal(await store.findRecent(facts.taxkey, "nope", new Date(0)), null);
});

test("parcel_snapshots is append-only", async () => {
  await assert.rejects(sql`update parcel_snapshots set zoning = 'X' where taxkey = ${facts.taxkey}`, /append-only \(UPDATE not allowed\)|permission denied/);
  await assert.rejects(sql`delete from parcel_snapshots where taxkey = ${facts.taxkey}`, /append-only \(DELETE not allowed\)|permission denied/);
});
