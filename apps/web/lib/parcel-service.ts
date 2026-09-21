import "server-only";
import { createArcgisClient, resolveParcel, toFacts, type GeoJsonPolygon, type GisSummary, type ParcelFacts, type ParcelFeature, type ResolveInput } from "@parcelpilot/zoning-core";
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

  const [{ summary }, rows] = await Promise.all([
    computeIntersections(sql, result.snapshot_id),
    sql<{ retrieved_at: string }[]>`select retrieved_at from parcel_snapshots where id = ${result.snapshot_id}`,
  ]);
  return { kind: "resolved", profile: assembleProfile(result.facts, result.snapshot_id, result.snapshot_reused, summary, rows[0]?.retrieved_at ?? null) };
}

// Rebuilds the profile for a known snapshot without a fresh ArcGIS call (used by project history).
// The stored attributes are the original ArcGIS properties, so toFacts reproduces the same field mapping.
export async function profileForSnapshot(snapshotId: string): Promise<SiteProfile | null> {
  const sql = serviceSql();
  const rows = await sql<{ attributes: Record<string, unknown>; retrieved_at: string; geometry: GeoJsonPolygon }[]>`
    select attributes, retrieved_at, ST_AsGeoJSON(geometry)::json as geometry from parcel_snapshots where id = ${snapshotId}`;
  const row = rows[0];
  if (!row) return null;
  const { summary } = await computeIntersections(sql, snapshotId);
  const facts = toFacts({ type: "Feature", geometry: row.geometry, properties: row.attributes } satisfies ParcelFeature);
  return assembleProfile(facts, snapshotId, true, summary, row.retrieved_at);
}

function assembleProfile(facts: ParcelFacts, snapshotId: string, reused: boolean, summary: GisSummary, retrievedAt: string | null): SiteProfile {
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
    retrieved_at: retrievedAt,
    gis: summary,
  };
}
