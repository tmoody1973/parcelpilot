// Live smoke: resolve a real parcel (City services), snapshot it, intersect with stored layer snapshots, print the summary.
// Usage: pnpm smoke:intersections "<address or taxkey>"
import postgres from "postgres";
import { resolveParcel } from "@parcelpilot/zoning-core";
import { createParcelStore } from "../parcel-store.ts";
import { computeIntersections } from "../gis-intersections.ts";
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 2 });
const q = process.argv.slice(2).join(" ") || "4843 N Green Bay Av";
const r = await resolveParcel(/^\d{10}$/.test(q) ? { taxkey: q } : { address: q }, { store: createParcelStore(sql) });
if (r.kind !== "resolved") { console.log(JSON.stringify(r).slice(0, 300)); await sql.end(); process.exit(0); }
const { summary, rows, inserted } = await computeIntersections(sql, r.snapshot_id);
console.log(`parcel ${r.facts.taxkey} "${r.facts.address}" layer ZONING attr=${r.facts.zoning} snapshot=${r.snapshot_id.slice(0, 8)} reused=${r.snapshot_reused}`);
console.log(`intersections stored: ${rows.length} (inserted now: ${inserted})`);
console.log(JSON.stringify(summary));
for (const x of rows.slice(0, 8)) console.log(`  ${x.layer_key.padEnd(22)} ${(x.code ?? "").padEnd(16)} ratio=${x.overlap_ratio.toFixed(4)} sqft=${x.overlap_area_sqft}`);
await sql.end();
