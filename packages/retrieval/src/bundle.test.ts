import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { EvidenceBundle } from "@parcelpilot/contracts";
import { assembleBundle } from "./bundle.ts";

// MOO-833 against the compose DB, in a throwaway jurisdiction. Every test rolls back.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
test.after(() => sql.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const ROW = "Table 295-505-2. Height, minimum (ft.). RS6: 18 **; RT4: 18 *. Footnotes: * The requirements of table 295-505-2-i apply in lieu of the minimum height requirements. ** A structure shall meet the minimum height requirements of table 295-505-2-i unless it is adjacent to a one-story house.";

async function world(tx: postgres.TransactionSql) {
  const J = "bt-" + crypto.randomUUID().slice(0, 8);
  await tx`insert into jurisdictions (id, name, state) values (${J}, 'bundle test', 'WI')`;
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start, official_url)
    values (${J}, 'ordinance_subchapter', 'Chapter 295 Subchapter 5 — test', encode(sha256(gen_random_uuid()::text::bytea), 'hex'), now(), 'manual_upload', 'active', '2025-04-22', 'https://example.test/sub5.pdf') returning id, sha256`;
  const chunk = async (section: string, type: string, text: string, tableJson: unknown = null) =>
    (await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, subchapter, section, source_type, source_document_id, page_start, text, table_json, status, effective_start)
      values ('bt-' || gen_random_uuid(), 1, ${J}, '295', '5', ${section}, ${type}::code_source_type, ${d!["id"]}, 14, ${text}, ${tableJson ? tx.json(tableJson as never) : null}, 'active', '2025-04-22') returning id, token_count`)[0]!;
  const row = await chunk("295-505-2", "table_row", ROW, { footnote_refs: [{ marker: "*", page: 14, text: "x" }, { marker: "**", page: 14, text: "y" }], sources: [{ page: 14, bbox: [90, 300, 684, 314], row_index_on_page: 9 }] });
  const prose = await chunk("295-505-2-i", "ordinance_text", "Height standards for residential districts apply to principal buildings on the lot and are measured from grade to the top of the roof.");
  const [run] = await tx`insert into retrieval_runs (subquestion, category, planner_version) values ('minimum height in RS6', 'height', 'test') returning id`;
  await tx`insert into retrieval_evidence (retrieval_run_id, code_chunk_id, rank, selection_reason) values (${run!["id"]}, ${row["id"]}, 1, 'table row cited by a signed-off rule; keyword rank 1'), (${run!["id"]}, ${prose["id"]}, 2, 'keyword rank 2')`;
  return { doc: d!["id"] as string, row, prose, run: run!["id"] as string };
}

test("a tight budget keeps the table row whole with its footnotes and drops the lower-ranked prose", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const b = await assembleBundle(tx, { retrievalRunIds: [w.run], tokenBudget: w.row["token_count"] as number, analysisDate: "2026-09-22" });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0]!.verbatim_excerpt, ROW, "the excerpt is the chunk's own text, footnotes included");
  assert.deepEqual(b.items[0]!.footnote_markers, ["*", "**"]);
  assert.deepEqual(b.items[0]!.anchors, [{ page: 14, bbox: [90, 300, 684, 314], row_index_on_page: 9 }]);
  assert.equal(b.flags.dropped_for_budget, 1);
  assert.ok(b.tokens_used <= b.token_budget);
  const roomy = await assembleBundle(tx, { retrievalRunIds: [w.run], tokenBudget: 10_000, analysisDate: "2026-09-22" });
  assert.equal(roomy.items.length, 2);
}));

test("evidence whose document was superseded after the run is refused, and the flags say so", () => rolledBack(async (tx) => {
  const w = await world(tx);
  await tx`update source_documents set status = 'superseded', effective_end = '2026-01-01' where id = ${w.doc}`;
  const b = await assembleBundle(tx, { retrievalRunIds: [w.run], tokenBudget: 10_000, analysisDate: "2026-09-22" });
  assert.equal(b.items.length, 0);
  assert.equal(b.flags.refused_inactive, 2);
  assert.equal(b.flags.active_version_confirmed, false);
  assert.ok(b.flags.coverage_gaps.includes("height"), "no primary evidence left for height");
}));

test("the contract refuses a hand-edited item that is not active", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const b = await assembleBundle(tx, { retrievalRunIds: [w.run], tokenBudget: 10_000, analysisDate: "2026-09-22" });
  assert.doesNotThrow(() => EvidenceBundle.parse(b));
  const edited = { ...b, items: b.items.map((i, n) => (n === 0 ? { ...i, status: "pending_review" } : i)) };
  assert.throws(() => EvidenceBundle.parse(edited), /active/);
}));

test("the assembler refuses to write verdict words into reasons", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const [extra] = await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, subchapter, section, source_type, source_document_id, page_start, text, status, effective_start)
    select 'bt-' || gen_random_uuid(), 1, jurisdiction_id, '295', '5', '295-505-3', 'ordinance_text', source_document_id, 15, 'Another provision.', 'active', '2025-04-22' from code_chunks where id = ${w.prose["id"]} returning id`;
  await tx`insert into retrieval_evidence (retrieval_run_id, code_chunk_id, rank, selection_reason) values (${w.run}, ${extra!["id"]}, 3, 'this use is permitted')`;
  await assert.rejects(assembleBundle(tx, { retrievalRunIds: [w.run], tokenBudget: 10_000, analysisDate: "2026-09-22" }), /verdict words/);
}));
