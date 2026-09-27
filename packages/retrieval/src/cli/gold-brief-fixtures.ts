// Writes the gold-brief fixture the memo scan test reads (MOO-839, MOO-843): for each gold case a validated brief with
// only the evidence it cites.
//   pnpm briefing:fixtures --from-db   the latest validated brief per gold case from the database (written by
//                                      `pnpm decision:gold`, each stored with its own contract); needs the db tunnel
//   pnpm briefing:fixtures [docs/eval/briefings-….jsonl]   run 1 of a saved evaluation (contracts in docs/eval/.contracts/)
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { goldOrgIdIfExists } from "@parcelpilot/db";
import { memoBrief, type MemoBrief } from "@parcelpilot/zoning-core";

const root = join(import.meta.dirname, "..", "..", "..", "..");
const out = join(root, "packages", "zoning-core", "src", "memo", "__fixtures__", "gold-briefs.json");
const fromDb = process.argv.includes("--from-db");

// Keep only the evidence a sentence actually cites, so the fixture stays small.
function citedOnly(brief: MemoBrief): MemoBrief {
  const o = brief.output;
  const cited = new Set([
    ...o.executive_summary, ...o.status_explanation, ...o.open_questions,
    ...o.verified_findings.flatMap((v) => v.sentences), ...o.suggested_actions.map((a) => a.rationale), ...o.questions_for_experts.map((q) => q.question),
  ].flatMap((s) => s.source_ids.map((id) => id.toLowerCase())));
  return { ...brief, evidence: brief.evidence.filter((e) => cited.has(e.source_id.toLowerCase())) };
}

async function fromDatabase(): Promise<{ source: string; cases: { case_id: string; brief: MemoBrief }[] }> {
  const service = postgres(process.env["DATABASE_SERVICE_URL"]!, { max: 1 });
  const app = postgres(process.env["DATABASE_APP_URL"]!, { max: 1 });
  try {
    const orgId = await goldOrgIdIfExists(service);
    if (!orgId) throw new Error("no gold org: run `pnpm decision:gold` first");
    const rows = await app.begin(async (tx) => {
      await tx`select set_config('app.org_id', ${orgId}, true)`;
      return tx<{ case_id: string; validated_output: unknown; contract: unknown }[]>`
        select distinct on (r.gold_case_id) r.gold_case_id as case_id, b.validated_output, b.contract
        from briefing_runs b join feasibility_runs r on r.id = b.feasibility_run_id
        where r.gold_case_id is not null and b.outcome = 'validated'
        order by r.gold_case_id, b.created_at desc`;
    });
    const cases = rows.map((r) => {
      const brief = memoBrief(r.validated_output, r.contract);
      if (!brief) throw new Error(`${r.case_id}: stored brief or contract no longer matches the schema`);
      return { case_id: r.case_id, brief: citedOnly(brief) };
    });
    return { source: "database: latest validated brief per gold case", cases };
  } finally {
    await app.end();
    await service.end();
  }
}

function fromJsonl(src: string) {
  type Row = { case: string; run: number; contract_hash: string; outcome: string; validated_brief?: unknown };
  const rows = readFileSync(src, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row).filter((r) => r.run === 1);
  const cases = rows.map((r) => {
    if (r.outcome !== "validated" || !r.validated_brief) throw new Error(`${r.case}: run 1 was not validated`);
    const contract = JSON.parse(readFileSync(join(root, "docs", "eval", ".contracts", `${r.contract_hash}.json`), "utf8"));
    const brief = memoBrief(r.validated_brief, contract);
    if (!brief) throw new Error(`${r.case}: stored brief or contract no longer matches the schema`);
    return { case_id: r.case, brief: citedOnly(brief) };
  });
  return { source: src.slice(root.length + 1), cases };
}

const fixture = fromDb ? await fromDatabase() : fromJsonl(process.argv[2] ?? join(root, "docs", "eval", "briefings-2026-09-23-validated-opus-5-5.jsonl"));
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.log(`${fixture.cases.length} gold briefs → ${out.slice(root.length + 1)}`);
