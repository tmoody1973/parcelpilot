import type postgres from "postgres";

// Which chunks retrieval may read (MOO-827; 04 §10 last paragraph). A chunk is held back while a human still has to
// look at it: its page has an open page_review, its section's place in the hierarchy is uncertain (an open
// page_review on that code_section), or it is a table row whose family's merge is not approved. Everything else is
// cleared by this job. Clearing sets status = active only; reviewer_status stays as it was, because no person
// reviewed these chunks one by one. The served view still requires the document itself to be active and in force.
type Q = postgres.Sql | postgres.TransactionSql;
const OPEN = ["unreviewed", "in_review"] as const;

export type ActivationReport = { activated: number; by_subchapter: Record<string, { activated: number; still_pending: number }>; held: { flagged_page: number; uncertain_section: number; unmerged_table: number } };

export async function activateCorpus(sql: Q, jurisdictionId: string): Promise<ActivationReport> {
  const activated = await sql<{ subchapter: string | null }[]>`
    update code_chunks c set status = 'active'
    where c.jurisdiction_id = ${jurisdictionId} and c.status = 'pending_review'
      and not exists (
        select 1 from review_tasks t join document_pages p on p.id = t.entity_id
        where t.task_type = 'page_review' and t.entity_type = 'document_page' and t.status = any(${OPEN as unknown as string[]})
          and p.source_document_id = c.source_document_id and p.page_number between c.page_start and coalesce(c.page_end, c.page_start))
      and not exists (
        select 1 from review_tasks t
        where t.task_type = 'page_review' and t.entity_type = 'code_section' and t.status = any(${OPEN as unknown as string[]})
          and t.entity_id = c.parent_section_id)
      and (c.source_type <> 'table_row' or exists (
        select 1 from source_tables st
        where st.source_document_id = c.source_document_id and st.family_key = 'tbl_' || replace(c.section, '-', '_') and st.merge_review_status = 'approved'))
    returning c.subchapter`;
  const counts = await sql<{ subchapter: string | null; pending: number }[]>`
    select subchapter, count(*)::int as pending from code_chunks where jurisdiction_id = ${jurisdictionId} and status = 'pending_review' group by 1`;
  const [held] = await sql<{ flagged_page: number; uncertain_section: number; unmerged_table: number }[]>`
    select
      count(*) filter (where exists (select 1 from review_tasks t join document_pages p on p.id = t.entity_id
        where t.task_type = 'page_review' and t.entity_type = 'document_page' and t.status = any(${OPEN as unknown as string[]})
          and p.source_document_id = c.source_document_id and p.page_number between c.page_start and coalesce(c.page_end, c.page_start)))::int as flagged_page,
      count(*) filter (where exists (select 1 from review_tasks t where t.task_type = 'page_review' and t.entity_type = 'code_section'
          and t.status = any(${OPEN as unknown as string[]}) and t.entity_id = c.parent_section_id))::int as uncertain_section,
      count(*) filter (where c.source_type = 'table_row' and not exists (select 1 from source_tables st
          where st.source_document_id = c.source_document_id and st.family_key = 'tbl_' || replace(c.section, '-', '_') and st.merge_review_status = 'approved'))::int as unmerged_table
    from code_chunks c where c.jurisdiction_id = ${jurisdictionId} and c.status = 'pending_review'`;
  const by: ActivationReport["by_subchapter"] = {};
  for (const r of activated) { const k = r.subchapter ?? "?"; (by[k] ??= { activated: 0, still_pending: 0 }).activated++; }
  for (const r of counts) { const k = r.subchapter ?? "?"; (by[k] ??= { activated: 0, still_pending: 0 }).still_pending = r.pending; }
  return { activated: activated.length, by_subchapter: by, held: held! };
}

// A reviewer's decision on a page_review or merge_review settles the chunks it was holding back.
// Approve → active; reject → withdrawn. Returns how many chunks moved, for the audit row.
export async function settleChunksForTask(sql: Q, task: { task_type: string; entity_type: string; entity_id: string }, decision: "approve" | "reject"): Promise<number> {
  const next = decision === "approve" ? "active" : "withdrawn";
  if (task.task_type === "page_review" && task.entity_type === "document_page") {
    const r = await sql`update code_chunks c set status = ${next}::source_status from document_pages p
      where p.id = ${task.entity_id} and c.source_document_id = p.source_document_id and c.status = 'pending_review'
        and p.page_number between c.page_start and coalesce(c.page_end, c.page_start)`;
    return r.count;
  }
  if (task.task_type === "page_review" && task.entity_type === "code_section") {
    const r = await sql`update code_chunks set status = ${next}::source_status where parent_section_id = ${task.entity_id} and status = 'pending_review'`;
    return r.count;
  }
  if (task.task_type === "merge_review" && task.entity_type === "source_table" && decision === "approve") {
    // A rejected merge leaves its rows pending: the family is closed and a corrected extraction is a new table (MOO-819).
    const r = await sql`update code_chunks c set status = 'active' from source_tables st
      where st.id = ${task.entity_id} and c.source_document_id = st.source_document_id and c.source_type = 'table_row'
        and st.family_key = 'tbl_' || replace(c.section, '-', '_') and c.status = 'pending_review'`;
    return r.count;
  }
  return 0;
}
