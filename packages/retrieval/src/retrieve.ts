import type postgres from "postgres";
import { activeVersion, localHashProvider, openAiProvider, toVectorLiteral, type EmbeddingVersion, type Provider } from "@parcelpilot/db";

// The hybrid retriever (MOO-830; 04 §6). For one subquestion and one parcel context it returns ranked evidence plus the
// context a reader needs around it, and records what was searched and found. It orders evidence; it never decides
// pass/fail (the rules engine reads only approved zoning_rules).
//
// Order: hard filters → exact lexical lookup → semantic search under one embedding version → approved-rule table rows
// pinned first → Reciprocal Rank Fusion → optional rerank (order only) → required-context expansion.
type Q = postgres.Sql | postgres.TransactionSql;
export const PLANNER_VERSION = "hybrid-v1";
const RRF_K = 60;
const LIST_DEPTH = 50;

export type RetrieveInput = {
  jurisdictionId: string;
  subquestion: string;
  category?: string | null; // a RuleCategory; null for district-applicability or procedure questions
  districts: string[]; // the parcel's base districts; required: a search is never unfiltered
  overlays?: string[];
  analysisDate: string; // YYYY-MM-DD; the effective-date window is checked against this, not today
  subchapters?: string[]; // chapter family; defaults from the districts
  k?: number;
  orgId?: string | null; // null only for offline evaluation runs
  feasibilityRunId?: string | null;
  versionId?: string; // embedding version; defaults to the active one
  rerank?: Reranker;
  shortlist?: number; // how many fused candidates the reranker sees (default 20)
  pinRuleRows?: boolean; // keep approved-rule rows first (default true); false lets the reranker order them too
  record?: boolean; // write retrieval_runs / retrieval_evidence (default true)
};
export type Reranker = { name: string; rerank(query: string, candidates: Hit[]): Promise<Hit[]> };

export type Hit = {
  chunk_id: string; family_id: string; rank: number; section: string; heading: string | null; page_start: number; page_end: number | null; source_type: string;
  document_sha: string; text: string; district_codes: string[]; anchors: unknown;
  lexical_rank: number | null; semantic_rank: number | null; lexical_score: number | null; semantic_score: number | null; rerank_score: number | null; relevance: number;
  reason: string; context_type: string | null; footnotes: string[];
};
export type ContextSlot = "parent_section" | "adjacent" | "definition" | "cross_reference" | "exception" | "superseding_amendment" | "district_general_provision" | "overlay";
export type RetrieveResult = { run_id: string | null; version: EmbeddingVersion; hits: Hit[]; context: Hit[]; context_found: Partial<Record<ContextSlot, boolean>>; filters: Record<string, unknown> };

// District prefix → the subchapter that regulates it, plus the general subchapters every question may need.
const SUBCHAPTER_OF: Array<[RegExp, string]> = [[/^(RS|RT|RM|RO)\d/, "5"], [/^(NS|LB|RB|CS)\d?$/, "6"], [/^(C9|CS)/, "7"], [/^(IO|IL|IM|IH)\d/, "8"], [/^(PD|DPD|IC|RED)/, "9"]];
const GENERAL_SUBCHAPTERS = ["1", "2", "3", "4"];
export function defaultSubchapters(districts: string[], overlays: string[] = []): string[] {
  const own = districts.flatMap((d) => SUBCHAPTER_OF.filter(([re]) => re.test(d)).map(([, s]) => s));
  return [...new Set([...own, ...GENERAL_SUBCHAPTERS, ...(overlays.length ? ["10", "11"] : [])])];
}

export function providerFor(version: EmbeddingVersion): Provider {
  if (version.provider === "openai") return openAiProvider();
  if (version.provider === "local-hash") return { ...localHashProvider(), model: version.model_name };
  throw new Error(`no provider for embedding version ${version.provider}/${version.model_name}`);
}

export type Row = Omit<Hit, "rank" | "lexical_rank" | "semantic_rank" | "rerank_score" | "relevance" | "reason" | "context_type" | "footnotes"> & { score: number; parent_section_id: string | null; preceding_chunk_id: string | null; following_chunk_id: string | null; cross_reference_ids: string[]; table_json: { footnote_refs?: Array<{ marker: string; text: string }> } | null };

// The hard filters as one SQL fragment over code_chunks c joined to source_documents d. Every query below uses it.
function filtered(sql: Q, i: Required<Pick<RetrieveInput, "jurisdictionId" | "districts" | "analysisDate">> & { category: string | null; subchapters: string[] }, opts: { chapterFamily?: boolean } = {}) {
  return sql`
    c.jurisdiction_id = ${i.jurisdictionId} and c.status = 'active' and d.status = 'active'
    and (c.effective_start is null or c.effective_start <= ${i.analysisDate}::date) and (c.effective_end is null or c.effective_end > ${i.analysisDate}::date)
    and (d.effective_start is null or d.effective_start <= ${i.analysisDate}::date) and (d.effective_end is null or d.effective_end > ${i.analysisDate}::date)
    and (cardinality(c.district_codes) = 0 or c.district_codes && ${i.districts}::text[])
    and (${i.category}::text is null or cardinality(c.rule_categories) = 0 or ${i.category}::rule_category = any(c.rule_categories))
    ${opts.chapterFamily === false ? sql`` : sql`and c.subchapter = any(${i.subchapters}::text[])`}`;
}
const COLS = (sql: Q) => sql`c.id as chunk_id, c.family_id, c.section, c.heading, c.page_start, c.page_end, c.source_type::text as source_type, d.sha256 as document_sha, c.text,
  c.district_codes, c.source_anchors as anchors, c.parent_section_id, c.preceding_chunk_id, c.following_chunk_id, c.cross_reference_ids, c.table_json`;

export async function retrieve(sql: Q, input: RetrieveInput): Promise<RetrieveResult> {
  if (!input.districts.length) throw new Error("retrieve needs the parcel's districts: a search is never run without its hard filters");
  const version = input.versionId
    ? (await sql<EmbeddingVersion[]>`select id, provider, model_name, dimension, is_active from embedding_versions where id = ${input.versionId}`)[0]
    : await activeVersion(sql);
  if (!version) throw new Error("no embedding version: run pnpm embed first");
  const f = { jurisdictionId: input.jurisdictionId, districts: input.districts, analysisDate: input.analysisDate, category: input.category ?? null, subchapters: input.subchapters ?? defaultSubchapters(input.districts, input.overlays) };
  const where = filtered(sql, f);
  const k = input.k ?? 10;

  // Lexical: every stemmed word, district code and section number in the question, OR-ed, ranked by cover density.
  const lexText = `${input.subquestion} ${input.districts.join(" ")}`;
  const lexical = await sql<Row[]>`
    with q as (select string_agg(quote_literal(l), ' | ')::tsquery as tsq from unnest(tsvector_to_array(to_tsvector('zoning_code', ${lexText}) || zoning_code_tokens(${lexText}))) l)
    select ${COLS(sql)}, ts_rank_cd(c.tsv, q.tsq)::float as score
    from code_chunks c join source_documents d on d.id = c.source_document_id, q
    where q.tsq is not null and c.tsv @@ q.tsq and ${where}
    order by score desc, c.id limit ${LIST_DEPTH}`;
  // Semantic: nearest neighbours among the same filtered set, embedded by this version only.
  const [qv] = (await providerFor(version).embed([input.subquestion])).vectors;
  const semantic = await sql<Row[]>`
    select ${COLS(sql)}, (1 - (c.embedding <=> ${toVectorLiteral(qv!)}::vector))::float as score
    from code_chunks c join source_documents d on d.id = c.source_document_id
    where c.embedding_version_id = ${version.id} and c.embedding is not null and ${where}
    order by c.embedding <=> ${toVectorLiteral(qv!)}::vector, c.id limit ${LIST_DEPTH}`;
  // Approved rules for this category: their cited table rows are pinned first, never the rule number alone (04 §6.2 step 4).
  const ruleRows = input.category ? await sql<Row[]>`
    select distinct on (c.id) ${COLS(sql)}, 1::float as score
    from zoning_rules z join rule_citations rc on rc.zoning_rule_id = z.id join citations ci on ci.id = rc.citation_id
    join code_chunks c on c.source_document_id = ci.source_document_id and c.section = ci.section
      and ((c.source_type = 'table_row' and c.text like 'Table ' || ci.section || '. ' || split_part(ci.excerpt, ':', 1) || '%')
        -- a condition's citation is prose (e.g. s. 295-603-2-a-2, the street-level dwelling limit): pin that section's chunk
        or (c.source_type <> 'table_row' and ci.anchor is distinct from ('Table ' || ci.section) and c.page_start <= ci.page_number and coalesce(c.page_end, c.page_start) >= ci.page_number))
    join source_documents d on d.id = c.source_document_id
    where z.jurisdiction_id = ${input.jurisdictionId} and z.status = 'approved' and z.category = ${input.category}::rule_category and z.district_code = any(${input.districts}::text[])
      and ${where}` : [];

  const fused = input.pinRuleRows === false ? fuse(lexical, semantic, []) : fuse(lexical, semantic, ruleRows);
  const ordered = input.rerank ? await rerankShortlist(input.rerank, input.subquestion, fused, input.shortlist ?? 20, input.pinRuleRows === false ? 0 : pinnedCount(fused, ruleRows)) : fused;
  const hits = ordered.slice(0, k).map((h, i) => ({ ...h, rank: i + 1 }));
  const { context, found } = await expandContext(sql, where, hits.slice(0, 3), rowsById([...lexical, ...semantic, ...ruleRows]), input, k);
  const filters = { ...f, overlays: input.overlays ?? [], k };
  const run_id = input.record === false ? null : await record(sql, input, version, filters, hits, context);
  return { run_id, version, hits, context, context_found: found, filters };
}

const rowsById = (rows: Row[]) => new Map(rows.map((r) => [r.chunk_id, r]));
const footnotesOf = (r: Row) => (r.table_json?.footnote_refs ?? []).map((n) => `${n.marker} ${n.text}`);

function toHit(r: Row, extra: Partial<Hit>): Hit {
  const { score: _s, parent_section_id: _p, preceding_chunk_id: _a, following_chunk_id: _b, cross_reference_ids: _x, table_json: _t, ...base } = r;
  return { ...base, rank: 0, lexical_rank: null, semantic_rank: null, lexical_score: null, semantic_score: null, rerank_score: null, relevance: 0, reason: "", context_type: null, footnotes: footnotesOf(r), ...extra };
}

// Reciprocal Rank Fusion: 1/(60 + rank) summed over the lists a chunk appears in; rank-based, so the two lists' raw
// scores never need to be comparable. Rule-cited rows are pinned ahead of everything else.
export function fuse(lexical: Row[], semantic: Row[], ruleRows: Row[]): Hit[] {
  const acc = new Map<string, Hit>();
  const add = (rows: Row[], which: "lexical" | "semantic") => rows.forEach((r, i) => {
    const h = acc.get(r.chunk_id) ?? toHit(r, {});
    const rank = i + 1;
    acc.set(r.chunk_id, which === "lexical"
      ? { ...h, lexical_rank: rank, lexical_score: r.score, relevance: h.relevance + 1 / (RRF_K + rank) }
      : { ...h, semantic_rank: rank, semantic_score: r.score, relevance: h.relevance + 1 / (RRF_K + rank) });
  });
  add(lexical, "lexical");
  add(semantic, "semantic");
  const pinned = new Set(ruleRows.map((r) => r.chunk_id));
  for (const r of ruleRows) if (!acc.has(r.chunk_id)) acc.set(r.chunk_id, toHit(r, {}));
  const reasonOf = (h: Hit) => [pinned.has(h.chunk_id) ? (h.source_type === "table_row" ? "table row cited by a signed-off rule" : "passage cited by a signed-off rule's condition") : null, h.lexical_rank ? `keyword rank ${h.lexical_rank}` : null, h.semantic_rank ? `meaning rank ${h.semantic_rank}` : null].filter(Boolean).join("; ");
  return [...acc.values()]
    .map((h) => ({ ...h, reason: reasonOf(h) }))
    .sort((a, b) => Number(pinned.has(b.chunk_id)) - Number(pinned.has(a.chunk_id)) || b.relevance - a.relevance || a.chunk_id.localeCompare(b.chunk_id));
}

const pinnedCount = (fused: Hit[], ruleRows: Row[]) => { const p = new Set(ruleRows.map((r) => r.chunk_id)); return fused.filter((h) => p.has(h.chunk_id)).length; };

// The reranker sees the shortlist only (never the corpus) and may only reorder it. Rule-pinned rows stay first unless
// pinning is switched off; everything past the shortlist keeps its fused order.
async function rerankShortlist(r: Reranker, query: string, hits: Hit[], size: number, pinned: number): Promise<Hit[]> {
  const head = hits.slice(0, pinned);
  const shortlist = hits.slice(pinned, Math.max(pinned, size));
  const tail = hits.slice(Math.max(pinned, size));
  if (!shortlist.length) return hits;
  const out = await r.rerank(query, shortlist.map((h, i) => ({ ...h, rank: pinned + i + 1 })));
  const before = new Set(shortlist.map((h) => h.chunk_id));
  if (out.length !== shortlist.length || out.some((h) => !before.has(h.chunk_id))) throw new Error(`reranker ${r.name} changed the candidate set; it may only reorder`);
  return [...head, ...out, ...tail];
}

// Required-context expansion (04 §6.2 step 5) for the top hits: governing section, neighbours, cross-referenced
// sections, exceptions in the same section, Subchapter 4 text naming the district, overlay text. Every slot records
// whether it was found, so the bundle can say what is missing instead of looking complete.
async function expandContext(sql: Q, where: ReturnType<typeof filtered>, top: Hit[], known: Map<string, Row>, input: RetrieveInput, k: number) {
  const seen = new Set(top.map((h) => h.chunk_id));
  const context: Hit[] = [];
  const found: Partial<Record<ContextSlot, boolean>> = {};
  const take = (slot: ContextSlot, rows: Row[]) => {
    found[slot] = (found[slot] ?? false) || rows.length > 0;
    for (const r of rows) if (!seen.has(r.chunk_id)) { seen.add(r.chunk_id); context.push(toHit(r, { context_type: slot, reason: `required context: ${slot.replace(/_/g, " ")}` })); }
  };
  const anyChapter = filtered(sql, { ...input, category: input.category ?? null, subchapters: [] }, { chapterFamily: false });
  for (const h of top) {
    const r = known.get(h.chunk_id);
    if (!r) continue;
    // A defined term the passage uses (04 §6.3): cross_reference_ids hold code_sections ids, so resolve through the
    // section to its definition chunk. Definitions live in Subchapter 2, outside most chapter families, so lift that filter.
    if (r.cross_reference_ids.length) take("definition", await sql<Row[]>`
      select distinct on (c.id) ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      join code_sections s on s.id = any(${r.cross_reference_ids}::uuid[]) and c.section = s.section and c.source_document_id = s.source_document_id
      where c.chunk_kind = 'definition' and ${anyChapter} order by c.id limit 3`);
    // An amendment that supersedes or modifies the passage's own section (idea from PR #31), so a live change is never assumed absent.
    take("superseding_amendment", await sql<Row[]>`select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      where c.source_type = 'amendment' and c.section = ${r.section} and ${anyChapter} order by c.page_start, c.id limit 2`);
    // "see s. 295-505-2-b": a section cited in the text is a cross reference even when it sits in another subchapter.
    // Same served / in-force / district rules; only the chapter family is lifted.
    take("cross_reference", await sql<Row[]>`
      with cited as (select l from unnest(tsvector_to_array(zoning_code_tokens(${r.text}))) l where l <> lower(${r.section}))
      select distinct on (c.section) ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      where lower(c.section) in (select l from cited) and c.source_type <> 'table_row' and ${anyChapter} order by c.section, c.page_start, c.id limit 3`);
    // A table row is governed by the prose of the section that carries the table's own number (Table 295-605-2 →
    // s. 295-605-2); a prose chunk by its section's parent. The linked code_sections row is the fallback.
    take("parent_section", await sql<Row[]>`
      with target as (select case when ${r.source_type} = 'table_row' then s.id else s.parent_section_id end as id from code_sections s where s.id = ${r.parent_section_id})
      select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      where c.source_type = 'ordinance_text' and c.source_document_id = (select source_document_id from code_chunks where id = ${r.chunk_id})
        and (c.section = case when ${r.source_type} = 'table_row' then ${r.section} end
             or c.section = (select s.section from code_sections s where s.id = (select id from target)))
        and ${where}
      order by (c.section = ${r.section}) desc, c.page_start, c.id limit 1`);
    take("adjacent", await sql<Row[]>`select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      where c.id = any(${[r.preceding_chunk_id, r.following_chunk_id].filter((x): x is string => !!x)}::uuid[]) and ${where}`);
    if (r.cross_reference_ids.length) take("cross_reference", await sql<Row[]>`select distinct on (c.section) ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      join code_sections s on s.id = any(${r.cross_reference_ids}::uuid[]) and c.section = s.section and c.source_document_id = s.source_document_id where ${where} order by c.section, c.page_start limit 3`);
    take("exception", await sql<Row[]>`select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
      where c.chunk_kind = 'exception' and c.parent_section_id = ${r.parent_section_id} and ${where} limit 2`);
  }
  take("district_general_provision", await sql<Row[]>`select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
    where c.subchapter = '4' and c.tsv @@ (select string_agg(quote_literal(lower(x)), ' | ')::tsquery from unnest(${input.districts}::text[]) x) and ${where} limit 2`);
  if (input.overlays?.length) take("overlay", await sql<Row[]>`select ${COLS(sql)}, 0::float as score from code_chunks c join source_documents d on d.id = c.source_document_id
    where c.subchapter in ('10', '11') and c.tsv @@ (select string_agg(quote_literal(lower(x)), ' | ')::tsquery from unnest(${input.overlays}::text[]) x) and ${where} limit 2`);
  return { context: context.map((h, i) => ({ ...h, rank: k + i + 1 })), found };
}

async function record(sql: Q, input: RetrieveInput, version: EmbeddingVersion, filters: Record<string, unknown>, hits: Hit[], context: Hit[]): Promise<string> {
  const [run] = await sql<{ id: string }[]>`
    insert into retrieval_runs (feasibility_run_id, org_id, subquestion, category, filters, embedding_version_id, reranker_model, planner_version, status, completed_at)
    values (${input.feasibilityRunId ?? null}, ${input.orgId ?? null}, ${input.subquestion}, ${input.category ?? null}::rule_category, ${sql.json(filters as never)}, ${version.id}, ${input.rerank?.name ?? null}, ${PLANNER_VERSION}, 'succeeded', now())
    returning id`;
  for (const h of [...hits, ...context]) {
    await sql`insert into retrieval_evidence (retrieval_run_id, org_id, code_chunk_id, rank, lexical_score, semantic_score, rerank_score, relevance_score, selection_reason, required_context_type, required_context_found, anchors)
      values (${run!.id}, ${input.orgId ?? null}, ${h.chunk_id}, ${h.rank}, ${h.lexical_score}, ${h.semantic_score}, ${h.rerank_score}, ${h.relevance}, ${h.reason || "fused"}, ${h.context_type}, true,
        ${sql.json({ document_sha: h.document_sha, anchors: h.anchors } as never)})`;
  }
  return run!.id;
}
