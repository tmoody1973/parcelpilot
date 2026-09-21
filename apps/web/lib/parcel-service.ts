import "server-only";
import { createArcgisClient, resolveParcel, type ParcelFacts, type ResolveInput } from "@parcelpilot/zoning-core";
import { computeIntersections, createParcelStore } from "@parcelpilot/db";
import { serviceSql } from "./db.ts";
import type { GeocodeSuggestion, ResolveResult, SiteProfile } from "./dto.ts";

// Orchestrates the safety chain the browser must not touch directly (02_architecture.md §5):
// resolve the parcel through zoning-core (which owns the ArcGIS call and writes the immutable snapshot),
// then intersect it with the stored GIS layer snapshots. The UI only ever reads what this returns.

export async function geocodeSuggest(query: string): Promise<GeocodeSuggestion[]> {
  return createArcgisClient().geocode(query);
}

export async function resolveSite(input: ResolveInput): Promise<ResolveResult> {
  const sql = serviceSql();
  const result = await resolveParcel(input, { store: createParcelStore(sql) });

  if (result.kind === "not_found") return { kind: "not_found", reason: result.reason };
  if (result.kind === "ambiguous") return { kind: "ambiguous", candidates: result.candidates, point: result.point };

  const profile = await buildProfile(sql, result.facts, result.snapshot_id, result.snapshot_reused);
  return { kind: "resolved", profile };
}

// Rebuilds the profile for a known snapshot without a fresh ArcGIS call (used by project history).
export async function profileForSnapshot(snapshotId: string): Promise<SiteProfile | null> {
  const sql = serviceSql();
  const rows = await sql<
    { taxkey: string; address: string; zoning: string | null; lot_area_sqft: number | null; lot_area_suspect: boolean; attributes: Record<string, unknown>; source_gis_datetime: string | null; retrieved_at: string; geometry: unknown }[]
  >`
    select taxkey, address, zoning, lot_area_sqft::float8 as lot_area_sqft, lot_area_suspect, attributes,
           source_gis_datetime, retrieved_at, ST_AsGeoJSON(geometry)::json as geometry
    from parcel_snapshots where id = ${snapshotId}`;
  const row = rows[0];
  if (!row) return null;
  const { summary } = await computeIntersections(sql, snapshotId);
  return toProfile(row, snapshotId, true, summary, row.geometry, row.retrieved_at);
}

async function buildProfile(sql: ReturnType<typeof serviceSql>, facts: ParcelFacts, snapshotId: string, reused: boolean): Promise<SiteProfile> {
  const { summary } = await computeIntersections(sql, snapshotId);
  const rows = await sql<{ retrieved_at: string }[]>`select retrieved_at from parcel_snapshots where id = ${snapshotId}`;
  return {
    taxkey: facts.taxkey,
    address: facts.address,
    zoning: facts.zoning,
    lot_area_sqft: facts.lot_area_sqft,
    lot_area_suspect: facts.lot_area_suspect,
    corner_lot: facts.corner_lot,
    nr_units: facts.nr_units,
    parcel_type: facts.parcel_type,
    gis_datetime: facts.gis_datetime,
    geometry: facts.geometry,
    snapshot_id: snapshotId,
    snapshot_reused: reused,
    retrieved_at: rows[0]?.retrieved_at ?? null,
    gis: summary,
  };
}

function toProfile(
  row: { taxkey: string; address: string; zoning: string | null; lot_area_sqft: number | null; lot_area_suspect: boolean; attributes: Record<string, unknown>; source_gis_datetime: string | null },
  snapshotId: string,
  reused: boolean,
  summary: SiteProfile["gis"],
  geometry: unknown,
  retrievedAt: string,
): SiteProfile {
  const attrs = row.attributes;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    taxkey: row.taxkey,
    address: row.address,
    zoning: row.zoning,
    lot_area_sqft: row.lot_area_sqft,
    lot_area_suspect: row.lot_area_suspect,
    corner_lot: attrs["CORNER_LOT"] ? String(attrs["CORNER_LOT"]) : null,
    nr_units: num(attrs["NR_UNITS"]),
    parcel_type: num(attrs["PARCEL_TYPE"]),
    gis_datetime: row.source_gis_datetime,
    geometry: geometry as SiteProfile["geometry"],
    snapshot_id: snapshotId,
    snapshot_reused: reused,
    retrieved_at: retrievedAt,
    gis: summary,
  };
}
