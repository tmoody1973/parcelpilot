// Reranker bake-off (MOO-832; 04 §6.x): none vs bge-reranker-v2-m3 vs Cohere rerank-v3.5 vs Jev per-candidate Noul,
// each with approved-rule rows pinned first (production) and without pins (raw), scored on the labelled passage set.
// Usage: pnpm retrieval:bakeoff [--only none,bge,cohere,jev]   (keys from env; a missing key or service skips that option)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { activeVersion } from "@parcelpilot/db";
import { scoreQuery, summarise, type GoldSet, type Summary } from "../eval.ts";
import { bgeReranker, cohereReranker, jevReranker, p95, type MeteredReranker } from "../rerankers.ts";

const args = process.argv.slice(2);
const only = (args[args.indexOf("--only") + 1] ?? "").split(",").filter((x) => args.includes("--only") && x);
const root = join(import.meta.dirname, "..", "..", "..", "..");
const set = JSON.parse(readFileSync(join(root, "packages", "contracts", "retrieval-gold", "v1.json"), "utf8")) as GoldSet;
const date = new Date().toISOString().slice(0, 10);
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });

let currentDistricts: string[] = [];
const candidates: Record<string, () => Promise<MeteredReranker | null>> = {
  none: async () => null,
  bge: async () => {
    const r = bgeReranker();
    const ok = await fetch(`${process.env["WORKER_PY_URL"] ?? "http://localhost:8000"}/health`).then((x) => x.ok).catch(() => false);
    return ok ? r : { ...r, available: false, unavailable_reason: "worker-py not reachable (start it with the eval group)" };
  },
  cohere: async () => cohereReranker(),
  jev: async () => jevReranker(undefined, { districts: () => currentDistricts }),
};

type Row = { option: string; pins: boolean; sum: Summary; usage: MeteredReranker["usage"] | null; seconds: number; skipped?: string };
const rows: Row[] = [];
try {
  const version = await activeVersion(sql);
  if (!version) throw new Error("no active embedding version");
  for (const name of Object.keys(candidates).filter((n) => !only.length || only.includes(n))) {
    const rr = await candidates[name]!();
    if (rr && !rr.available) { rows.push({ option: rr.name, pins: true, sum: null as never, usage: null, seconds: 0, skipped: rr.unavailable_reason! }); console.log(`skip ${rr.name}: ${rr.unavailable_reason}`); continue; }
    for (const pins of [true, false]) {
      const t0 = performance.now();
      const scores = [];
      for (const q of set.queries) {
        currentDistricts = q.districts;
        scores.push(await scoreQuery(sql, q, { analysisDate: date, versionId: version.id, ...(rr ? { rerank: rr } : {}), pinRuleRows: pins }));
      }
      const sum = summarise(scores);
      const usage = rr ? { ...rr.usage, latencies_ms: [...rr.usage.latencies_ms] } : null;
      rows.push({ option: rr?.name ?? "none", pins, sum, usage, seconds: (performance.now() - t0) / 1000 });
      console.log(`${(rr?.name ?? "none").padEnd(20)} pins=${pins ? "on " : "off"} MRR ${sum.mrr.toFixed(3)} R@1 ${sum.recall_at_1.toFixed(3)} R@5 ${sum.recall_at_5.toFixed(3)} R@10 ${sum.recall_at_10.toFixed(3)} calls ${usage?.calls ?? 0} cached ${usage?.cached ?? 0} p95 ${usage ? (p95(usage.latencies_ms) ?? 0).toFixed(0) : "-"} ms cost $${usage?.cost_usd.toFixed(4) ?? "0"}`);
      if (rr) { rr.usage.calls = 0; rr.usage.cached = 0; rr.usage.latencies_ms = []; rr.usage.units = 0; rr.usage.cost_usd = 0; }
    }
    if (name === "jev" && rr) console.log(`jev payload sample: ${JSON.stringify((rr as ReturnType<typeof jevReranker>).payloads[0])}; requests sent: ${(rr as ReturnType<typeof jevReranker>).payloads.length}`);
  }
  const base = (pins: boolean) => rows.find((r) => r.option === "none" && r.pins === pins && !r.skipped)?.sum;
  const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined ? "–" : x.toFixed(d));
  const lines = [
    `# Reranker bake-off — ${date}`, "",
    `Labelled set \`${set.version}\` (${set.queries.length} queries), embedding \`${version.provider}/${version.model_name}\`, shortlist 20, retrieval planner hybrid-v1. Measured by \`pnpm retrieval:bakeoff\`.`,
    "“Pins on” is production: table rows cited by approved rules stay first and the reranker orders the rest of the shortlist. “Pins off” lets the reranker order everything, to see what it does on its own.", "",
    "| Reranker | Pins | MRR | Recall@1 | Recall@5 | Recall@10 | Lift in MRR vs none | Footnote recall | Calls (cached) | p95 latency / call | Cost this run | Cost per 1,000 queries |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => r.skipped ? `| ${r.option} | – | skipped: ${r.skipped} |||||||||| ` : (() => {
      const b = base(r.pins);
      const perK = r.usage && r.usage.calls ? (r.usage.cost_usd / r.usage.calls) * 1000 : 0; // every live query is a real call; the cache only saved this run
      return `| ${r.option} | ${r.pins ? "on" : "off"} | ${fmt(r.sum.mrr)} | ${fmt(r.sum.recall_at_1)} | ${fmt(r.sum.recall_at_5)} | ${fmt(r.sum.recall_at_10)} | ${b ? (r.sum.mrr - b.mrr >= 0 ? "+" : "") + (r.sum.mrr - b.mrr).toFixed(3) : "–"} | ${r.sum.footnote_recall === null ? "n/a" : fmt(r.sum.footnote_recall)} | ${r.usage ? `${r.usage.calls} (${r.usage.cached})` : "–"} | ${r.usage ? `${(p95(r.usage.latencies_ms) ?? 0).toFixed(0)} ms` : "–"} | ${r.usage ? `$${r.usage.cost_usd.toFixed(4)}` : "$0"} | ${r.usage ? `$${perK.toFixed(3)}` : "$0"} |`;
    })()),
    "", "Cost per 1,000 queries = measured cost per real call × 1,000, since every live query makes a call (the cache only saved this bake-off). Cohere is measured in billed search units priced at an assumed $0.002 per unit; Jev in measured input tokens at $0.042 per million (docs.typesafe.ai/models); bge runs locally and costs compute only.", "",
  ];
  const out = join(root, "docs", "eval", `reranker-bakeoff-${date}.md`);
  mkdirSync(join(root, "docs", "eval"), { recursive: true });
  writeFileSync(out, lines.join("\n"));
  console.log(`\nreport: ${out}`);
} finally {
  await sql.end();
}
