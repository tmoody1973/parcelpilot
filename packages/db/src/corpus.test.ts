import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

// Integration test for migration 0013 (corpus + review tables) against the compose DB. Writes roll back.
const OWNER = process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot";
const owner = postgres(OWNER, { max: 1 });
test.after(() => owner.end());

class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await owner.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const rejects = (tx: postgres.TransactionSql, run: (sp: postgres.TransactionSql) => Promise<unknown>, re: RegExp, code?: string) =>
  assert.rejects(tx.savepoint(run), (e: unknown) => { assert.match(String(e), re); if (code) assert.equal((e as { code?: string }).code, code); return true; });

async function doc(tx: postgres.TransactionSql, status: string) {
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values ('milwaukee-wi', 'ordinance_subchapter', 'corpus test doc', 'corpus-' || gen_random_uuid(), now(), 'manual_upload', ${status}, '2025-07-15') returning id`;
  return d!["id"] as string;
}
async function page(tx: postgres.TransactionSql, docId: string, n = 16) {
  const [p] = await tx`insert into document_pages (source_document_id, page_number, printed_page, raw_text, content_hash) values (${docId}, ${n}, 824, 'Height, maximum (ft.) LB1 45', 'h-' || gen_random_uuid()) returning id`;
  return p!["id"] as string;
}
async function chunk(tx: postgres.TransactionSql, docId: string, status: string, fam = "fam-" + crypto.randomUUID()) {
  const [c] = await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, section, heading, source_type, source_document_id, page_start, text, status, effective_start)
    values (${fam}, 1, 'milwaukee-wi', '295', '295-603-2-a-2', 'Limited use standards', 'ordinance_text', ${docId}, 6, 'No dwelling unit shall be located in the street-level area on a principal arterial.', ${status}, '2025-07-15') returning id`;
  return c!["id"] as string;
}

test("active_code_chunks: only active chunks of active, in-force documents; flipping the document flips visibility", () => rolledBack(async (tx) => {
  const superseded = await doc(tx, "superseded");
  const active = await doc(tx, "active");
  const hidden = await chunk(tx, superseded, "active");
  const shown = await chunk(tx, active, "active");
  const pending = await chunk(tx, active, "pending_review");
  const ids = (await tx`select id from active_code_chunks`).map((r) => r["id"]);
  assert.ok(ids.includes(shown), "active chunk of active doc is served");
  assert.ok(!ids.includes(hidden), "chunk of superseded doc is never served");
  assert.ok(!ids.includes(pending), "pending chunk is not served");
  await tx`update source_documents set status = 'active' where id = ${superseded}`;
  assert.ok((await tx`select id from active_code_chunks`).map((r) => r["id"]).includes(hidden), "activating the document makes its chunk visible");
  await tx`update source_documents set status = 'withdrawn' where id = ${active}`;
  assert.ok(!(await tx`select id from active_code_chunks`).map((r) => r["id"]).includes(shown), "withdrawing hides it again");
}));

test("code_chunks: tsv is generated and searchable; family+version unique; rows are append-only", () => rolledBack(async (tx) => {
  const d = await doc(tx, "active");
  const id = await chunk(tx, d, "active", "fam-tsv");
  const hits = await tx`select id from code_chunks where tsv @@ plainto_tsquery('english', 'street-level dwelling') and id = ${id}`;
  assert.equal(hits.length, 1, "full-text index finds the chunk");
  await rejects(tx, (sp) => chunk(sp, d, "active", "fam-tsv"), /code_chunks_family_version_idx/);
  await rejects(tx, (sp) => sp`update code_chunks set text = 'edited' where id = ${id}`, /append-only/, "55000");
  await rejects(tx, (sp) => sp`delete from code_chunks where id = ${id}`, /append-only/, "55000");
}));

test("pages, sections, tables, fragments, footnotes, embedding_versions are append-only; a citation can point at a page", () => rolledBack(async (tx) => {
  const d = await doc(tx, "active");
  const p = await page(tx, d);
  await rejects(tx, (sp) => sp`update document_pages set raw_text = 'x' where id = ${p}`, /append-only/, "55000");
  await rejects(tx, (sp) => sp`insert into document_pages (source_document_id, page_number, raw_text, content_hash) values (${d}, 16, 'dup', 'h2')`, /document_pages_doc_page_idx/);
  const [s] = await tx`insert into code_sections (source_document_id, chapter, section, heading, sort_order) values (${d}, '295', '295-605', 'Design standards', 1) returning id`;
  await rejects(tx, (sp) => sp`update code_sections set heading = 'x' where id = ${s!["id"]}`, /append-only/, "55000");
  const [t] = await tx`insert into source_tables (source_document_id, family_key, page_start, page_end, extractor) values (${d}, 'tbl_295_605_2', 16, 16, 'camelot_lattice') returning id`;
  await rejects(tx, (sp) => sp`update source_tables set caption = 'x' where id = ${t!["id"]}`, /append-only/, "55000");
  const [f] = await tx`insert into table_fragments (source_table_id, document_page_id, page_number, bbox, headers, rows, extractor) values (${t!["id"]}, ${p}, 16, '{"x0":0,"y0":0,"x1":1,"y1":1}', '["LB1"]', '[]', 'camelot_lattice') returning id`;
  await rejects(tx, (sp) => sp`delete from table_fragments where id = ${f!["id"]}`, /append-only/, "55000");
  const [n] = await tx`insert into table_footnotes (source_table_id, fragment_id, marker, text) values (${t!["id"]}, ${f!["id"]}, '*', 'applies in lieu of') returning id`;
  await rejects(tx, (sp) => sp`update table_footnotes set text = 'x' where id = ${n!["id"]}`, /append-only/, "55000");
  const [e] = await tx`insert into embedding_versions (provider, model_name, dimension) values ('openai', 'text-embedding-3-large', 1536) returning id`;
  await rejects(tx, (sp) => sp`update embedding_versions set is_active = true where id = ${e!["id"]}`, /append-only/, "55000");
  const [c] = await tx`insert into citations (source_document_id, document_page_id, page_number, printed_page, section, excerpt) values (${d}, ${p}, 16, 824, '295-605-2', 'Height, maximum (ft.): LB1 45') returning id`;
  assert.ok(c!["id"]);
}));

test("source_tables: merge_review_status may change (the queue approves a merge); every other column is frozen", () => rolledBack(async (tx) => {
  const d = await doc(tx, "active");
  const [t] = await tx`insert into source_tables (source_document_id, family_key, page_start, page_end, extractor) values (${d}, 'tbl_295_505_2', 13, 14, 'docling') returning id`;
  await tx`update source_tables set merge_review_status = 'approved' where id = ${t!["id"]}`;
  const [row] = await tx`select merge_review_status from source_tables where id = ${t!["id"]}`;
  assert.equal(row?.["merge_review_status"], "approved");
  await rejects(tx, (sp) => sp`update source_tables set caption = 'x' where id = ${t!["id"]}`, /append-only except merge_review_status/, "55000");
  await rejects(tx, (sp) => sp`delete from source_tables where id = ${t!["id"]}`, /append-only/, "55000");
}));

test("rule_candidates and review_tasks are mutable and the task per entity is unique", () => rolledBack(async (tx) => {
  const [cand] = await tx`insert into rule_candidates (jurisdiction_id, family_id, district_code, category, proposed_rule, extracted_value, extraction_method)
    values ('milwaukee-wi', 'lb3-height-max', 'LB3', 'height', '{"kind":"max_height_ft","params":{"max_ft":75}}', '{"cell":"75"}', 'table_row') returning id`;
  await tx`update rule_candidates set reviewer_status = 'in_review' where id = ${cand!["id"]}`;
  const [task] = await tx`insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id) values ('milwaukee-wi', 'rule_candidate_review', 'rule_candidate', ${cand!["id"]}) returning id`;
  await rejects(tx, (sp) => sp`insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id) values ('milwaukee-wi', 'rule_candidate_review', 'rule_candidate', ${cand!["id"]})`, /review_tasks_entity_idx/);
  await tx`update review_tasks set status = 'rejected', reason = 'cell misread', resolved_at = now() where id = ${task!["id"]}`;
  const [row] = await tx`select status, reason from review_tasks where id = ${task!["id"]}`;
  assert.deepEqual([row?.["status"], row?.["reason"]], ["rejected", "cell misread"]);
}));
