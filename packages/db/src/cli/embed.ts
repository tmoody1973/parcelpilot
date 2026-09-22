// Embeds active chunks under the embedding model (MOO-829). Idempotent; prints tokens and cost.
// Usage: pnpm embed [--provider openai|local-hash] [--activate] [--limit N] [--query "text" ...]
//   --activate  make this provider's version the active one (starts a full re-embed under it)
//   --query     after embedding, print the 5 nearest served chunks for each query (sanity check)
import postgres from "postgres";
import { activateVersion, embedChunks, ensureVersion, localHashProvider, nearestChunks, openAiProvider } from "../embeddings.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const providerName = flag("--provider") ?? "openai";
const provider = providerName === "local-hash" ? localHashProvider() : providerName === "openai" ? openAiProvider() : null;
if (!provider) { console.error(`unknown provider ${providerName}; use openai or local-hash`); process.exit(2); }
const queries = args.flatMap((a, i) => (args[i - 1] === "--query" ? [a] : []));

const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  let version = await ensureVersion(sql, provider);
  if (args.includes("--activate") && !version.is_active) { await sql.begin((tx) => activateVersion(tx, version.id)); version = { ...version, is_active: true }; }
  if (!version.is_active) console.log(`note: ${provider.name}/${provider.model} is not the active version; searches use the active one. Pass --activate to switch.`);
  const limit = flag("--limit");
  const r = await embedChunks(sql, provider, version, limit ? { limit: Number(limit) } : {});
  console.log(`embed: ${provider.name}/${provider.model} dim 1536 version ${version.id}${version.is_active ? " (active)" : ""}; embedded ${r.embedded}, already done ${r.skipped}, batches ${r.batches}, tokens ${r.tokens}, cost $${r.cost_usd}`);
  const [c] = await sql`select count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'active' and embedding_version_id = ${version.id})::int as embedded from code_chunks`;
  console.log(`coverage: ${c!["embedded"]} of ${c!["active"]} active chunks embedded by this version`);
  for (const q of queries) {
    const { vectors } = await provider.embed([q]);
    console.log(`\nquery: "${q}"`);
    for (const h of await nearestChunks(sql, version.id, vectors[0]!, 5)) console.log(`  ${h.distance.toFixed(3)}  ${h.section.padEnd(16)} p.${String(h.page_start).padEnd(3)} ${h.source_type.padEnd(15)} ${h.text.replace(/\s+/g, " ").slice(0, 90)}`);
  }
} finally {
  await sql.end();
}
