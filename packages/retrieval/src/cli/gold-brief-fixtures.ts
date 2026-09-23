// Writes the gold-brief fixture the memo scan test reads (MOO-839): for each gold case, run 1's validated brief from a
// saved evaluation, with only the evidence it cites (the frozen contract is stored by hash in docs/eval/.contracts/).
//   pnpm briefing:fixtures [docs/eval/briefings-….jsonl]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoBrief } from "@parcelpilot/zoning-core";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const src = process.argv[2] ?? join(root, "docs", "eval", "briefings-2026-09-23-validated-opus-5-5.jsonl");
const out = join(root, "packages", "zoning-core", "src", "memo", "__fixtures__", "gold-briefs.json");

type Row = { case: string; run: number; contract_hash: string; outcome: string; validated_brief?: unknown };
const rows = readFileSync(src, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row).filter((r) => r.run === 1);

const fixtures = rows.map((r) => {
  if (r.outcome !== "validated" || !r.validated_brief) throw new Error(`${r.case}: run 1 was not validated`);
  const contract = JSON.parse(readFileSync(join(root, "docs", "eval", ".contracts", `${r.contract_hash}.json`), "utf8"));
  const brief = memoBrief(r.validated_brief, contract);
  if (!brief) throw new Error(`${r.case}: stored brief or contract no longer matches the schema`);
  const o = brief.output;
  const cited = new Set([
    ...o.executive_summary, ...o.status_explanation, ...o.open_questions,
    ...o.verified_findings.flatMap((v) => v.sentences), ...o.suggested_actions.map((a) => a.rationale), ...o.questions_for_experts.map((q) => q.question),
  ].flatMap((s) => s.source_ids.map((id) => id.toLowerCase())));
  return { case_id: r.case, brief: { ...brief, evidence: brief.evidence.filter((e) => cited.has(e.source_id.toLowerCase())) } };
});

writeFileSync(out, JSON.stringify({ source: src.slice(root.length + 1), cases: fixtures }, null, 1) + "\n");
console.log(`${fixtures.length} gold briefs → ${out.slice(root.length + 1)}`);
