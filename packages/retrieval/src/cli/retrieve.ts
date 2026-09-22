// Runs the retriever against the local corpus and records the runs (offline: no org). MOO-830/MOO-833 live proof.
// Usage: pnpm retrieve --districts LB1 [--demo] [--bundle] [--category height --q "maximum height"]
import postgres from "postgres";
import type { SourceStatus } from "@parcelpilot/contracts";
import { retrieve } from "../retrieve.ts";
import { assembleBundle, type BundleDocument, type BundleSource } from "../assemble.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const districts = (flag("--districts") ?? "LB1").split(",");
const d = districts.join("/");
const DEMO: Array<[string | null, string]> = [
  ["use", `Is a multi-family dwelling allowed in ${d}?`],
  ["height", `maximum building height in ${d}`],
  ["setback_front", `front setback minimum and maximum in ${d}`],
  ["setback_side", `side setback in ${d}`],
  ["setback_rear", `rear setback in ${d}`],
  ["density", `lot area per dwelling unit in ${d}`],
  [null, `${d} district purpose and where it applies`],
];
const questions = args.includes("--demo") ? DEMO : [[flag("--category") ?? null, flag("--q") ?? "maximum height"] as [string | null, string]];
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  const analysisDate = new Date().toISOString().slice(0, 10);
  const runIds: string[] = [];
  const sources: BundleSource[] = [];
  for (const [category, q] of questions) {
    const r = await retrieve(sql, { jurisdictionId: "milwaukee-wi", subquestion: q, category, districts, analysisDate });
    runIds.push(r.run_id!);
    sources.push({ subquestion: q, category, districts, result: r });
    console.log(`\n[${category ?? "district"}] "${q}"  run ${r.run_id}  context found: ${JSON.stringify(r.context_found)}`);
    for (const h of r.hits.slice(0, 3)) console.log(`  #${h.rank} ${h.section.padEnd(16)} p.${String(h.page_start).padEnd(3)} ${h.source_type.padEnd(14)} ${h.reason.padEnd(52)} ${h.text.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  const [bad] = await sql`select count(*)::int as n from retrieval_evidence e where e.retrieval_run_id = any(${runIds}::uuid[]) and e.code_chunk_id not in (select id from active_code_chunks)`;
  console.log(`\nevidence rows on these runs not in active_code_chunks: ${bad!["n"]}`);

  if (args.includes("--bundle")) {
    // Assemble the evidence bundle M5 will hand to the briefing LLM (MOO-833). Look up each served chunk's document.
    const shas = [...new Set(sources.flatMap((s) => [...s.result.hits, ...s.result.context].map((h) => h.document_sha)))];
    const rows = await sql<Array<{ sha256: string; title: string; official_url: string | null; status: SourceStatus }>>`
      select sha256, title, official_url, status from source_documents where sha256 = any(${shas}::text[])`;
    const documents: Record<string, BundleDocument> = Object.fromEntries(rows.map((r) => [r.sha256, { title: r.title, official_url: r.official_url, status: r.status }]));
    const bundle = assembleBundle({ jurisdictionId: "milwaukee-wi", analysisDate, sources, documents });
    console.log(`\nevidence bundle: ${bundle.evidence.length} excerpts across ${bundle.subquestions.length} subquestions; jev flags ${JSON.stringify(bundle.jev_flags)}`);
  }
} finally {
  await sql.end();
}
