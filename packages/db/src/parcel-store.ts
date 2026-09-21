import type postgres from "postgres";
import type { ParcelFacts, ParcelSnapshotStore } from "@parcelpilot/zoning-core";

// PostGIS-backed ParcelSnapshotStore. Geometry arrives as GeoJSON (outSR=4326) and is stored as MultiPolygon.
export function createParcelStore(sql: postgres.Sql): ParcelSnapshotStore {
  return {
    async findRecent(taxkey, contentHash, since) {
      const rows = await sql<{ id: string }[]>`select id from parcel_snapshots where taxkey = ${taxkey} and content_hash = ${contentHash} and retrieved_at >= ${since} order by retrieved_at desc limit 1`;
      return rows[0] ?? null;
    },
    async insert(facts: ParcelFacts, retrievedAt) {
      return sql.begin(async (tx) => {
        await tx`insert into parcels (taxkey, jurisdiction_id) values (${facts.taxkey}, 'milwaukee-wi') on conflict (taxkey) do update set updated_at = now()`;
        const [row] = await tx<{ id: string }[]>`
          insert into parcel_snapshots (taxkey, geometry, attributes, address, zoning, lot_area_sqft, lot_area_suspect, source_layer, source_gis_datetime, retrieved_at, content_hash)
          values (${facts.taxkey}, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(facts.geometry)}), 4326)), ${sql.json(facts.attributes as never)}, ${facts.address}, ${facts.zoning},
                  ${facts.lot_area_sqft}, ${facts.lot_area_suspect}, ${facts.source_layer}, ${facts.gis_datetime}, ${retrievedAt}, ${facts.content_hash})
          returning id`;
        return { id: row!.id };
      });
    },
  };
}
