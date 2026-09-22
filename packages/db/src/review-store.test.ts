import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { approveTask, claimTask, editTask, generateReviewTasks, listTasks, rejectTask, ReviewError, transitionSource, type Actor } from "./review-store.ts";
import { loadApprovedRules, sourceStates } from "./rules-store.ts";

// Integration tests for the review queue (MOO-819) against the compose DB. Every test writes inside a rolled-back transaction.
const OWNER = process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot";
const owner = postgres(OWNER, { max: 1 });
test.after(() => owner.end());

class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await owner.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const rejectsWith = async (run: () => Promise<unknown>, code: string) => {
  await assert.rejects(run, (e: unknown) => { assert.ok(e instanceof ReviewError, `expected ReviewError, got ${String(e)}`); assert.equal(e.code, code); return true; });
};

// ---- fixtures: a document with a page, a two-fragment table with a footnote, a citation, and users in two roles ----
type Fx = { docId: string; pageId: string; tableId: string; citationId: string; reviewer: Actor; owner: Actor; member: Actor };

async function fixtures(tx: postgres.TransactionSql, opts: { docStatus?: string; effectiveStart?: string | null } = {}): Promise<Fx> {
  const [org] = await tx`insert into organizations (name, slug, clerk_org_id) values ('review test org', 'review-' || gen_random_uuid(), 'clerk-' || gen_random_uuid()) returning id`;
  const user = async (role: string): Promise<Actor> => {
    const [u] = await tx`insert into users (email, full_name) values ('rv-' || gen_random_uuid() || '@dev.local', 'Review ' || ${role}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${org!["id"]}, ${u!["id"]}, ${role})`;
    return { userId: u!["id"] as string, orgId: org!["id"] as string, role: role as Actor["role"] };
  };
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values ('milwaukee-wi', 'ordinance_subchapter', 'review test doc', 'review-' || gen_random_uuid(), now(), 'manual_upload', ${opts.docStatus ?? "active"}, ${opts.effectiveStart === undefined ? "2025-07-15" : opts.effectiveStart}) returning id`;
  const docId = d!["id"] as string;
  const [p] = await tx`insert into document_pages (source_document_id, page_number, printed_page, raw_text, char_density, ocr_confidence, content_hash) values (${docId}, 16, 824, 'Height, maximum (ft.) LB1 45', 0.1, 55, 'h-' || gen_random_uuid()) returning id`;
  const pageId = p!["id"] as string;
  const [t] = await tx`insert into source_tables (source_document_id, family_key, page_start, page_end, extractor) values (${docId}, 'tbl_295_605_2', 16, 17, 'pdfplumber') returning id`;
  const tableId = t!["id"] as string;
  for (const n of [16, 17]) await tx`insert into table_fragments (source_table_id, document_page_id, page_number, bbox, headers, rows, extractor) values (${tableId}, ${pageId}, ${n}, '{"x0":0,"y0":0,"x1":1,"y1":1}', '["LB1"]', '[]', 'pdfplumber')`;
  await tx`insert into table_footnotes (source_table_id, marker, text) values (${tableId}, '*', 'applies in lieu of')`;
  const [c] = await tx`insert into citations (source_document_id, document_page_id, page_number, printed_page, section, anchor, excerpt) values (${docId}, ${pageId}, 16, 824, '295-605-2', '295-605-2', 'Height, maximum (ft.): LB1 45') returning id`;
  return { docId, pageId, tableId, citationId: c!["id"] as string, reviewer: await user("reviewer"), owner: await user("owner"), member: await user("member") };
}

async function candidate(tx: postgres.TransactionSql, fx: Fx, over: Record<string, unknown> = {}, family = "fam-" + crypto.randomUUID()): Promise<string> {
  const proposed = { district_code: "LB1", category: "height", kind: "max_height_ft", params: { max_ft: 45 }, conditions: [], criticality: "high", ...over };
  const [c] = await tx`insert into rule_candidates (jurisdiction_id, family_id, district_code, category, proposed_rule, extracted_value, source_table_id, row_key, citation_ids, extraction_method)
    values ('milwaukee-wi', ${family}, ${proposed.district_code as string}, ${proposed.category as string}, ${tx.json(proposed as never)}, '{"LB1":"45"}', ${fx.tableId}, 'height_maximum', ${[fx.citationId]}, 'table_row') returning id`;
  return c!["id"] as string;
}
const approveMerge = async (tx: postgres.TransactionSql, fx: Fx) => tx`update source_tables set merge_review_status = 'approved' where id = ${fx.tableId}`;
const taskFor = async (tx: postgres.TransactionSql, entityId: string) => (await tx`select id from review_tasks where entity_id = ${entityId}`)[0]!["id"] as string;
const auditRows = (tx: postgres.TransactionSql, action: string, entityId: string) => tx`select payload from audit_events where action = ${action} and entity_id = ${entityId}`;

test("generation: one task per multi-fragment table, thin/OCR page, footnote and candidate; a second sweep inserts nothing", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx); // the candidate needs it; the merge task below comes from a second, unreviewed table
  const [t2] = await tx`insert into source_tables (source_document_id, family_key, page_start, page_end, extractor) values (${fx.docId}, 'tbl_295_505_2', 14, 15, 'pdfplumber') returning id`;
  for (const n of [14, 15]) await tx`insert into table_fragments (source_table_id, document_page_id, page_number, bbox, headers, rows, extractor) values (${t2!["id"]}, ${fx.pageId}, ${n}, '{}', '[]', '[]', 'pdfplumber')`;
  const candId = await candidate(tx, fx, { criticality: "critical" });
  const first = await generateReviewTasks(tx, "milwaukee-wi");
  assert.ok(first["merge_review"]! >= 1 && first["page_review"]! >= 1 && first["footnote_review"]! >= 1 && first["rule_candidate_review"]! >= 1, JSON.stringify(first));
  const mine = await tx`select task_type, entity_id, priority from review_tasks where entity_id in (${t2!["id"]}, ${fx.pageId}, ${candId}) or entity_id in (select id from table_footnotes where source_table_id = ${fx.tableId})`;
  assert.deepEqual(mine.map((r) => r["task_type"]).sort(), ["footnote_review", "merge_review", "page_review", "rule_candidate_review"]);
  assert.equal(mine.find((r) => r["entity_id"] === candId)!["priority"], "critical", "candidate task priority follows the proposal's criticality");
  assert.equal((await tx`select 1 from review_tasks where entity_id = ${fx.tableId}`).length, 0, "an approved merge gets no task");
  const second = await generateReviewTasks(tx, "milwaukee-wi");
  assert.deepEqual(second, { merge_review: 0, page_review: 0, footnote_review: 0, rule_candidate_review: 0 });
}));

test("claim → approve mints a versioned rule with citations; audit rows for both transitions", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const taskId = await taskFor(tx, candId);
  const claimed = await claimTask(tx, fx.reviewer, taskId);
  assert.equal(claimed.status, "in_review"); assert.equal(claimed.assigned_to, fx.reviewer.userId);
  await rejectsWith(() => claimTask(tx, fx.owner, taskId), "already_claimed");
  const res = await approveTask(tx, fx.reviewer, taskId);
  assert.equal(res.task.status, "approved"); assert.equal(res.task.resolved_by, fx.reviewer.userId);
  assert.ok(res.rule && res.rule.version === 1 && res.rule.supersedes_id === null);
  const [rule] = await tx`select status, approved_by, effective_start::text, district_code, kind, params from zoning_rules where id = ${res.rule!.id}`;
  assert.equal(rule!["status"], "approved"); assert.equal(rule!["approved_by"], fx.reviewer.userId); assert.equal(rule!["effective_start"], "2025-07-15", "effective_start comes from the cited source's stamp");
  assert.deepEqual(rule!["params"], { max_ft: 45 });
  assert.equal((await tx`select 1 from rule_citations where zoning_rule_id = ${res.rule!.id} and citation_id = ${fx.citationId}`).length, 1);
  const [cand] = await tx`select reviewer_status, approved_rule_id from rule_candidates where id = ${candId}`;
  assert.equal(cand!["reviewer_status"], "approved"); assert.equal(cand!["approved_rule_id"], res.rule!.id);
  assert.equal((await auditRows(tx, "review_task.claimed", taskId)).length, 1);
  assert.equal((await auditRows(tx, "rule.approved", res.rule!.id)).length, 1);
  await rejectsWith(() => approveTask(tx, fx.reviewer, taskId), "not_pending");
  const loaded = await loadApprovedRules(tx as unknown as postgres.Sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1"], date: "2026-09-22" });
  assert.ok(loaded.some((r) => r.id === res.rule!.id && r.citations.length === 1), "the engine loader sees the minted rule with its citation");
}));

test("reject needs a reason, creates no rule, and the audit row carries the reason", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const taskId = await taskFor(tx, candId);
  await rejectsWith(() => rejectTask(tx, fx.reviewer, taskId, "  "), "reason_required");
  const before = (await tx`select count(*)::int as n from zoning_rules`)[0]!["n"];
  const t = await rejectTask(tx, fx.reviewer, taskId, "cell reads 46 on the page, not 45");
  assert.equal(t.status, "rejected"); assert.equal(t.reason, "cell reads 46 on the page, not 45");
  assert.equal((await tx`select count(*)::int as n from zoning_rules`)[0]!["n"], before, "a rejection never creates a rule");
  assert.equal((await tx`select reviewer_status from rule_candidates where id = ${candId}`)[0]!["reviewer_status"], "rejected");
  const [a] = await auditRows(tx, "rule.rejected", candId);
  assert.equal((a!["payload"] as { reason: string }).reason, "cell reads 46 on the page, not 45");
  await rejectsWith(() => approveTask(tx, fx.reviewer, taskId), "not_pending");
}));

test("edit needs a reason and a patch of editable keys; approval then mints from the edited proposal", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const taskId = await taskFor(tx, candId);
  await rejectsWith(() => editTask(tx, fx.reviewer, taskId, null, { params: { max_ft: 46 } }), "reason_required");
  await rejectsWith(() => editTask(tx, fx.reviewer, taskId, "typo", { family_id: "x" }), "patch_invalid");
  const t = await editTask(tx, fx.reviewer, taskId, "page reads 46", { params: { max_ft: 46 } });
  assert.equal(t.status, "in_review");
  const [a] = await auditRows(tx, "rule.edited", candId);
  assert.deepEqual((a!["payload"] as { patch: unknown }).patch, { params: { max_ft: 46 } });
  const res = await approveTask(tx, fx.reviewer, taskId);
  assert.deepEqual((await tx`select params from zoning_rules where id = ${res.rule!.id}`)[0]!["params"], { max_ft: 46 });
  const mergeTask = await taskFor(tx, fx.pageId);
  await rejectsWith(() => editTask(tx, fx.reviewer, mergeTask, "n/a", { params: {} }), "not_editable");
}));

test("a second candidate for the same family mints version 2 that supersedes version 1; version 1 is untouched", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const family = "fam-" + crypto.randomUUID();
  const c1 = await candidate(tx, fx, {}, family);
  await generateReviewTasks(tx, "milwaukee-wi");
  const v1 = (await approveTask(tx, fx.reviewer, await taskFor(tx, c1))).rule!;
  const [snap1] = await tx`select to_jsonb(z) as row from zoning_rules z where id = ${v1.id}`;
  const c2 = await candidate(tx, fx, { params: { max_ft: 50 } }, family);
  await generateReviewTasks(tx, "milwaukee-wi");
  const v2 = (await approveTask(tx, fx.owner, await taskFor(tx, c2))).rule!;
  assert.equal(v2.version, 2); assert.equal(v2.supersedes_id, v1.id);
  const [snap1after] = await tx`select to_jsonb(z) as row from zoning_rules z where id = ${v1.id}`;
  assert.deepEqual(snap1after!["row"], snap1!["row"], "version 1 is byte-identical after version 2 exists");
  await assert.rejects(tx.savepoint((sp) => sp`update zoning_rules set params = '{}' where id = ${v1.id}`), /append-only/);
  const loaded = (await loadApprovedRules(tx as unknown as postgres.Sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1"], date: "2026-09-22" })).filter((r) => r.family_id === family);
  assert.deepEqual(loaded.map((r) => r.version), [2], "the engine loader sees only the latest version of the family");
}));

test("critical candidate: a reviewer's approval is a first sign-off; the owner's approval mints", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx, { criticality: "critical" });
  await generateReviewTasks(tx, "milwaukee-wi");
  const taskId = await taskFor(tx, candId);
  const first = await approveTask(tx, fx.reviewer, taskId);
  assert.equal(first.pending_second_approval, true); assert.equal(first.task.status, "in_review"); assert.equal(first.rule, undefined);
  assert.equal((await tx`select count(*)::int as n from zoning_rules where family_id = (select family_id from rule_candidates where id = ${candId})`)[0]!["n"], 0);
  assert.equal((await auditRows(tx, "rule.first_approved", candId)).length, 1);
  const second = await approveTask(tx, fx.owner, taskId);
  assert.equal(second.task.status, "approved"); assert.equal(second.rule?.version, 1);
  assert.equal((await tx`select approved_by from zoning_rules where id = ${second.rule!.id}`)[0]!["approved_by"], fx.owner.userId);
}));

test("critical candidate: a reviewer cannot lower criticality to dodge the owner sign-off; the task priority backs the gate", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx, { criticality: "critical" });
  await generateReviewTasks(tx, "milwaukee-wi");
  const taskId = await taskFor(tx, candId);
  await rejectsWith(() => editTask(tx, fx.reviewer, taskId, "seems minor", { criticality: "high" }), "owner_required");
  await editTask(tx, fx.reviewer, taskId, "raising is fine", { criticality: "critical" });
  // Even if the proposal were lowered by other means, the task's priority (set at generation) still demands an owner.
  await tx`update rule_candidates set proposed_rule = proposed_rule || '{"criticality":"high"}' where id = ${candId}`;
  const res = await approveTask(tx, fx.reviewer, taskId);
  assert.equal(res.pending_second_approval, true); assert.equal(res.rule, undefined);
  await editTask(tx, fx.owner, taskId, "owner lowers after reading the page", { criticality: "high" });
  const minted = await approveTask(tx, fx.owner, taskId);
  assert.equal(minted.rule?.version, 1);
}));

test("rejecting a merge closes the family: status rejected, candidates stay blocked, no task regenerates", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const t = await rejectTask(tx, fx.reviewer, await taskFor(tx, fx.tableId), "page 17 is a different table");
  assert.equal(t.status, "rejected");
  assert.equal((await tx`select merge_review_status from source_tables where id = ${fx.tableId}`)[0]!["merge_review_status"], "rejected");
  await assert.rejects(tx.savepoint((sp) => candidate(sp, fx)), /merge_unreviewed/);
  assert.equal((await generateReviewTasks(tx, "milwaukee-wi"))["merge_review"], 0);
}));

test("effective_start is the latest stamp among the cited documents", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const [d2] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start) values ('milwaukee-wi', 'amendment', 'later amendment', 'review-' || gen_random_uuid(), now(), 'manual_upload', 'active', '2026-03-01') returning id`;
  const [c2] = await tx`insert into citations (source_document_id, page_number, section, excerpt) values (${d2!["id"]}, 2, '295-605-2', 'amended') returning id`;
  const candId = await candidate(tx, fx);
  await tx`update rule_candidates set citation_ids = ${[fx.citationId, c2!["id"] as string]} where id = ${candId}`;
  await generateReviewTasks(tx, "milwaukee-wi");
  const res = await approveTask(tx, fx.reviewer, await taskFor(tx, candId));
  assert.equal((await tx`select effective_start::text as s from zoning_rules where id = ${res.rule!.id}`)[0]!["s"], "2026-03-01");
}));

test("merge gate: no candidate for an unreviewed family (trigger); approving the merge task opens it", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await assert.rejects(tx.savepoint((sp) => candidate(sp, { ...fx }, {})), /merge_unreviewed/);
  await generateReviewTasks(tx, "milwaukee-wi");
  const mergeTask = await taskFor(tx, fx.tableId);
  const res = await approveTask(tx, fx.reviewer, mergeTask);
  assert.equal(res.task.status, "approved"); assert.equal(res.rule, undefined);
  assert.equal((await tx`select merge_review_status from source_tables where id = ${fx.tableId}`)[0]!["merge_review_status"], "approved");
  assert.equal((await auditRows(tx, "merge.approved", fx.tableId)).length, 1);
  assert.ok(await candidate(tx, fx), "candidates flow once the merge is approved");
}));

test("approval refuses a candidate with no citations or an unstamped source", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx, { effectiveStart: null });
  await approveMerge(tx, fx);
  const candId = await candidate(tx, fx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const tid = await taskFor(tx, candId);
  await rejectsWith(() => approveTask(tx, fx.reviewer, tid), "source_unstamped");
  await tx`update rule_candidates set citation_ids = '{}' where id = ${candId}`;
  await rejectsWith(() => approveTask(tx, fx.reviewer, tid), "no_citations");
}));

test("supersede: chunks vanish from active_code_chunks; the citation gate turns red; the successor points back", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx);
  await approveMerge(tx, fx);
  const [chunk] = await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, section, heading, source_type, source_document_id, page_start, text, status, effective_start)
    values ('fam-' || gen_random_uuid(), 1, 'milwaukee-wi', '295', '295-605-2', 'Design standards', 'table_row', ${fx.docId}, 16, 'Height, maximum (ft.) LB1 45', 'active', '2025-07-15') returning id`;
  const candId = await candidate(tx, fx);
  await generateReviewTasks(tx, "milwaukee-wi");
  const rule = (await approveTask(tx, fx.reviewer, await taskFor(tx, candId))).rule!;
  assert.ok((await tx`select id from active_code_chunks where id = ${chunk!["id"]}`).length === 1, "chunk served while the document is active");
  const [next] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start) values ('milwaukee-wi', 'ordinance_subchapter', 'successor', 'review-' || gen_random_uuid(), now(), 'manual_upload', 'active', '2026-01-01') returning id`;
  await rejectsWith(() => transitionSource(tx, fx.reviewer, fx.docId, "supersede", null), "successor_required");
  const doc = await transitionSource(tx, fx.reviewer, fx.docId, "supersede", next!["id"] as string);
  assert.equal(doc.status, "superseded"); assert.equal(doc.effective_end, "2026-01-01", "effective_end is the successor's effective_start");
  assert.equal((await tx`select supersedes_id from source_documents where id = ${next!["id"]}`)[0]!["supersedes_id"], fx.docId);
  assert.equal((await tx`select id from active_code_chunks where id = ${chunk!["id"]}`).length, 0, "superseded document's chunk is never served");
  assert.equal((await auditRows(tx, "source.superseded", fx.docId)).length, 1);
  const rules = (await loadApprovedRules(tx as unknown as postgres.Sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1"], date: "2026-09-22" })).filter((r) => r.id === rule.id);
  assert.equal(rules.length, 1, "the rule row itself is untouched");
  // The citation gate (zoning-core checkCitations) reads exactly this: a cited source that is not active, or whose
  // effective_end is on or before the analysis date, is source_inactive and the run cannot proceed.
  const states = await sourceStates(tx as unknown as postgres.Sql, rules[0]!.citations.map((c) => c.document_id));
  const state = Object.values(states)[0]!;
  assert.equal(state.status, "superseded"); assert.equal(state.effective_end, "2026-01-01");
  await rejectsWith(() => transitionSource(tx, fx.reviewer, fx.docId, "activate"), "not_pending");
}));

test("activate and withdraw", () => rolledBack(async (tx) => {
  const fx = await fixtures(tx, { docStatus: "pending_review" });
  const active = await transitionSource(tx, fx.owner, fx.docId, "activate");
  assert.equal(active.status, "active");
  assert.equal((await tx`select review_status from source_documents where id = ${fx.docId}`)[0]!["review_status"], "approved");
  const gone = await transitionSource(tx, fx.owner, fx.docId, "withdraw");
  assert.equal(gone.status, "withdrawn"); assert.ok(gone.effective_end);
  await rejectsWith(() => transitionSource(tx, fx.owner, fx.docId, "withdraw"), "not_active");
  assert.equal((await tx`select count(*)::int as n from audit_events where entity_id = ${fx.docId} and action in ('source.activated', 'source.withdrawn')`)[0]!["n"], 2);
  const queue = await listTasks(tx, { jurisdictionId: "milwaukee-wi", status: "unreviewed", limit: 5 });
  assert.ok(Array.isArray(queue));
}));
