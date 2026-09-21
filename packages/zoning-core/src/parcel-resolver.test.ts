import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createArcgisClient, type FetchLike } from "./arcgis.ts";
import { resolveParcel, type ParcelFacts, type ParcelSnapshotStore } from "./parcel-resolver.ts";

// Recorded live responses from the City services (2026-09-21). Tests never touch the network.
const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "test-fixtures", name), "utf8"));
const empty = { type: "FeatureCollection", features: [] };
const fakeFetch: FetchLike = async (url) => {
  const u = decodeURIComponent(url.replace(/\+/g, " "));
  let body: unknown = empty;
  if (u.includes("findAddressCandidates")) body = u.includes("4843 N Green Bay Av") ? fx("geocode-4843-n-green-bay-av.json") : { candidates: [] };
  else if (u.includes("TAXKEY='2050114000'")) body = fx("parcel-taxkey-2050114000.geojson");
  else if (u.includes("TAXKEY='3522011110'")) body = fx("parcel-taxkey-3522011110.geojson");
  else if (u.includes("geometry=-87.9479")) body = fx("parcel-point-stacked-condo.geojson");
  else if (u.includes("geometry=-87.93")) body = fx("parcel-point-green-bay.geojson");
  return { ok: true, status: 200, json: async () => body };
};
const client = createArcgisClient(fakeFetch);

function memStore(seed: Array<{ id: string; taxkey: string; hash: string; at: Date }> = []) {
  const rows = [...seed]; const inserts: ParcelFacts[] = [];
  const store: ParcelSnapshotStore = {
    async findRecent(taxkey, hash, since) { return rows.find((r) => r.taxkey === taxkey && r.hash === hash && r.at >= since) ?? null; },
    async insert(facts, at) { const id = `snap-${rows.length + 1}`; rows.push({ id, taxkey: facts.taxkey, hash: facts.content_hash, at }); inserts.push(facts); return { id }; },
  };
  return { store, inserts, rows };
}

test("taxkey → resolved LB1 parcel with plausible lot area and a snapshot", async () => {
  const { store, inserts } = memStore();
  const r = await resolveParcel({ taxkey: "2050114000" }, { client, store });
  assert.equal(r.kind, "resolved");
  if (r.kind !== "resolved") return;
  assert.equal(r.facts.zoning, "LB1"); assert.equal(r.facts.lot_area_sqft, 7000); assert.equal(r.facts.lot_area_suspect, false);
  assert.equal(r.facts.address, "4843 N GREEN BAY AV"); assert.equal(r.facts.geometry.type, "Polygon");
  assert.match(r.facts.content_hash, /^[a-f0-9]{64}$/); assert.equal(r.snapshot_reused, false); assert.equal(inserts.length, 1);
});

test("address → geocode → point → same parcel", async () => {
  const r = await resolveParcel({ address: "4843 N Green Bay Av" }, { client, store: memStore().store });
  assert.equal(r.kind, "resolved"); if (r.kind === "resolved") assert.equal(r.facts.taxkey, "2050114000");
});

test("LB2 parcel 1319 W North Av resolves", async () => {
  const r = await resolveParcel({ taxkey: "3522011110" }, { client, store: memStore().store });
  assert.equal(r.kind, "resolved"); if (r.kind === "resolved") { assert.equal(r.facts.zoning, "LB2"); assert.equal(r.facts.lot_area_sqft, 29934); }
});

test("stacked condo point → ambiguous with 27 candidates and no snapshot", async () => {
  const { store, inserts } = memStore();
  const r = await resolveParcel({ point: { lon: -87.94793027568504, lat: 43.06835114432229 } }, { client, store });
  assert.equal(r.kind, "ambiguous"); if (r.kind === "ambiguous") { assert.equal(r.candidates.length, 27); assert.ok(r.candidates.some((c) => c.unit === "B")); }
  assert.equal(inserts.length, 0);
});

test("unknown taxkey and unmatched address → not_found", async () => {
  assert.deepEqual(await resolveParcel({ taxkey: "0000000000" }, { client, store: memStore().store }), { kind: "not_found", reason: "unknown_taxkey" });
  assert.deepEqual(await resolveParcel({ address: "nowhere" }, { client, store: memStore().store }), { kind: "not_found", reason: "no_geocode_match" });
});

test("implausible LOT_AREA sets lot_area_suspect", async () => {
  const bad: FetchLike = async () => { const d = structuredClone(fx("parcel-taxkey-2050114000.geojson")); d.features[0].properties.LOT_AREA = 2091010680; return { ok: true, status: 200, json: async () => d }; };
  const r = await resolveParcel({ taxkey: "2050114000" }, { client: createArcgisClient(bad), store: memStore().store });
  assert.equal(r.kind, "resolved"); if (r.kind === "resolved") assert.equal(r.facts.lot_area_suspect, true);
});

test("snapshot reused within 30 days when the content hash matches, not otherwise", async () => {
  const first = await resolveParcel({ taxkey: "2050114000" }, { client, store: memStore().store });
  const hash = first.kind === "resolved" ? first.facts.content_hash : "";
  const now = new Date("2026-09-21T12:00:00Z");
  const fresh = memStore([{ id: "old", taxkey: "2050114000", hash, at: new Date("2026-09-01T00:00:00Z") }]);
  const r1 = await resolveParcel({ taxkey: "2050114000" }, { client, store: fresh.store, now: () => now });
  assert.equal(r1.kind === "resolved" && r1.snapshot_reused, true); assert.equal(fresh.inserts.length, 0);
  const stale = memStore([{ id: "old", taxkey: "2050114000", hash, at: new Date("2026-07-01T00:00:00Z") }]);
  const r2 = await resolveParcel({ taxkey: "2050114000" }, { client, store: stale.store, now: () => now });
  assert.equal(r2.kind === "resolved" && r2.snapshot_reused, false); assert.equal(stale.inserts.length, 1);
  const changed = memStore([{ id: "old", taxkey: "2050114000", hash: "different", at: new Date("2026-09-20T00:00:00Z") }]);
  const r3 = await resolveParcel({ taxkey: "2050114000" }, { client, store: changed.store, now: () => now });
  assert.equal(r3.kind === "resolved" && r3.snapshot_reused, false);
});
