// Builds an evidence bundle for one parcel and scenario from fresh, recorded retrieval runs (MOO-833).
// Usage: pnpm evidence:bundle --taxkey 2500011000 --scenario G01 [--budget N (default EVIDENCE_TOKEN_BUDGET or 6000)] [--out path]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { retrieve } from "../retrieve.ts";
import { assembleBundle } from "../bundle.ts";
import { evidenceTokenBudget, subquestionsFor } from "../run-evidence.ts";
import { RuleCategory } from "@parcelpilot/contracts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const taxkey = flag("--taxkey");
const scenarioId = flag("--scenario") ?? "G01";
if (!taxkey) { console.error("--taxkey is required"); process.exit(2); }
const root = join(import.meta.dirname, "..", "..", "..", "..");
const gold = JSON.parse(readFileSync(join(root, "packages", "contracts", "gold", `${scenarioId}.json`), "utf8")) as { scenario: { use: string; ground_floor_use?: string | null } };
const analysisDate = new Date().toISOString().slice(0, 10);
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  const [parcel] = await sql<{ zoning: string | null; address: string | null }[]>`select zoning, address from parcel_snapshots where taxkey = ${taxkey} order by created_at desc limit 1`;
  if (!parcel?.zoning) throw new Error(`no parcel snapshot with zoning for taxkey ${taxkey}; resolve the parcel in the app first`);
  const d = parcel.zoning;
  // The same questions a live run asks (run-evidence.ts), so this bundle is the offline twin of a run's.
  const questions = subquestionsFor({ districts: [d], categories: RuleCategory.options, scenario: gold.scenario });
  const runIds: string[] = [];
  for (const [category, q] of questions) runIds.push((await retrieve(sql, { jurisdictionId: "milwaukee-wi", subquestion: q, category, districts: [d], analysisDate }))!.run_id!);
  const bundle = await assembleBundle(sql, { retrievalRunIds: runIds, tokenBudget: flag("--budget") ? Number(flag("--budget")) : evidenceTokenBudget(), analysisDate });
  const out = flag("--out") ?? join(root, "docs", "eval", "bundles", `${taxkey}-${scenarioId}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`bundle for ${parcel.address} (${d}), scenario ${scenarioId}: ${bundle.items.length} items, ${bundle.tokens_used}/${bundle.token_budget} tokens, dropped ${bundle.flags.dropped_for_budget}, refused ${bundle.flags.refused_inactive}, active_version_confirmed ${bundle.flags.active_version_confirmed}, coverage gaps ${JSON.stringify(bundle.flags.coverage_gaps)}`);
  console.log("\nslot table (found):");
  const slotNames = [...new Set(Object.values(bundle.required_context).flatMap((s) => Object.keys(s)))];
  console.log(`  ${"category".padEnd(14)} ${slotNames.map((s) => s.slice(0, 14).padEnd(15)).join("")}`);
  for (const [cat, slots] of Object.entries(bundle.required_context)) console.log(`  ${cat.padEnd(14)} ${slotNames.map((s) => (slots[s] ? "yes" : "–").padEnd(15)).join("")}`);
  console.log("\nfirst items:");
  for (const i of bundle.items.slice(0, 8)) console.log(`  #${i.rank} ${(i.category ?? "district").padEnd(14)} ${i.section.padEnd(16)} p.${i.page}${i.printed_page ? `/${i.printed_page}` : ""} ${i.required_context_type ?? "hit"} — ${i.verbatim_excerpt.replace(/\s+/g, " ").slice(0, 60)}`);
  console.log(`\nwrote ${out}`);
} finally {
  await sql.end();
}
