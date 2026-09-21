// Live smoke test against the City services. Usage: node packages/zoning-core/src/cli/smoke-parcel.ts "4843 N Green Bay Av"
import { resolveParcel } from "../parcel-resolver.ts";
const q = process.argv.slice(2).join(" ") || "4843 N Green Bay Av";
const input = /^\d{10}$/.test(q) ? { taxkey: q } : { address: q };
const r = await resolveParcel(input, { store: { async findRecent() { return null; }, async insert() { return { id: "smoke-no-store" }; } } });
if (r.kind === "resolved") console.log(`resolved TAXKEY=${r.facts.taxkey} ZONING=${r.facts.zoning} LOT_AREA=${r.facts.lot_area_sqft} suspect=${r.facts.lot_area_suspect} address="${r.facts.address}" hash=${r.facts.content_hash.slice(0, 12)}`);
else console.log(JSON.stringify(r).slice(0, 400));
