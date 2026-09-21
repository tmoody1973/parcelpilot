import { createHash } from "node:crypto";
import { createArcgisClient, PARCEL_LAYER, type ArcgisClient, type GeoJsonPolygon, type ParcelFeature } from "./arcgis.ts";

// Turns an address, TAXKEY, or map point into one confirmed parcel with provenance (docs/planning/02_architecture.md §4 steps 1–2).
// Stacked condo polygons (one per TAXKEY on the same land) must produce `ambiguous`, never a silent pick.

export const LOT_AREA_PLAUSIBLE_SQFT = { min: 500, max: 2_000_000 } as const;
export const SNAPSHOT_REUSE_DAYS = 30;
export const GEOCODE_MIN_SCORE = 80;

export type ParcelFacts = {
  taxkey: string;
  address: string;
  zoning: string | null;
  lot_area_sqft: number | null;
  lot_area_suspect: boolean;
  corner_lot: string | null;
  nr_units: number | null;
  parcel_type: number | null;
  gis_datetime: string | null; // ISO, from the layer's GIS_DATETIME epoch ms
  geometry: GeoJsonPolygon;
  attributes: Record<string, unknown>;
  source_layer: string;
  content_hash: string;
};

export type ParcelCandidate = { taxkey: string; address: string; unit: string | null; zoning: string | null };

export type ResolveInput = { address: string } | { taxkey: string } | { point: { lon: number; lat: number } };
export type ResolveResult =
  | { kind: "resolved"; facts: ParcelFacts; snapshot_id: string; snapshot_reused: boolean }
  | { kind: "ambiguous"; candidates: ParcelCandidate[]; point: { lon: number; lat: number } }
  | { kind: "not_found"; reason: "no_geocode_match" | "no_parcel_at_point" | "unknown_taxkey" };

export interface ParcelSnapshotStore {
  findRecent(taxkey: string, contentHash: string, since: Date): Promise<{ id: string } | null>;
  insert(facts: ParcelFacts, retrievedAt: Date): Promise<{ id: string }>;
}

export type ResolverDeps = { client?: ArcgisClient; store: ParcelSnapshotStore; now?: () => Date };

export function addressOf(p: Record<string, unknown>): string {
  return [p["HOUSE_NR_LO"], p["SDIR"], p["STREET"], p["STTYPE"], p["UNIT"] ? `#${p["UNIT"]}` : null].filter((x) => x !== null && x !== undefined && x !== "").join(" ");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function toFacts(f: ParcelFeature): ParcelFacts {
  const p = f.properties;
  const lot = num(p["LOT_AREA"]);
  const gisMs = num(p["GIS_DATETIME"]);
  const canonical = JSON.stringify({ attributes: Object.fromEntries(Object.entries(p).sort()), geometry: f.geometry });
  return {
    taxkey: String(p["TAXKEY"]),
    address: addressOf(p),
    zoning: p["ZONING"] ? String(p["ZONING"]) : null,
    lot_area_sqft: lot,
    lot_area_suspect: lot === null || lot < LOT_AREA_PLAUSIBLE_SQFT.min || lot > LOT_AREA_PLAUSIBLE_SQFT.max,
    corner_lot: p["CORNER_LOT"] ? String(p["CORNER_LOT"]) : null,
    nr_units: num(p["NR_UNITS"]),
    parcel_type: num(p["PARCEL_TYPE"]),
    gis_datetime: gisMs ? new Date(gisMs).toISOString() : null,
    geometry: f.geometry,
    attributes: p,
    source_layer: PARCEL_LAYER,
    content_hash: createHash("sha256").update(canonical).digest("hex"),
  };
}

export async function resolveParcel(input: ResolveInput, deps: ResolverDeps): Promise<ResolveResult> {
  const client = deps.client ?? createArcgisClient();
  const now = deps.now?.() ?? new Date();

  let features: ParcelFeature[];
  let point: { lon: number; lat: number } | null = null;

  if ("taxkey" in input) {
    features = (await client.parcelsByTaxkey(input.taxkey)).features;
    if (features.length === 0) return { kind: "not_found", reason: "unknown_taxkey" };
  } else {
    if ("address" in input) {
      const best = (await client.geocode(input.address)).filter((c) => c.score >= GEOCODE_MIN_SCORE).sort((a, b) => b.score - a.score)[0];
      if (!best) return { kind: "not_found", reason: "no_geocode_match" };
      point = { lon: best.location.x, lat: best.location.y };
    } else {
      point = input.point;
    }
    features = (await client.parcelsAtPoint(point.lon, point.lat)).features;
    if (features.length === 0) return { kind: "not_found", reason: "no_parcel_at_point" };
  }

  const distinct = new Map(features.map((f) => [String(f.properties["TAXKEY"]), f]));
  if (distinct.size > 1) {
    const candidates = [...distinct.values()].map((f) => ({ taxkey: String(f.properties["TAXKEY"]), address: addressOf(f.properties), unit: f.properties["UNIT"] ? String(f.properties["UNIT"]) : null, zoning: f.properties["ZONING"] ? String(f.properties["ZONING"]) : null }));
    return { kind: "ambiguous", candidates, point: point ?? { lon: NaN, lat: NaN } };
  }

  const facts = toFacts([...distinct.values()][0]!);
  const since = new Date(now.getTime() - SNAPSHOT_REUSE_DAYS * 86_400_000);
  const existing = await deps.store.findRecent(facts.taxkey, facts.content_hash, since);
  if (existing) return { kind: "resolved", facts, snapshot_id: existing.id, snapshot_reused: true };
  const inserted = await deps.store.insert(facts, now);
  return { kind: "resolved", facts, snapshot_id: inserted.id, snapshot_reused: false };
}
