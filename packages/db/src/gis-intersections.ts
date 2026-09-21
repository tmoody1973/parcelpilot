import type postgres from "postgres";
import { summarizeIntersections, type GisSummary, type IntersectionRow } from "@parcelpilot/zoning-core";

const SQFT_PER_SQM = 10.7639104;

// Intersects one parcel snapshot with the latest snapshot of every enabled layer, writes gis_intersections rows
// (idempotent on (parcel_snapshot, feature)), and returns the pure summary computed from what is stored.
export async function computeIntersections(sql: postgres.Sql, parcelSnapshotId: string): Promise<{ summary: GisSummary; rows: IntersectionRow[]; inserted: number }> {
  const inserted = await sql`
    with latest as (
      select distinct on (s.gis_layer_id) s.id as snapshot_id, l.key as layer_key, l.kind, l.code_field
      from gis_layer_snapshots s join gis_layers l on l.id = s.gis_layer_id
      where l.enabled and s.content_hash <> 'pending'
      order by s.gis_layer_id, s.fetched_at desc
    ),
    parcel as (select id, geometry, ST_Area(geometry::geography) as area_sqm from parcel_snapshots where id = ${parcelSnapshotId}),
    hits as (
      select p.id as parcel_snapshot_id, latest.snapshot_id, f.id as feature_id, latest.layer_key, latest.kind,
             case when latest.code_field is null then null else f.attributes ->> latest.code_field end as code,
             f.attributes,
             ST_Area(ST_Intersection(f.geometry, p.geometry)::geography) as overlap_sqm, p.area_sqm
      from parcel p
      join latest on true
      join gis_layer_snapshot_features f on f.snapshot_id = latest.snapshot_id and f.geometry is not null and ST_Intersects(f.geometry, p.geometry)
    )
    insert into gis_intersections (parcel_snapshot_id, gis_layer_snapshot_id, feature_id, layer_key, kind, code, attributes, overlap_area_sqft, overlap_ratio)
    select parcel_snapshot_id, snapshot_id, feature_id, layer_key, kind::gis_layer_kind, code, attributes,
           round((overlap_sqm * ${SQFT_PER_SQM})::numeric, 2), round((case when area_sqm > 0 then overlap_sqm / area_sqm else 0 end)::numeric, 6)
    from hits
    on conflict (parcel_snapshot_id, feature_id) do nothing`;
  const rows = await sql<IntersectionRow[]>`
    select layer_key, kind, code, overlap_ratio::float8 as overlap_ratio, overlap_area_sqft::float8 as overlap_area_sqft, attributes
    from gis_intersections where parcel_snapshot_id = ${parcelSnapshotId} order by overlap_ratio desc`;
  return { summary: summarizeIntersections(rows), rows, inserted: inserted.count };
}
