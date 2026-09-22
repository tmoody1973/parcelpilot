import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { activateCorpus } from "./corpus-activation.ts";
import { approveTask, generateReviewTasks, rejectTask, type Actor } from "./review-store.ts";

// MOO-827 against the compose DB, as the service role the jobs and routes use. Every test rolls back.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
test.after(() => sql.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const J = "milwaukee-wi";

async function world(tx: postgres.TransactionSql) {
  const [org] = await tx`insert into organizations (name, slug, clerk_org_id) values ('act org', 'act-' || gen_random_uuid(), 'clerk-' || gen_random_uuid()) returning id`;
  const [u] = await tx`insert into users (email) values ('act-' || gen_random_uuid() || '@dev.local') returning id`;
  await tx`insert into memberships (org_id, user_id, role) values (${org!["id"]}, ${u!["id"]}, 'reviewer')`;
  const actor: Actor = { userId: u!["id"] as string, orgId: org!["id"] as string, role: "reviewer" };
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values (${J}, 'ordinance_subchapter', 'activation test doc', 'act-' || gen_random_uuid(), now(), 'manual_upload', 'active', '2025-07-15') returning id`;
  const doc = d!["id"] as string;
  const page = async (n: number, density: number) => (await tx`insert into document_pages (source_document_id, page_number, raw_text, char_density, content_hash) values (${doc}, ${n}, 'text', ${density}, 'h-' || gen_random_uuid()) returning id`)[0]!["id"] as string;
  const cleanPage = await page(1, 5), thinPage = await page(2, 0.1);
  const [okSec] = await tx`insert into code_sections (source_document_id, chapter, section, heading, sort_order, confidence) values (${doc}, '295', '295-901-1', 'Clear', 1, 'high') returning id`;
  const [lowSec] = await tx`insert into code_sections (source_document_id, chapter, section, heading, sort_order, confidence) values (${doc}, '295', '295-901-2', 'Unsure', 2, 'low') returning id`;
  await tx`insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason) values (${J}, 'page_review', 'code_section', ${lowSec!["id"]}, 'medium', 'hierarchy unsure')`;
  const [tbl] = await tx`insert into source_tables (source_document_id, family_key, page_start, page_end, extractor) values (${doc}, 'tbl_295_901_3', 1, 2, 'pdfplumber') returning id`;
  for (const n of [1, 2]) await tx`insert into table_fragments (source_table_id, document_page_id, page_number, bbox, headers, rows, extractor) values (${tbl!["id"]}, ${cleanPage}, ${n}, '{}', '[]', '[]', 'pdfplumber')`;
  const chunk = async (section: string, pageNo: number, parent: string | null, type = "ordinance_text") =>
    (await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, subchapter, section, heading, source_type, source_document_id, page_start, text, parent_section_id, effective_start)
      values ('act-' || gen_random_uuid(), 1, ${J}, '295', '9', ${section}, 'h', ${type}::code_source_type, ${doc}, ${pageNo}, 'Chunk text', ${parent}, '2025-07-15') returning id`)[0]!["id"] as string;
  const c = {
    clean: await chunk("295-901-1", 1, okSec!["id"] as string),
    onThinPage: await chunk("295-901-1", 2, okSec!["id"] as string),
    uncertain: await chunk("295-901-2", 1, lowSec!["id"] as string),
    tableRow: await chunk("295-901-3", 1, null, "table_row"),
  };
  await generateReviewTasks(tx, J); // opens the page_review for the thin page and the merge_review for the two-fragment table
  const taskFor = async (entity: string) => (await tx`select id from review_tasks where entity_id = ${entity}`)[0]!["id"] as string;
  return { actor, c, thinPage, lowSec: lowSec!["id"] as string, tbl: tbl!["id"] as string, taskFor };
}
const statusOf = async (tx: postgres.TransactionSql, id: string) => (await tx`select status from code_chunks where id = ${id}`)[0]!["status"];

test("the job clears clean chunks and holds back flagged pages, uncertain sections and unmerged tables; a rerun changes nothing", () => rolledBack(async (tx) => {
  const w = await world(tx);
  await activateCorpus(tx, J);
  assert.equal(await statusOf(tx, w.c.clean), "active");
  assert.equal(await statusOf(tx, w.c.onThinPage), "pending_review", "chunk on a page with an open page_review");
  assert.equal(await statusOf(tx, w.c.uncertain), "pending_review", "chunk under a low-confidence section");
  assert.equal(await statusOf(tx, w.c.tableRow), "pending_review", "table row of an unreviewed family");
  assert.ok((await tx`select 1 from active_code_chunks where id = ${w.c.clean}`).length === 1, "served once active");
  assert.equal((await activateCorpus(tx, J)).activated, 0, "second run changes zero rows");
}));

test("approving a page review activates its chunks; rejecting withdraws them; approving the merge activates the rows", () => rolledBack(async (tx) => {
  const w = await world(tx);
  await activateCorpus(tx, J);
  const page = await approveTask(tx, w.actor, await w.taskFor(w.thinPage));
  assert.equal(await statusOf(tx, w.c.onThinPage), "active");
  const [a] = await tx`select payload from audit_events where id = ${page.task.audit!.id}`;
  assert.equal((a!["payload"] as { chunks_activated: number }).chunks_activated, 1);
  await rejectTask(tx, w.actor, await w.taskFor(w.lowSec), "heading belongs to the previous section");
  assert.equal(await statusOf(tx, w.c.uncertain), "withdrawn");
  await approveTask(tx, w.actor, await w.taskFor(w.tbl));
  assert.equal(await statusOf(tx, w.c.tableRow), "active");
}));

test("the guard: text is frozen, status moves only once from pending, deletes are refused; embeddings may be written", () => rolledBack(async (tx) => {
  const w = await world(tx);
  await activateCorpus(tx, J);
  const refused = (q: (sp: postgres.TransactionSql) => Promise<unknown>) => assert.rejects(tx.savepoint(q), /append-only/);
  await refused((sp) => sp`update code_chunks set text = 'edited' where id = ${w.c.clean}`);
  await refused((sp) => sp`update code_chunks set status = 'pending_review' where id = ${w.c.clean}`);
  await refused((sp) => sp`update code_chunks set status = 'withdrawn' where id = ${w.c.clean}`);
  await assert.rejects(tx.savepoint((sp) => sp`delete from code_chunks where id = ${w.c.clean}`), /append-only|permission denied/, "no role may delete a chunk");
  await tx`update code_chunks set embedding = array_fill(0.01::real, array[1536])::vector where id = ${w.c.clean}`;
  assert.ok((await tx`select embedding is not null as e from code_chunks where id = ${w.c.clean}`)[0]!["e"]);
}));
