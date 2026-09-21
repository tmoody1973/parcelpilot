import { createHash } from "node:crypto";
import type postgres from "postgres";
import type { LayerFeature } from "@parcelpilot/zoning-core";

export type GisLayerRow = { id: string; key: string; kind: string; name: string; service_url: string; layer_id: number; expected_fields: string[]; code_field: string | null; enabled: boolean };

export async function listEnabledLayers(sql: postgres.Sql): Promise<GisLayerRow[]> {
  return sql<GisLayerRow[]>`select id, key, kind, name, service_url, layer_id, expected_fields, code_field, enabled from gis_layers where enabled order by key`;
}

export async function latestSnapshotHash(sql: postgres.Sql, gisLayerId: string): Promise<string | null> {
  const rows = await sql<{ content_hash: string }[]>`select content_hash from gis_layer_snapshots where gis_layer_id = ${gisLayerId} order by fetched_at desc limit 1`;
  return rows[0]?.content_hash ?? null;
}

export type SnapshotOutcome = { inserted: boolean; snapshotId: string | null; featureCount: number; contentHash: string };

// Streams pages into a new snapshot inside one transaction, hashing as it goes. If the final hash equals the
// latest snapshot's hash the transaction is rolled back, so an unchanged layer costs a download but no rows.
export async function writeSnapshotIfChanged(sql: postgres.Sql, layer: GisLayerRow, sourceFields: string[], pages: AsyncIterable<LayerFeature[]>, fetchedAt: Date): Promise<SnapshotOutcome> {
  const previous = await latestSnapshotHash(sql, layer.id);
  const hash = createHash("sha256");
  let featureCount = 0;
  let snapshotId: string | null = null;
  const UNCHANGED = Symbol("unchanged");
  try {
    await sql.begin(async (tx) => {
      const [snap] = await tx<{ id: string }[]>`insert into gis_layer_snapshots (gis_layer_id, fetched_at, feature_count, content_hash, source_fields) values (${layer.id}, ${fetchedAt}, 0, 'pending', ${sourceFields}) returning id`;
      snapshotId = snap!.id;
      for await (const page of pages) {
        const rows = page.map((f) => {
          const objectId = Number(f.properties["OBJECTID"] ?? f.id);
          const canonical = JSON.stringify({ p: Object.fromEntries(Object.entries(f.properties).sort()), g: f.geometry });
          hash.update(`${objectId}:${createHash("sha256").update(canonical).digest("hex")}\n`);
          const hasShape = f.geometry && typeof f.geometry === "object" && Array.isArray((f.geometry as { coordinates?: unknown[] }).coordinates) && (f.geometry as { coordinates: unknown[] }).coordinates.length > 0;
          return { snapshot_id: snapshotId!, object_id: objectId, geometry: hasShape ? JSON.stringify(f.geometry) : null, attributes: f.properties };
        });
        featureCount += rows.length;
        // one multi-row insert per page; geometry converted from GeoJSON in SQL
        await tx.unsafe(
          `insert into gis_layer_snapshot_features (snapshot_id, object_id, geometry, attributes)
           select s, o, CASE WHEN g IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(g), 4326) END, a::jsonb
           from unnest($1::uuid[], $2::int[], $3::text[], $4::text[]) as t(s, o, g, a)`,
          [rows.map((r) => r.snapshot_id), rows.map((r) => r.object_id), rows.map((r) => r.geometry), rows.map((r) => JSON.stringify(r.attributes))],
        );
      }
      const contentHash = hash.digest("hex");
      if (contentHash === previous) throw UNCHANGED;
      // the snapshot row is still 'pending' inside this transaction; append_only trigger allows nothing after commit, so set it now via a fresh insert path:
      await tx`select set_config('parcelpilot.finalizing_snapshot', ${snapshotId!}, true)`;
      await tx`update gis_layer_snapshots set feature_count = ${featureCount}, content_hash = ${contentHash} where id = ${snapshotId!}`;
    });
    return { inserted: true, snapshotId, featureCount, contentHash: (await latestSnapshotHash(sql, layer.id))! };
  } catch (e) {
    if (e === UNCHANGED) return { inserted: false, snapshotId: null, featureCount, contentHash: previous! };
    throw e;
  }
}
