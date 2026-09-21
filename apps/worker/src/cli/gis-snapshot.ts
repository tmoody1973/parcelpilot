// Usage: pnpm gis:snapshot [layer.key ...]   — pulls enabled layers (or the named ones) into snapshots.
import postgres from "postgres";
import { snapshotGisLayers } from "../jobs/snapshot-gis-layers.ts";
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 2 });
const keys = process.argv.slice(2);
const results = await snapshotGisLayers({ sql, ...(keys.length ? { layerKeys: keys } : {}), log: (l) => console.log(l) });
console.log(`done: ${results.filter((r) => r.inserted).length} new snapshot(s), ${results.length} layer(s) checked`);
await sql.end();
