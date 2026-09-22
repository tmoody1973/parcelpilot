import type postgres from "postgres";
import { EvidenceBundle, findBannedPhrases, type EvidenceItem } from "@parcelpilot/contracts";

// Assembles the evidence bundle (MOO-833; 04 §7) from recorded retrieval runs. Text is always the chunk's own text,
// never regenerated. Items are admitted by rank until the token budget is spent; a table row is atomic, so its
// footnotes (which live inside the row's text) can never be split from it. Evidence whose source stopped being active
// after the run is refused, not served, and the flags say so.
type Q = postgres.Sql | postgres.TransactionSql;
const CATEGORIES = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;
const SLOTS = ["parent_section", "adjacent", "cross_reference", "exception", "district_general_provision", "overlay"] as const;

type EvRow = {
  run_id: string; category: string | null; subquestion: string; filters: { overlays?: string[] }; embedding_version_id: string | null; run_started: string;
  rank: number; selection_reason: string; required_context_type: string | null;
  chunk_id: string; family_id: string; version: number; section: string; page_start: number; page_end: number | null; text: string; token_count: number;
  source_anchors: Array<{ page: number; page_end?: number; bbox?: number[]; row_index_on_page?: number }>; table_json: { footnote_refs?: Array<{ marker: string }> } | null;
  chunk_status: string; doc_status: string; in_force: boolean; official_url: string | null; title: string; sha256: string; printed_page: number | null;
};

export async function assembleBundle(sql: Q, input: { retrievalRunIds: string[]; tokenBudget: number; analysisDate: string; runId?: string | null }): Promise<EvidenceBundle> {
  if (!input.retrievalRunIds.length) throw new Error("a bundle needs at least one retrieval run");
  const rows = await sql<EvRow[]>`
    select r.id as run_id, r.category::text as category, r.subquestion, r.filters, r.embedding_version_id, r.created_at::text as run_started,
      e.rank, e.selection_reason, e.required_context_type,
      c.id as chunk_id, c.family_id, c.version, c.section, c.page_start, c.page_end, c.text, c.token_count, c.source_anchors, c.table_json,
      c.status::text as chunk_status, d.status::text as doc_status,
      ((d.effective_start is null or d.effective_start <= ${input.analysisDate}::date) and (d.effective_end is null or d.effective_end > ${input.analysisDate}::date)
        and (c.effective_start is null or c.effective_start <= ${input.analysisDate}::date) and (c.effective_end is null or c.effective_end > ${input.analysisDate}::date)) as in_force,
      d.official_url, d.title, d.sha256, p.printed_page
    from retrieval_evidence e
    join retrieval_runs r on r.id = e.retrieval_run_id
    join code_chunks c on c.id = e.code_chunk_id
    join source_documents d on d.id = c.source_document_id
    left join document_pages p on p.source_document_id = c.source_document_id and p.page_number = c.page_start
    where e.retrieval_run_id = any(${input.retrievalRunIds}::uuid[])
    order by array_position(${input.retrievalRunIds}::uuid[], r.id), e.rank`;

  const servable = (r: EvRow) => r.chunk_status === "active" && r.doc_status === "active" && r.in_force;
  const refused = rows.filter((r) => !servable(r)).length;

  // Round-robin by rank across runs so every subquestion gets its best evidence before any gets its tenth.
  const byRun = new Map<string, EvRow[]>();
  for (const r of rows.filter(servable)) byRun.set(r.run_id, [...(byRun.get(r.run_id) ?? []), r]);
  const queue: EvRow[] = [];
  for (let i = 0; [...byRun.values()].some((list) => list[i]); i++) for (const list of byRun.values()) if (list[i]) queue.push(list[i]!);

  const seen = new Set<string>();
  const items: EvidenceItem[] = [];
  let used = 0, dropped = 0;
  for (const r of queue) {
    if (seen.has(r.chunk_id)) continue; // one excerpt per chunk even when two subquestions retrieved it
    if (used + r.token_count > input.tokenBudget) { dropped++; continue; } // atomic: a row and its footnotes enter together or not at all
    seen.add(r.chunk_id);
    used += r.token_count;
    items.push({
      source_id: `${r.family_id}@${r.version}`, chunk_id: r.chunk_id, official_url: r.official_url, document_title: r.title, document_sha256: r.sha256,
      section: r.section, page: r.page_start, printed_page: r.printed_page,
      anchors: r.source_anchors.map((a) => ({ page: a.page, ...(a.page_end ? { page_end: a.page_end } : {}), ...(a.bbox ? { bbox: a.bbox } : {}), ...(a.row_index_on_page !== undefined ? { row_index_on_page: a.row_index_on_page } : {}) })),
      verbatim_excerpt: r.text, status: "active", category: (r.category as EvidenceItem["category"]) ?? null, subquestion: r.subquestion,
      required_context_type: r.required_context_type, selection_reason: r.selection_reason, rank: items.length + 1,
      footnote_markers: (r.table_json?.footnote_refs ?? []).map((n) => n.marker), token_count: r.token_count,
    });
  }

  // Required-context slots per subquestion, computed from what retrieval found (not from what fit the budget), plus
  // whether the kept bundle still carries each slot.
  const required_context: Record<string, Record<string, boolean>> = {};
  const runs = [...new Map(rows.map((r) => [r.run_id, r])).values()];
  for (const run of runs) {
    const mine = rows.filter((r) => r.run_id === run.run_id && servable(r));
    const kept = new Set(items.map((i) => i.chunk_id));
    const slots: Record<string, boolean> = {
      primary_found: mine.some((r) => !r.required_context_type),
      rule_row_found: mine.some((r) => r.selection_reason.includes("signed-off rule")),
      primary_in_bundle: mine.some((r) => !r.required_context_type && kept.has(r.chunk_id)),
    };
    for (const s of SLOTS) slots[s] = mine.some((r) => r.required_context_type === s);
    required_context[run.category ?? "district"] = slots;
  }

  const covered = new Set(runs.filter((r) => required_context[r.category ?? "district"]?.["primary_found"]).map((r) => r.category));
  const bundle = EvidenceBundle.parse({
    version: "evidence_bundle.v1", run_id: input.runId ?? null, retrieval_run_ids: input.retrievalRunIds, analysis_date: input.analysisDate,
    embedding_version_id: runs[0]?.embedding_version_id ?? null, token_budget: input.tokenBudget, tokens_used: used, items, required_context,
    flags: {
      active_version_confirmed: refused === 0,
      overlay_detected: runs.some((r) => (r.filters?.overlays ?? []).length > 0),
      coverage_gaps: CATEGORIES.filter((c) => !covered.has(c)),
      dropped_for_budget: dropped, refused_inactive: refused,
    },
  });
  assertNoVerdictWords(bundle);
  return bundle;
}

// The copy rule applies to every string the assembler writes itself (reasons, slot names, flags); excerpts are the
// ordinance's own words and are exempt, since the code may say "permitted" and that is quoted evidence, not a verdict.
function assertNoVerdictWords(b: EvidenceBundle): void {
  const written = [
    ...b.items.flatMap((i) => [i.selection_reason, i.required_context_type ?? ""]),
    ...Object.entries(b.required_context).flatMap(([k, v]) => [k, ...Object.keys(v)]),
    ...b.flags.coverage_gaps,
  ].join("\n");
  const hits = findBannedPhrases(written);
  if (hits.length) throw new Error(`evidence bundle would carry verdict words: ${hits.map((h) => `"${h.phrase}" in "${h.text}"`).join("; ")}`);
}
