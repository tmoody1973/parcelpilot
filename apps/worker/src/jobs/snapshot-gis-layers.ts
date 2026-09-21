import type postgres from "postgres";
import { layerMetadata, layerPages, type FetchLike } from "@parcelpilot/zoning-core";
import { listEnabledLayers, writeSnapshotIfChanged, type GisLayerRow } from "@parcelpilot/db";

export type LayerResult = { key: string; inserted: boolean; featureCount: number; contentHash: string; ms: number };

export class FieldDriftError extends Error {
  readonly layerKey: string;
  readonly expected: string[];
  readonly actual: string[];
  constructor(layerKey: string, expected: string[], actual: string[]) {
    super(`field drift on ${layerKey}: expected [${expected.join(",")}] got [${actual.join(",")}]`);
    this.layerKey = layerKey; this.expected = expected; this.actual = actual;
  }
}

// Pulls every enabled layer, page by page, and writes a snapshot only when its content hash changed.
// Field drift (a renamed or missing column) aborts that layer before any row is written.
export async function snapshotGisLayers(opts: { sql: postgres.Sql; fetch?: FetchLike; layerKeys?: string[]; pageSize?: number; now?: () => Date; log?: (line: string) => void }): Promise<LayerResult[]> {
  const fetchImpl: FetchLike = opts.fetch ?? ((u) => fetch(u));
  const log = opts.log ?? (() => {});
  const layers = (await listEnabledLayers(opts.sql)).filter((l) => !opts.layerKeys || opts.layerKeys.includes(l.key));
  const results: LayerResult[] = [];
  for (const layer of layers) {
    const t0 = Date.now();
    const meta = await layerMetadata(fetchImpl, layer.service_url, layer.layer_id);
    assertNoDrift(layer, meta.fields);
    const pageSize = Math.min(opts.pageSize ?? 2000, meta.maxRecordCount);
    const outcome = await writeSnapshotIfChanged(opts.sql, layer, meta.fields, layerPages(fetchImpl, layer.service_url, layer.layer_id, pageSize), opts.now?.() ?? new Date());
    const r = { key: layer.key, inserted: outcome.inserted, featureCount: outcome.featureCount, contentHash: outcome.contentHash, ms: Date.now() - t0 };
    log(`${r.key}: ${r.inserted ? "new snapshot" : "unchanged"} features=${r.featureCount} ${r.ms}ms`);
    results.push(r);
  }
  return results;
}

export function assertNoDrift(layer: GisLayerRow, actualFields: string[]): void {
  const missing = layer.expected_fields.filter((f) => !actualFields.includes(f));
  if (missing.length > 0) throw new FieldDriftError(layer.key, layer.expected_fields, actualFields);
}
