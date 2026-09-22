// Scores the retriever on the labelled passage set and writes docs/eval/retrieval-<date>.md (MOO-831).
// Usage: pnpm retrieval:eval [--provider local-hash] [--gate] [--out <path>] [--corpus "<label>"]
//   --provider local-hash  score under the deterministic local embeddings (what CI uses); default: the active version
//   --gate                 exit 1 when a gate fails (CI)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import postgres from "postgres";
import { activateVersion, activeVersion, embedChunks, ensureVersion, localHashProvider } from "@parcelpilot/db";
import { report, scoreQuery, summarise, type GoldSet } from "../eval.ts";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const root = join(import.meta.dirname, "..", "..", "..", "..");
const set = JSON.parse(readFileSync(join(root, "packages", "contracts", "retrieval-gold", "v1.json"), "utf8")) as GoldSet;
const date = new Date().toISOString().slice(0, 10);
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  let version = await activeVersion(sql);
  if (flag("--provider") === "local-hash") {
    // A chunk holds one vector, so embedding under the local model overwrites whatever model filled it. That is only
    // safe on a corpus no other model owns (CI's fresh database). Refuse otherwise instead of wiping real embeddings.
    if (version && version.provider !== "local-hash") {
      throw new Error(`--provider local-hash would overwrite the ${version.provider}/${version.model_name} embeddings of the active model; run it on a scratch or CI database, or omit --provider to score the active model`);
    }
    const lh = await ensureVersion(sql, localHashProvider());
    if (!version) await sql.begin((tx) => activateVersion(tx, lh.id));
    await embedChunks(sql, localHashProvider(), lh);
    version = { ...lh, is_active: true };
  }
  if (!version) throw new Error("no embedding version: run pnpm embed first");
  const scores = [];
  for (const q of set.queries) scores.push(await scoreQuery(sql, q, { analysisDate: date, versionId: version.id }));
  const sum = summarise(scores);
  const md = report(set, scores, sum, { date, version: `${version.provider}/${version.model_name}`, reranker: null, corpus: flag("--corpus") ?? "local" });
  const out = flag("--out") ?? join(root, "docs", "eval", `retrieval-${date}${flag("--provider") === "local-hash" ? "-local-hash" : ""}.md`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(md.split("\n## Misses")[0]);
  console.log(`\nreport: ${out}`);
  const failed = Object.entries(sum.gates).filter(([, g]) => !g.pass).map(([k]) => k);
  if (args.includes("--gate") && failed.length) { console.error(`retrieval gate FAILED: ${failed.join(", ")}`); process.exitCode = 1; }
} finally {
  await sql.end();
}
