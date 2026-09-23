// The citation-support check measured on the gold briefs (MOO-841; decision 017). Takes the latest validated brief of
// every gold case from the database (written by `pnpm decision:gold`, each stored with its contract), runs the check
// live against JEV, and reports what it would do. Nothing is written back; no brief is re-generated.
//   pnpm citation-support:eval
// Needs TYPESAFE_API_KEY. Writes docs/eval/citation-support-<date>.md, which lists every removed sentence next to its
// excerpt for the hand check.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { BriefingContract } from "@parcelpilot/contracts";
import { goldComparisons, goldOrgIdIfExists } from "@parcelpilot/db";
import { CITATION_SUPPORT_AUTO_AT, askCitationSupport, briefingContractHash, checkCitationSupport, sentencesOf, validateBrief, type SupportPair } from "@parcelpilot/zoning-core";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const apiKey = process.env["TYPESAFE_API_KEY"];
const service = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
const app = postgres(process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot", { max: 1 });

type Pair = { sentence_id: string; kind: string; source_id: string; choice: string; confidence: number };
type Row = { case_id: string; pairs: Pair[]; removed: string[]; review: string[]; outcome: string; latency: number | null; cost: number | null; error: string | null; texts: Map<string, string>; excerpts: Map<string, string> };
const rows: Row[] = [];

try {
  const orgId = await goldOrgIdIfExists(service);
  if (!orgId) throw new Error("no gold org: run `pnpm decision:gold` first");
  const briefs = await app.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    const runs = await goldComparisons(tx);
    return Promise.all(runs.map(async (r) => {
      const [b] = await tx<{ validated_output: unknown; contract: unknown }[]>`
        select validated_output, contract from briefing_runs where feasibility_run_id = ${r.run_id} and outcome = 'validated' order by created_at desc limit 1`;
      return { case_id: r.case_id, b };
    }));
  });
  for (const { case_id, b } of briefs) {
    if (!b) { console.log(`${case_id}: no validated brief, skipped`); continue; }
    const contract = BriefingContract.parse(b.contract);
    const hash = briefingContractHash(contract);
    const before = validateBrief(contract, hash, b.validated_output);
    const after = await checkCitationSupport(contract, hash, before, { apiKey });
    const run = after.runs.find((r) => r.validator === "citation_support");
    const d = (run?.detail ?? {}) as { pairs?: Pair[]; review_sentence_ids?: string[]; latency_ms?: number; cost_usd?: number; error?: string };
    const texts = new Map(before.brief ? sentencesOf(before.brief).map((x) => [x.id, x.s.text]) : []);
    const excerpts = new Map(contract.evidence_bundle.map((e) => [e.source_id, `${e.section}: ${e.verbatim_excerpt}`]));
    rows.push({ case_id, pairs: d.pairs ?? [], removed: run?.removed_sentence_ids ?? [], review: d.review_sentence_ids ?? [], outcome: after.outcome, latency: d.latency_ms ?? null, cost: d.cost_usd ?? null, error: d.error ?? null, texts, excerpts });
    console.log(`${case_id} pairs ${String(d.pairs?.length ?? 0).padStart(3)}  removed ${run?.removed_sentence_ids.length ?? 0}  review ${d.review_sentence_ids?.length ?? 0}  ${after.outcome}  ${d.latency_ms ?? "-"} ms${d.error ? `  ${d.error}` : ""}`);
  }

  // The issue's planted pair, asked directly: "front setback minimum 15 ft" cited to the height row. (Inside a brief the
  // deterministic number check removes it first, because 15 is in no cited excerpt.)
  const height = "Chapter 295 Subchapter 6 — Commercial Districts, 295-605-2: Table 295-605-2. Height, maximum (ft.) (Secondary Street). NS1: 45; NS2: 45; LB1: 45; LB2: 60; LB3: 60; RB1: 45; RB2: 60; CS: 45.";
  const plantedPair: SupportPair = { sentence_id: "planted", kind: "code", source_id: "height-row", claim: "The minimum front setback in LB1 is 15 ft.", section: height };
  const planted = await askCitationSupport([plantedPair], { apiKey });
  report(planted.status === "ok" ? `${planted.answers[0]!.choice} at ${planted.answers[0]!.confidence.toFixed(2)} (${planted.latencyMs} ms)` : `failed: ${planted.error}`);
} finally {
  await app.end();
  await service.end();
}

function report(planted: string) {
  const all = rows.flatMap((r) => r.pairs);
  const count = (c: string) => all.filter((p) => p.choice === c).length;
  const lat = rows.flatMap((r) => (r.latency === null ? [] : [r.latency])).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(0.95 * lat.length) - 1)] : null;
  const cost = rows.reduce((a, r) => a + (r.cost ?? 0), 0);
  const removed = rows.flatMap((r) => r.removed.map((id) => ({ r, id })));
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Citation-support check on the gold briefs — ${date}`, "",
    `Measured by \`pnpm citation-support:eval\` (MOO-841, decision 017): the latest validated brief of each gold case (from \`pnpm decision:gold\`), run through the check live against JEV (\`jev-1.13.0\`). One request per brief; one Choice per (fact/code/finding sentence, cited excerpt). A sentence stays if any excerpt it cites supports it. Nothing was written back.`, "",
    "| | |", "|---|---|",
    `| Briefs checked | ${rows.length} |`,
    `| Pairs asked | ${all.length} |`,
    `| supports / contradicts / says_nothing | ${count("supports")} / ${count("contradicts")} / ${count("says_nothing")} |`,
    `| Pairs below ${CITATION_SUPPORT_AUTO_AT} confidence | ${all.filter((p) => p.confidence < CITATION_SUPPORT_AUTO_AT).length} |`,
    `| Sentences removed | ${removed.length} |`,
    `| Of those, sent to review (a not-support answer below ${CITATION_SUPPORT_AUTO_AT}) | ${rows.reduce((a, r) => a + r.review.length, 0)} |`,
    `| Briefs that would fall back to the template | ${rows.filter((r) => r.outcome !== "validated").length} (${rows.filter((r) => r.outcome !== "validated").map((r) => r.case_id).join(", ") || "none"}) |`,
    `| JEV failures | ${rows.filter((r) => r.error).length} |`,
    `| p95 latency per brief | ${p95 ?? "n/a"} ms |`,
    `| Cost, all briefs | $${cost.toFixed(5)} ($${(cost / Math.max(1, rows.length)).toFixed(6)} per brief) |`,
    `| Planted pair ("minimum front setback in LB1 is 15 ft" vs the height row) | ${planted} |`, "",
    "| Case | Pairs | Removed | Review | Outcome |", "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.case_id} | ${r.pairs.length} | ${r.removed.length} | ${r.review.length} | ${r.outcome}${r.error ? ` (${r.error})` : ""} |`), "",
    "## Removed sentences, for the hand check", "",
    ...removed.flatMap(({ r, id }) => {
      const ps = r.pairs.filter((p) => p.sentence_id === id);
      return [`- **${r.case_id} ${id}** (${ps[0]?.kind}): "${r.texts.get(id) ?? "?"}"`, ...ps.map((p) => `  - ${p.choice} at ${p.confidence.toFixed(2)} → ${r.excerpts.get(p.source_id) ?? p.source_id}`), "  - Hand check: _(Tarik: supported or not?)_"];
    }),
    "",
  ];
  writeFileSync(join(root, "docs", "eval", `citation-support-${date}.md`), lines.join("\n"));
  console.log(lines.slice(4, 18).join("\n"));
  console.log(`\nreport: docs/eval/citation-support-${date}.md`);
}
