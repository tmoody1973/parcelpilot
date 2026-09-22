import type postgres from "postgres";
import { retrieve, type Hit, type Reranker } from "./retrieve.ts";

// Retrieval evaluation (MOO-831; 04 §9). Scores the retriever on a labelled passage set: for each query, which of the
// required passages came back, how high, and whether the bundle is complete. A gate, not a report: CI fails below it.
type Q = postgres.Sql | postgres.TransactionSql;
export type Required = { family_id: string; tier: "primary" | "context"; kind: string; page: number; printed_page?: number | null; footnotes?: string[]; note: string };
export type LabelledQuery = { id: string; case: string | null; districts: string[]; category: string | null; subquestion: string; required: Required[]; blocked_until?: string };
export type GoldSet = { version: string; queries: LabelledQuery[]; excluded: Array<Record<string, unknown>> };
export const GATES = { recall_at_10: 0.9, footnote_recall: 0.95, inactive_citations: 0 } as const;

export type QueryScore = {
  id: string; status: "scored" | "blocked"; blocked_reason?: string; primary: number;
  found_at_5: number; found_at_10: number; found_at_20: number; ranks: Record<string, number | null>;
  footnote_rows: number; footnote_rows_ok: number; bundle_complete: boolean; filter_violations: number; inactive_evidence: number; missing: string[];
};

const rankOf = (hits: Hit[], family: string) => hits.find((h) => h.family_id === family)?.rank ?? null;

// A query is blocked (reported, not scored) when a required passage is not served at all: its chunk is pending or its
// document is not active. That is a corpus-review state, not a retrieval miss.
async function unservedKeys(sql: Q, families: string[], analysisDate: string): Promise<string[]> {
  const served = await sql<{ family_id: string }[]>`
    select c.family_id from code_chunks c join source_documents d on d.id = c.source_document_id
    where c.family_id = any(${families}) and c.status = 'active' and d.status = 'active'
      and (d.effective_start is null or d.effective_start <= ${analysisDate}::date) and (d.effective_end is null or d.effective_end > ${analysisDate}::date)`;
  const ok = new Set(served.map((r) => r.family_id));
  return families.filter((f) => !ok.has(f));
}

export async function scoreQuery(sql: Q, q: LabelledQuery, opts: { analysisDate: string; versionId?: string; rerank?: Reranker }): Promise<QueryScore> {
  const primary = q.required.filter((r) => r.tier === "primary");
  const base = { id: q.id, primary: primary.length, found_at_5: 0, found_at_10: 0, found_at_20: 0, ranks: {}, footnote_rows: 0, footnote_rows_ok: 0, bundle_complete: false, filter_violations: 0, inactive_evidence: 0, missing: [] as string[] };
  const unserved = await unservedKeys(sql, q.required.map((r) => r.family_id), opts.analysisDate);
  if (unserved.length) return { ...base, status: "blocked", blocked_reason: `not served: ${unserved.join(", ")}${q.blocked_until ? ` (${q.blocked_until})` : ""}` };
  const r = await retrieve(sql, { jurisdictionId: "milwaukee-wi", subquestion: q.subquestion, category: q.category, districts: q.districts, analysisDate: opts.analysisDate, k: 20, ...(opts.versionId ? { versionId: opts.versionId } : {}), ...(opts.rerank ? { rerank: opts.rerank } : {}) });
  const ranks = Object.fromEntries(primary.map((p) => [p.family_id, rankOf(r.hits, p.family_id)]));
  const within = (k: number) => primary.filter((p) => { const rk = ranks[p.family_id]; return rk !== null && rk !== undefined && rk <= k; }).length;
  // Footnote recall: a required row that carries footnotes counts only if it came back with every one attached.
  const fnRows = primary.filter((p) => p.footnotes?.length);
  const fnOk = fnRows.filter((p) => { const h = r.hits.find((x) => x.family_id === p.family_id); return !!h && p.footnotes!.every((m) => h.footnotes.some((f) => f.startsWith(`${m} `))); }).length;
  const everything = new Set([...r.hits, ...r.context].map((h) => h.family_id));
  const bundle_complete = within(20) === primary.length && q.required.filter((x) => x.tier === "context").every((c) => everything.has(c.family_id));
  const filter_violations = r.hits.filter((h) => h.district_codes.length > 0 && !h.district_codes.some((d) => q.districts.includes(d))).length;
  const [bad] = await sql<{ n: number }[]>`select count(*)::int as n from retrieval_evidence e where e.retrieval_run_id = ${r.run_id}
    and not exists (select 1 from code_chunks c join source_documents d on d.id = c.source_document_id where c.id = e.code_chunk_id and c.status = 'active' and d.status = 'active')`;
  const missing = primary.filter((p) => { const rk = ranks[p.family_id]; return rk === null || rk === undefined || rk > 10; }).map((p) => `${p.family_id} (rank ${ranks[p.family_id] ?? "none"})`);
  return { ...base, status: "scored", found_at_5: within(5), found_at_10: within(10), found_at_20: within(20), ranks, footnote_rows: fnRows.length, footnote_rows_ok: fnOk, bundle_complete, filter_violations, inactive_evidence: bad!.n, missing };
}

export type Summary = { scored: number; blocked: number; recall_at_5: number; recall_at_10: number; recall_at_20: number; footnote_rows: number; footnote_recall: number | null; bundle_completeness: number; inactive_citations: number; filter_violations: number; gates: Record<string, { value: number | null; target: string; pass: boolean }> };

export function summarise(scores: QueryScore[]): Summary {
  const s = scores.filter((x) => x.status === "scored");
  const sum = (f: (q: QueryScore) => number) => s.reduce((a, q) => a + f(q), 0);
  const primary = sum((q) => q.primary) || 1;
  const fnRows = sum((q) => q.footnote_rows);
  const recall10 = sum((q) => q.found_at_10) / primary;
  const footnote = fnRows ? sum((q) => q.footnote_rows_ok) / fnRows : null;
  const inactive = sum((q) => q.inactive_evidence);
  return {
    scored: s.length, blocked: scores.length - s.length,
    recall_at_5: sum((q) => q.found_at_5) / primary, recall_at_10: recall10, recall_at_20: sum((q) => q.found_at_20) / primary,
    footnote_rows: fnRows, footnote_recall: footnote, bundle_completeness: s.length ? s.filter((q) => q.bundle_complete).length / s.length : 0,
    inactive_citations: inactive, filter_violations: sum((q) => q.filter_violations),
    gates: {
      recall_at_10: { value: recall10, target: `≥ ${GATES.recall_at_10}`, pass: recall10 >= GATES.recall_at_10 },
      // With no served row that carries footnotes, the metric is not measurable; the gate says so instead of passing silently.
      footnote_recall: { value: footnote, target: `≥ ${GATES.footnote_recall}`, pass: footnote === null || footnote >= GATES.footnote_recall },
      inactive_citations: { value: inactive, target: "= 0", pass: inactive === 0 },
    },
  };
}

export function report(set: GoldSet, scores: QueryScore[], sum: Summary, meta: { date: string; version: string; reranker: string | null; corpus: string }): string {
  const pct = (x: number | null) => (x === null ? "n/a" : x.toFixed(3));
  const lines = [
    `# Retrieval evaluation — ${meta.date}`, "",
    `Labelled set \`${set.version}\` · embedding version \`${meta.version}\` · reranker ${meta.reranker ?? "none"} · corpus: ${meta.corpus}.`,
    `Generated by \`pnpm retrieval:eval\` (packages/retrieval/src/eval.ts). Every number below is measured, not estimated.`, "",
    "| Metric | Value | Gate |", "|---|---|---|",
    `| Recall@5 (primary passages) | ${pct(sum.recall_at_5)} | |`,
    `| **Recall@10** (primary passages) | **${pct(sum.recall_at_10)}** | ${sum.gates["recall_at_10"]!.target} ${sum.gates["recall_at_10"]!.pass ? "pass" : "**FAIL**"} |`,
    `| Recall@20 (primary passages) | ${pct(sum.recall_at_20)} | |`,
    `| **Table-row + footnote recall** (${sum.footnote_rows} rows with footnotes) | **${pct(sum.footnote_recall)}** | ${sum.gates["footnote_recall"]!.target} ${sum.footnote_recall === null ? "not measurable (see blocked)" : sum.gates["footnote_recall"]!.pass ? "pass" : "**FAIL**"} |`,
    `| **Inactive-version citations** | **${sum.inactive_citations}** | = 0 ${sum.gates["inactive_citations"]!.pass ? "pass" : "**FAIL**"} |`,
    `| District/overlay filter violations | ${sum.filter_violations} | |`,
    `| Bundle completeness (primary in top 20 and context present) | ${pct(sum.bundle_completeness)} | |`,
    `| Queries scored / blocked | ${sum.scored} / ${sum.blocked} | |`, "",
    "## Misses (primary passage not in the top 10)", "",
    ...(scores.flatMap((q) => q.missing.map((m) => `- ${q.id}: ${m}`)).length ? scores.flatMap((q) => q.missing.map((m) => `- ${q.id}: ${m}`)) : ["- none"]), "",
    "## Blocked queries (a required passage is not served)", "",
    ...(scores.filter((q) => q.status === "blocked").map((q) => `- ${q.id}: ${q.blocked_reason}`).concat(scores.every((q) => q.status !== "blocked") ? ["- none"] : [])), "",
    "## Excluded from the set", "",
    ...set.excluded.map((e) => `- ${e["case"]}${e["category"] ? ` ${e["category"]}` : ""}: ${e["reason"]}`), "",
    "## Per query", "", "| Query | @5 | @10 | @20 | Ranks | Bundle |", "|---|---|---|---|---|---|",
    ...scores.filter((q) => q.status === "scored").map((q) => `| ${q.id} | ${q.found_at_5}/${q.primary} | ${q.found_at_10}/${q.primary} | ${q.found_at_20}/${q.primary} | ${Object.values(q.ranks).map((r) => r ?? "–").join(", ")} | ${q.bundle_complete ? "yes" : "no"} |`),
    "",
  ];
  return lines.join("\n");
}
