import type postgres from "postgres";
import { ZoningRule, type OrgRole, type ReviewStatus, type RuleCitation } from "@parcelpilot/contracts";

// The reviewer queue (04 §10, MOO-819). Every function runs on the service connection because the queue,
// candidates, rules and sources are jurisdiction-shared. Transitions take a transaction so a route can
// wrap one HTTP call in one `sql.begin`; tests pass a rolled-back transaction the same way.
export type Q = postgres.Sql | postgres.TransactionSql;
export type Actor = { userId: string; orgId: string; role: OrgRole };
export const REVIEWER_ROLES: readonly OrgRole[] = ["reviewer", "owner", "admin"];
export const REVIEW_TASK_TYPES = ["rule_candidate_review", "merge_review", "page_review", "footnote_review", "source_review", "gis_ambiguity"] as const;
export type TaskType = (typeof REVIEW_TASK_TYPES)[number];

export class ReviewError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "ReviewError";
    this.code = code;
    this.status = status;
  }
}

export type ReviewTask = {
  id: string; jurisdiction_id: string; task_type: TaskType; entity_type: string; entity_id: string; assigned_to: string | null;
  status: ReviewStatus; priority: string | null; reason: string | null; resolved_by: string | null; resolved_at: string | null; created_at: string; updated_at: string;
  subject?: TaskSubject; // what the task is about, for the queue list (joined per entity type)
  audit?: AuditRef; // the audit row the last transition wrote
};
export type TaskSubject = { title: string; district: string | null; category: string | null; page: number | null; printed_page: number | null; document: string | null };
export type AuditRef = { id: string; action: string; created_at: string };

const PENDING: ReviewStatus[] = ["unreviewed", "in_review"];
const AUDIT_ENTITY: Record<TaskType, string> = { rule_candidate_review: "rule", merge_review: "merge", page_review: "page", footnote_review: "footnote", source_review: "source", gis_ambiguity: "gis" };
const SEVERITY = ["critical", "high", "medium", "low"] as const; // contracts Criticality order, most severe first
const rank = (c: unknown): number => { const i = (SEVERITY as readonly unknown[]).indexOf(c); return i === -1 ? SEVERITY.length : i; };
const OCR_DENSITY_THRESHOLD = 0.5; // services/worker-py/app/pages.py: native characters per square inch below which a page was OCR'd

// ---- generation: code decides what needs a human look; idempotent per (task_type, entity_type, entity_id) ----

export async function generateReviewTasks(sql: Q, jurisdictionId: string): Promise<Record<string, number>> {
  const merge = await sql`
    insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
    select d.jurisdiction_id, 'merge_review', 'source_table', t.id, 'high',
           'Table ' || t.family_key || ' spans pages ' || t.page_start || '-' || t.page_end || ': confirm the fragments are one table and the headers carry over'
    from source_tables t join source_documents d on d.id = t.source_document_id
    where d.jurisdiction_id = ${jurisdictionId} and t.merge_review_status = 'unreviewed'
      and (select count(*) from table_fragments f where f.source_table_id = t.id) > 1
    on conflict (task_type, entity_type, entity_id) do nothing`;
  const page = await sql`
    insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
    select d.jurisdiction_id, 'page_review', 'document_page', p.id, 'medium',
           case when p.ocr_confidence is not null then 'ocr: confidence ' || p.ocr_confidence else 'thin: char_density ' || coalesce(p.char_density::text, 'unknown') end
    from document_pages p join source_documents d on d.id = p.source_document_id
    where d.jurisdiction_id = ${jurisdictionId} and (p.ocr_confidence is not null or p.char_density is null or p.char_density < ${OCR_DENSITY_THRESHOLD})
    on conflict (task_type, entity_type, entity_id) do nothing`;
  const footnote = await sql`
    insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
    select d.jurisdiction_id, 'footnote_review', 'table_footnote', n.id, 'medium',
           'Footnote ' || n.marker || ' on table ' || t.family_key || ': confirm which rows it modifies'
    from table_footnotes n join source_tables t on t.id = n.source_table_id join source_documents d on d.id = t.source_document_id
    where d.jurisdiction_id = ${jurisdictionId}
    on conflict (task_type, entity_type, entity_id) do nothing`;
  const candidate = await sql`
    insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
    select c.jurisdiction_id, 'rule_candidate_review', 'rule_candidate', c.id,
           coalesce((c.proposed_rule->>'criticality')::criticality, 'medium'),
           'Candidate ' || c.category || ' rule for ' || c.district_code || ' extracted by ' || c.extraction_method
    from rule_candidates c
    where c.jurisdiction_id = ${jurisdictionId} and c.reviewer_status in ('unreviewed', 'in_review')
    on conflict (task_type, entity_type, entity_id) do nothing`;
  return { merge_review: merge.count, page_review: page.count, footnote_review: footnote.count, rule_candidate_review: candidate.count };
}

export async function listTasks(sql: Q, filter: { jurisdictionId: string; id?: string; status?: ReviewStatus; taskType?: TaskType; district?: string; limit?: number }): Promise<ReviewTask[]> {
  // One left join per entity type; `subject` tells a reviewer what the task is about without opening it.
  return sql<ReviewTask[]>`
    select t.id, t.jurisdiction_id, t.task_type, t.entity_type, t.entity_id, t.assigned_to, t.status, t.priority, t.reason, t.resolved_by, t.resolved_at::text, t.created_at::text, t.updated_at::text,
      jsonb_build_object(
        'title', case t.entity_type
          when 'rule_candidate' then coalesce(c.proposed_rule->>'label', c.category || ' · ' || c.district_code || ' · ' || coalesce(c.row_key, 'manual'))
          when 'source_table' then 'Table ' || replace(replace(st.family_key, 'tbl_', ''), '_', '-') || ' pages ' || st.page_start || '-' || st.page_end
          when 'document_page' then coalesce(pd.title, 'Document') || ' page ' || p.page_number
          when 'table_footnote' then 'Footnote ' || n.marker || ' on ' || replace(replace(nt.family_key, 'tbl_', ''), '_', '-')
          when 'source_document' then coalesce(sd.title, 'Document')
          else t.entity_type end,
        'district', c.district_code, 'category', c.category::text,
        'page', coalesce(p.page_number, st.page_start, nt.page_start),
        'printed_page', p.printed_page,
        'document', coalesce(pd.title, std.title, ntd.title, sd.title)
      ) as subject
    from review_tasks t
    left join rule_candidates c on t.entity_type = 'rule_candidate' and c.id = t.entity_id
    left join source_tables st on t.entity_type = 'source_table' and st.id = t.entity_id
    left join source_documents std on std.id = st.source_document_id
    left join document_pages p on t.entity_type = 'document_page' and p.id = t.entity_id
    left join source_documents pd on pd.id = p.source_document_id
    left join table_footnotes n on t.entity_type = 'table_footnote' and n.id = t.entity_id
    left join source_tables nt on nt.id = n.source_table_id
    left join source_documents ntd on ntd.id = nt.source_document_id
    left join source_documents sd on t.entity_type = 'source_document' and sd.id = t.entity_id
    where t.jurisdiction_id = ${filter.jurisdictionId}
      ${filter.id ? sql`and t.id = ${filter.id}` : sql``}
      ${filter.status ? sql`and t.status = ${filter.status}` : sql``}
      ${filter.taskType ? sql`and t.task_type = ${filter.taskType}` : sql``}
      ${filter.district ? sql`and c.district_code = ${filter.district}` : sql``}
    order by case t.status when 'in_review' then 0 when 'unreviewed' then 1 else 2 end, array_position(${SEVERITY as unknown as string[]}::text[], t.priority::text) nulls last, t.created_at
    limit ${filter.limit ?? 200}`;
}

// ---- detail: everything a reviewer needs on screen for one task, assembled server-side ----

export type PageRef = { id: string; page_number: number; printed_page: number | null; raw_text: string; image_ref: string | null };
export type CanonicalRow = { row_key: string; label: string; unit: string | null; group?: string | null; cells: Record<string, string>; markers: Record<string, string>; sources: Array<{ page: number; row_index_on_page: number; bbox: [number, number, number, number]; fragment_page: number }>; footnote_refs: Array<{ marker: string; page: number; text: string }>; applicable_footnotes: string[]; family_id: string };
export type FragmentRef = { id: string; page_number: number; bbox: { x0: number; y0: number; x1: number; y1: number }; headers: unknown; rows: unknown[]; extractor: string; continuation_signals: string[]; page: PageRef | null };
export type TaskDetail = { task: ReviewTask } & (
  | { kind: "rule_candidate_review"; candidate: { id: string; family_id: string; district_code: string; category: string; proposed_rule: Record<string, unknown>; extracted_value: unknown; row_key: string | null; reviewer_status: ReviewStatus; reviewer_notes: string | null; extraction_method: string; approved_rule_id: string | null }; table: { family_key: string; columns: string[] } | null; row: CanonicalRow | null; page: PageRef | null; footnotes: Array<{ marker: string; text: string; page_number: number | null }>; citations: Array<{ id: string; page_number: number; printed_page: number | null; section: string | null; excerpt: string; document: string }> }
  | { kind: "merge_review"; table: { id: string; family_key: string; caption: string | null; page_start: number; page_end: number; columns: string[]; merge_review_status: ReviewStatus; row_count: number }; fragments: FragmentRef[] }
  | { kind: "page_review"; page: PageRef; document: string }
  | { kind: "footnote_review"; footnote: { marker: string; text: string; applies_to_row_keys: string[] | null }; table: { family_key: string }; page: PageRef | null }
  | { kind: "other" }
);

async function pageById(sql: Q, id: string | null): Promise<PageRef | null> {
  if (!id) return null;
  const [p] = await sql<PageRef[]>`select id, page_number, printed_page, raw_text, image_ref from document_pages where id = ${id}`;
  return p ?? null;
}
async function pageByNumber(sql: Q, docId: string, n: number): Promise<PageRef | null> {
  const [p] = await sql<PageRef[]>`select id, page_number, printed_page, raw_text, image_ref from document_pages where source_document_id = ${docId} and page_number = ${n}`;
  return p ?? null;
}

export async function getTaskDetail(sql: Q, taskId: string): Promise<TaskDetail> {
  const [j] = await sql<{ j: string }[]>`select jurisdiction_id as j from review_tasks where id = ${taskId}`;
  const [t] = j ? await listTasks(sql, { jurisdictionId: j.j, id: taskId, limit: 1 }) : [];
  if (!t) throw new ReviewError("not_found", "review task not found", 404);
  if (t.task_type === "rule_candidate_review") {
    const [c] = await sql<Array<TaskDetail extends infer _ ? { id: string; family_id: string; district_code: string; category: string; proposed_rule: Record<string, unknown>; extracted_value: unknown; row_key: string | null; reviewer_status: ReviewStatus; reviewer_notes: string | null; extraction_method: string; approved_rule_id: string | null; source_table_id: string | null; citation_ids: string[] } : never>>`
      select id, family_id, district_code, category::text as category, proposed_rule, extracted_value, row_key, reviewer_status, reviewer_notes, extraction_method, approved_rule_id, source_table_id, citation_ids from rule_candidates where id = ${t.entity_id}`;
    if (!c) throw new ReviewError("not_found", "rule candidate not found", 404);
    const [st] = c.source_table_id ? await sql<{ source_document_id: string; family_key: string; column_schema: string[]; canonical_rows: CanonicalRow[] }[]>`select source_document_id, family_key, column_schema, canonical_rows from source_tables where id = ${c.source_table_id}` : [];
    const row = st?.canonical_rows.find((r) => r.row_key === c.row_key) ?? null;
    const page = st && row?.sources[0] ? await pageByNumber(sql, st.source_document_id, row.sources[0].page) : null;
    const footnotes = st && row ? await sql<Array<{ marker: string; text: string; page_number: number | null }>>`
      select n.marker, n.text, f.page_number from table_footnotes n left join table_fragments f on f.id = n.fragment_id
      where n.source_table_id = ${c.source_table_id} and n.marker = any(${row.footnote_refs.map((r) => r.marker)}) order by f.page_number, n.marker` : [];
    const citations = c.citation_ids.length ? await sql<Array<{ id: string; page_number: number; printed_page: number | null; section: string | null; excerpt: string; document: string }>>`
      select ci.id, ci.page_number, ci.printed_page, ci.section, ci.excerpt, d.title as document from citations ci join source_documents d on d.id = ci.source_document_id where ci.id = any(${c.citation_ids}) order by ci.page_number` : [];
    const { source_table_id: _st, citation_ids: _ci, ...candidate } = c;
    return { task: t, kind: "rule_candidate_review", candidate, table: st ? { family_key: st.family_key, columns: st.column_schema } : null, row, page, footnotes, citations };
  }
  if (t.task_type === "merge_review") {
    const [st] = await sql<Array<{ id: string; family_key: string; caption: string | null; page_start: number; page_end: number; columns: string[]; merge_review_status: ReviewStatus; row_count: number }>>`
      select id, family_key, caption, page_start, page_end, column_schema as columns, merge_review_status, jsonb_array_length(canonical_rows) as row_count from source_tables where id = ${t.entity_id}`;
    if (!st) throw new ReviewError("not_found", "table family not found", 404);
    const frags = await sql<Array<Omit<FragmentRef, "page"> & { document_page_id: string | null }>>`select id, page_number, bbox, headers, rows, extractor, continuation_signals, document_page_id from table_fragments where source_table_id = ${st.id} order by page_number`;
    const pageIds = frags.map((f) => f.document_page_id).filter((id): id is string => !!id);
    const pages = pageIds.length ? await sql<PageRef[]>`select id, page_number, printed_page, raw_text, image_ref from document_pages where id = any(${pageIds})` : [];
    const byId = new Map(pages.map((p) => [p.id, p]));
    const fragments: FragmentRef[] = frags.map(({ document_page_id, ...rest }) => ({ ...rest, page: document_page_id ? byId.get(document_page_id) ?? null : null }));
    return { task: t, kind: "merge_review", table: st, fragments };
  }
  if (t.task_type === "page_review") {
    const page = await pageById(sql, t.entity_id);
    if (!page) throw new ReviewError("not_found", "page not found", 404);
    const [d] = await sql<{ title: string }[]>`select d.title from document_pages p join source_documents d on d.id = p.source_document_id where p.id = ${t.entity_id}`;
    return { task: t, kind: "page_review", page, document: d?.title ?? "" };
  }
  if (t.task_type === "footnote_review") {
    const [n] = await sql<Array<{ marker: string; text: string; applies_to_row_keys: string[] | null; family_key: string; document_page_id: string | null; source_document_id: string; page_start: number }>>`
      select n.marker, n.text, n.applies_to_row_keys, st.family_key, f.document_page_id, st.source_document_id, st.page_start
      from table_footnotes n join source_tables st on st.id = n.source_table_id left join table_fragments f on f.id = n.fragment_id where n.id = ${t.entity_id}`;
    if (!n) throw new ReviewError("not_found", "footnote not found", 404);
    const page = (await pageById(sql, n.document_page_id)) ?? (await pageByNumber(sql, n.source_document_id, n.page_start));
    return { task: t, kind: "footnote_review", footnote: { marker: n.marker, text: n.text, applies_to_row_keys: n.applies_to_row_keys }, table: { family_key: n.family_key }, page };
  }
  return { task: t, kind: "other" };
}

export type SourceSummary = { id: string; title: string; source_type: string; status: string; review_status: ReviewStatus; published_marker: string | null; effective_start: string | null; effective_end: string | null; page_count: number | null; sha256: string; supersedes_id: string | null; retrieved_at: string };
export async function listSources(sql: Q, jurisdictionId: string): Promise<SourceSummary[]> {
  return sql<SourceSummary[]>`select id, title, source_type::text as source_type, status::text as status, review_status, published_marker, effective_start::text, effective_end::text, page_count, sha256, supersedes_id, retrieved_at::text
    from source_documents where jurisdiction_id = ${jurisdictionId} order by status, title`;
}

// ---- transitions: unreviewed → in_review → approved | rejected; every one leaves an audit row ----

async function loadTask(sql: Q, taskId: string): Promise<ReviewTask> {
  const [t] = await sql<ReviewTask[]>`select id, jurisdiction_id, task_type, entity_type, entity_id, assigned_to, status, priority, reason, resolved_by, resolved_at::text, created_at::text, updated_at::text from review_tasks where id = ${taskId} for update`;
  if (!t) throw new ReviewError("not_found", "review task not found", 404);
  return t;
}

function mustBePending(t: ReviewTask): void {
  if (!PENDING.includes(t.status)) throw new ReviewError("not_pending", `task is already ${t.status}`, 409);
}

async function audit(sql: Q, actor: Actor, action: string, entityType: string, entityId: string, payload: Record<string, unknown>): Promise<AuditRef> {
  const [a] = await sql<AuditRef[]>`insert into audit_events (org_id, actor_user_id, action, entity_type, entity_id, payload) values (${actor.orgId}, ${actor.userId}, ${action}, ${entityType}, ${entityId}, ${sql.json(payload as never)}) returning id, action, created_at::text`;
  return a!;
}

async function saveTask(sql: Q, taskId: string, set: { status: ReviewStatus; assigned_to?: string | null; resolved_by?: string | null; reason?: string | null }): Promise<ReviewTask> {
  const resolved = set.status === "approved" || set.status === "rejected";
  const [t] = await sql<ReviewTask[]>`
    update review_tasks set status = ${set.status},
      assigned_to = coalesce(${set.assigned_to ?? null}, assigned_to),
      resolved_by = ${resolved ? (set.resolved_by ?? null) : null}, resolved_at = ${resolved ? sql`now()` : null},
      reason = coalesce(${set.reason ?? null}, reason), updated_at = now()
    where id = ${taskId}
    returning id, jurisdiction_id, task_type, entity_type, entity_id, assigned_to, status, priority, reason, resolved_by, resolved_at::text, created_at::text, updated_at::text`;
  return t!;
}

export async function claimTask(sql: Q, actor: Actor, taskId: string): Promise<ReviewTask> {
  const t = await loadTask(sql, taskId);
  mustBePending(t);
  if (t.status === "in_review" && t.assigned_to && t.assigned_to !== actor.userId) throw new ReviewError("already_claimed", "task is in review by another reviewer", 409);
  const saved = await saveTask(sql, taskId, { status: "in_review", assigned_to: actor.userId });
  const a = await audit(sql, actor, "review_task.claimed", "review_task", taskId, { task_type: t.task_type, entity_type: t.entity_type, entity_id: t.entity_id });
  return { ...saved, audit: a };
}

export async function rejectTask(sql: Q, actor: Actor, taskId: string, reason: string | null): Promise<ReviewTask> {
  if (!reason?.trim()) throw new ReviewError("reason_required", "a rejection needs a stated reason", 400);
  const t = await loadTask(sql, taskId);
  mustBePending(t);
  if (t.task_type === "rule_candidate_review") {
    await sql`update rule_candidates set reviewer_status = 'rejected', reviewer_id = ${actor.userId}, reviewer_notes = ${reason}, updated_at = now() where id = ${t.entity_id}`;
  } else if (t.task_type === "merge_review") {
    // A rejected merge closes the family: the trigger keeps candidates out, and a corrected extraction is a new source_tables row.
    await sql`update source_tables set merge_review_status = 'rejected' where id = ${t.entity_id}`;
  }
  const saved = await saveTask(sql, taskId, { status: "rejected", resolved_by: actor.userId, reason });
  const a = await audit(sql, actor, `${AUDIT_ENTITY[t.task_type]}.rejected`, t.entity_type, t.entity_id, { task_id: taskId, reason });
  return { ...saved, audit: a };
}

const EDITABLE_KEYS = ["district_code", "category", "kind", "params", "conditions", "criticality"] as const;

// An edit changes the proposal a reviewer will approve, never a rule: the candidate is the only mutable thing here.
export async function editTask(sql: Q, actor: Actor, taskId: string, reason: string | null, patch: unknown): Promise<ReviewTask> {
  if (!reason?.trim()) throw new ReviewError("reason_required", "an edit needs a stated reason", 400);
  const t = await loadTask(sql, taskId);
  mustBePending(t);
  if (t.task_type !== "rule_candidate_review") throw new ReviewError("not_editable", `a ${t.task_type} task has nothing to edit`, 409);
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new ReviewError("patch_required", "edit needs a patch object", 400);
  const rejectedKeys = Object.keys(patch).filter((k) => !(EDITABLE_KEYS as readonly string[]).includes(k));
  if (rejectedKeys.length) throw new ReviewError("patch_invalid", `cannot edit ${rejectedKeys.join(", ")}; editable: ${EDITABLE_KEYS.join(", ")}`, 400);
  const [before] = await sql<{ proposed_rule: Record<string, unknown> }[]>`select proposed_rule from rule_candidates where id = ${t.entity_id} for update`;
  // Lowering criticality would let a reviewer sidestep the owner sign-off (decision 011): only an owner may lower it.
  const next = (patch as Record<string, unknown>)["criticality"];
  if (next !== undefined && rank(next) > rank(before?.proposed_rule["criticality"]) && actor.role !== "owner") throw new ReviewError("owner_required", "only an owner may lower a candidate's criticality", 403);
  const [after] = await sql<{ proposed_rule: unknown }[]>`
    update rule_candidates set proposed_rule = proposed_rule || ${sql.json(patch as never)}, reviewer_id = ${actor.userId}, reviewer_notes = ${reason}, reviewer_status = 'in_review', updated_at = now()
    where id = ${t.entity_id} returning proposed_rule`;
  const saved = await saveTask(sql, taskId, { status: "in_review", assigned_to: actor.userId, reason });
  const a = await audit(sql, actor, "rule.edited", t.entity_type, t.entity_id, { task_id: taskId, reason, patch, before: before?.proposed_rule, after: after?.proposed_rule });
  return { ...saved, audit: a };
}

export type ApproveResult = { task: ReviewTask; rule?: { id: string; family_id: string; version: number; supersedes_id: string | null }; pending_second_approval?: true };

export async function approveTask(sql: Q, actor: Actor, taskId: string): Promise<ApproveResult> {
  const t = await loadTask(sql, taskId);
  mustBePending(t);
  if (t.task_type === "rule_candidate_review") return approveCandidate(sql, actor, t);
  if (t.task_type === "merge_review") {
    await sql`update source_tables set merge_review_status = 'approved' where id = ${t.entity_id}`;
  }
  const task = await saveTask(sql, taskId, { status: "approved", resolved_by: actor.userId });
  const a = await audit(sql, actor, `${AUDIT_ENTITY[t.task_type]}.approved`, t.entity_type, t.entity_id, { task_id: taskId });
  return { task: { ...task, audit: a } };
}

type CandidateRow = { id: string; jurisdiction_id: string; family_id: string; district_code: string; category: string; proposed_rule: Record<string, unknown>; citation_ids: string[]; reviewer_status: ReviewStatus; reviewer_id: string | null };
type CitationRow = { id: string; sha256: string; page_number: number; printed_page: number | null; section: string | null; anchor: string | null; excerpt: string; effective_start: string | null };

// Approval mints: one new zoning_rules row (version = previous + 1, supersedes the previous), its rule_citations,
// and the candidate flips to approved. A critical rule needs the owner's sign-off (04 §10 step 5): a reviewer's
// approval is recorded as the first sign-off and the task stays in review until an owner approves.
async function approveCandidate(sql: Q, actor: Actor, t: ReviewTask): Promise<ApproveResult> {
  const [cand] = await sql<CandidateRow[]>`select id, jurisdiction_id, family_id, district_code, category, proposed_rule, citation_ids, reviewer_status, reviewer_id from rule_candidates where id = ${t.entity_id} for update`;
  if (!cand) throw new ReviewError("not_found", "rule candidate not found", 404);
  if (cand.reviewer_status === "approved" || cand.reviewer_status === "rejected") throw new ReviewError("not_pending", `candidate is already ${cand.reviewer_status}`, 409);
  const proposal = cand.proposed_rule;
  // The task's priority was set from the proposal when the task was generated and is never edited, so an edit to the
  // proposal cannot lower the bar below what the extraction said: the gate uses whichever is more severe.
  const critical = proposal["criticality"] === "critical" || t.priority === "critical";
  if (critical && actor.role !== "owner") {
    await sql`update rule_candidates set reviewer_status = 'in_review', reviewer_id = ${actor.userId}, updated_at = now() where id = ${cand.id}`;
    const task = await saveTask(sql, t.id, { status: "in_review", assigned_to: actor.userId });
    const a = await audit(sql, actor, "rule.first_approved", t.entity_type, t.entity_id, { task_id: t.id, awaiting: "owner" });
    return { task: { ...task, audit: a }, pending_second_approval: true };
  }
  if (cand.citation_ids.length === 0) throw new ReviewError("no_citations", "a rule cannot be approved without a citation", 409);
  const cites = await sql<CitationRow[]>`
    select c.id, d.sha256, c.page_number, c.printed_page, c.section, c.anchor, c.excerpt, d.effective_start::text as effective_start
    from citations c join source_documents d on d.id = c.source_document_id where c.id = any(${cand.citation_ids}) order by c.page_number, c.section`;
  if (cites.length !== cand.citation_ids.length) throw new ReviewError("citation_missing", "a cited row does not exist", 409);
  const stamps = cites.map((c) => c.effective_start);
  if (stamps.length === 0 || stamps.some((st) => !st)) throw new ReviewError("source_unstamped", "a cited source has no effective_start; stamp the document first", 409);
  const effectiveStart = [...(stamps as string[])].sort().at(-1)!; // in force only once every cited document is
  const citations: RuleCitation[] = cites.map((c) => ({ citation_id: c.id, document_id: c.sha256, page: c.page_number, section: c.section ?? "", excerpt: c.excerpt, ...(c.printed_page ? { printed_page: c.printed_page } : {}), ...(c.anchor ? { table: c.anchor } : {}) }));
  // One mint per family at a time. An advisory lock, not `for update`: zoning_rules is append-only and the service role
  // holds no UPDATE right on it, so a row lock is refused with "permission denied" (found live in MOO-821).
  await sql`select pg_advisory_xact_lock(hashtext(${cand.family_id}))`;
  const [prev] = await sql<{ id: string; version: number }[]>`select id, version from zoning_rules where family_id = ${cand.family_id} order by version desc limit 1`;
  const version = (prev?.version ?? 0) + 1;
  // The contract validates kind/category/params together; approval never stores a rule the engine could not load.
  const rule = ZoningRule.parse({
    id: "pending", family_id: cand.family_id, version, jurisdiction_id: cand.jurisdiction_id, district_code: proposal["district_code"] ?? cand.district_code,
    category: proposal["category"] ?? cand.category, kind: proposal["kind"], params: proposal["params"], conditions: proposal["conditions"] ?? [], criticality: proposal["criticality"],
    citations, effective_start: effectiveStart, effective_end: proposal["effective_end"] ?? null, status: "approved",
  });
  const [row] = await sql<{ id: string }[]>`
    insert into zoning_rules (family_id, version, jurisdiction_id, district_code, category, kind, params, conditions, criticality, status, approved_by, approved_at, effective_start, effective_end, supersedes_id)
    values (${rule.family_id}, ${version}, ${rule.jurisdiction_id}, ${rule.district_code}, ${rule.category}, ${rule.kind}, ${sql.json(rule.params as never)}, ${sql.json(rule.conditions as never)}, ${rule.criticality}, 'approved', ${actor.userId}, now(), ${rule.effective_start}, ${rule.effective_end}, ${prev?.id ?? null})
    returning id`;
  const ruleId = row!.id;
  for (const c of cites) await sql`insert into rule_citations (zoning_rule_id, citation_id) values (${ruleId}, ${c.id})`;
  await sql`update rule_candidates set reviewer_status = 'approved', reviewer_id = ${actor.userId}, approved_rule_id = ${ruleId}, updated_at = now() where id = ${cand.id}`;
  const task = await saveTask(sql, t.id, { status: "approved", resolved_by: actor.userId });
  const a = await audit(sql, actor, "rule.approved", "zoning_rule", ruleId, { task_id: t.id, candidate_id: cand.id, family_id: cand.family_id, version, supersedes_id: prev?.id ?? null, citations: cites.map((c) => c.id) });
  return { task: { ...task, audit: a }, rule: { id: ruleId, family_id: cand.family_id, version, supersedes_id: prev?.id ?? null } };
}

// ---- source lifecycle: pending_review → active → superseded | withdrawn. Chunks and tables are never touched; active_code_chunks filters. ----

export type SourceAction = "activate" | "supersede" | "withdraw";
type SourceRow = { id: string; status: string; effective_start: string | null; effective_end: string | null; supersedes_id: string | null };

export async function transitionSource(sql: Q, actor: Actor, sourceId: string, action: SourceAction, successorId?: string | null, reason?: string | null): Promise<SourceRow & { audit: AuditRef }> {
  const [doc] = await sql<SourceRow[]>`select id, status, effective_start::text, effective_end::text, supersedes_id from source_documents where id = ${sourceId} for update`;
  if (!doc) throw new ReviewError("not_found", "source document not found", 404);
  let saved: SourceRow | undefined;
  if (action === "activate") {
    if (doc.status !== "pending_review") throw new ReviewError("not_pending", `a ${doc.status} document cannot be activated; a code revision is a new document`, 409);
    [saved] = await sql<SourceRow[]>`update source_documents set status = 'active', review_status = 'approved' where id = ${sourceId} returning id, status, effective_start::text, effective_end::text, supersedes_id`;
  } else if (action === "supersede") {
    if (!successorId) throw new ReviewError("successor_required", "supersede needs the successor document's id", 400);
    if (successorId === sourceId) throw new ReviewError("successor_invalid", "a document cannot supersede itself", 400);
    const [next] = await sql<SourceRow[]>`select id, status, effective_start::text, effective_end::text, supersedes_id from source_documents where id = ${successorId}`;
    if (!next) throw new ReviewError("not_found", "successor document not found", 404);
    if (doc.status === "superseded" || doc.status === "withdrawn") throw new ReviewError("not_active", `document is already ${doc.status}`, 409);
    [saved] = await sql<SourceRow[]>`update source_documents set status = 'superseded', effective_end = coalesce(${next.effective_start}::date, current_date) where id = ${sourceId} returning id, status, effective_start::text, effective_end::text, supersedes_id`;
    await sql`update source_documents set supersedes_id = ${sourceId} where id = ${successorId} and supersedes_id is null`;
  } else {
    if (doc.status === "withdrawn") throw new ReviewError("not_active", "document is already withdrawn", 409);
    [saved] = await sql<SourceRow[]>`update source_documents set status = 'withdrawn', effective_end = coalesce(effective_end, current_date) where id = ${sourceId} returning id, status, effective_start::text, effective_end::text, supersedes_id`;
  }
  const a = await audit(sql, actor, `source.${action === "supersede" ? "superseded" : action === "activate" ? "activated" : "withdrawn"}`, "source_document", sourceId, { from: doc.status, to: saved!.status, successor_id: successorId ?? null, effective_end: saved!.effective_end, reason: reason ?? null });
  return { ...saved!, audit: a };
}
