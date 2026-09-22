// Clears pending chunks for retrieval unless a person still has to look at them (MOO-827). Idempotent.
// Usage: pnpm corpus:activate
import postgres from "postgres";
import { activateCorpus } from "../corpus-activation.ts";

const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  const r = await activateCorpus(sql, "milwaukee-wi");
  console.log(`corpus: activated ${r.activated}; held back: flagged page ${r.held.flagged_page}, uncertain section ${r.held.uncertain_section}, unmerged table ${r.held.unmerged_table}`);
  for (const [sub, c] of Object.entries(r.by_subchapter).sort(([a], [b]) => Number(a) - Number(b))) console.log(`  subchapter ${sub}: activated ${c.activated}, still pending ${c.still_pending}`);
  const [served] = await sql`select count(*)::int as n from active_code_chunks`;
  console.log(`served by active_code_chunks (active chunk of an active, in-force document): ${served!["n"]}`);
} finally {
  await sql.end();
}
