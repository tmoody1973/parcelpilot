import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { embedChunks, ensureVersion, localHashProvider, type Provider } from "@parcelpilot/db";
import { retrieve, type Hit } from "./retrieve.ts";

// MOO-830 against the compose DB, isolated in a throwaway jurisdiction and a test-only embedding model. Rolled back.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
test.after(() => sql.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};
const model: Provider = { ...localHashProvider(), model: "retrieval-test" };

async function world(tx: postgres.TransactionSql) {
  const J = "rt-" + crypto.randomUUID().slice(0, 8);
  await tx`insert into jurisdictions (id, name, state) values (${J}, 'retrieval test', 'WI')`;
  const doc = async (status: string) => (await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values (${J}, 'ordinance_subchapter', 'rt doc', 'rt-' || gen_random_uuid(), now(), 'manual_upload', ${status}, '2025-07-15') returning id`)[0]!["id"] as string;
  const sub6 = await doc("active"), sub5 = await doc("active"), old = await doc("active");
  const chunk = async (d: string, sub: string, section: string, type: string, text: string, districts: string[], cats: string[], tableJson: unknown = null) =>
    (await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, subchapter, section, heading, source_type, district_codes, rule_categories, source_document_id, page_start, text, table_json, status, effective_start)
      values ('rt-' || gen_random_uuid(), 1, ${J}, '295', ${sub}, ${section}, null, ${type}::code_source_type, ${districts}, ${cats}::rule_category[], ${d}, 16, ${text}, ${tableJson ? tx.json(tableJson as never) : null}, 'active', '2025-07-15') returning id`)[0]!["id"] as string;
  const commercial = ["NS1", "NS2", "LB1", "LB2", "LB3", "RB1", "RB2", "CS"];
  const c = {
    lb1Height: await chunk(sub6, "6", "295-605-2", "table_row", "Table 295-605-2. Height, maximum (ft.). LB1: 45; LB2: 60.", commercial, ["height"]),
    rmHeight: await chunk(sub5, "5", "295-505-2", "table_row", "Table 295-505-2. Height, maximum (ft.). RM3: 45; RM4: 60.", ["RM3", "RM4"], ["height"]),
    rsMinHeight: await chunk(sub5, "5", "295-505-2", "table_row",
      "Table 295-505-2. Height, minimum (ft.). RS6: 18 **; RT4: 18 *. Footnotes: * The requirements of table 295-505-2-i apply in lieu of the minimum height requirements. ** A structure shall meet the minimum height requirements of table 295-505-2-i unless it is adjacent to a one-story house.",
      ["RS6", "RT4"], ["height"], { footnote_refs: [{ marker: "*", page: 14, text: "The requirements of table 295-505-2-i apply in lieu of the minimum height requirements." }, { marker: "**", page: 14, text: "A structure shall meet the minimum height requirements of table 295-505-2-i unless it is adjacent to a one-story house." }] }),
    prose: await chunk(sub6, "6", "295-605-2-f", "ordinance_text", "Building height is measured from grade to the top of the roof.", [], ["height"]),
    parking: await chunk(sub6, "6", "295-403", "ordinance_text", "Parking spaces required per dwelling unit.", [], ["parking"]),
    stale: await chunk(old, "6", "295-605-2", "table_row", "Table 295-605-2. Height, maximum (ft.). LB1: 45 maximum height LB1 height.", commercial, ["height"]),
  };
  const v = await ensureVersion(tx, model);
  for (const d of [sub6, sub5, old]) await embedChunks(tx, model, v, { documentIds: [d] });
  return { J, c, v, old };
}
const ids = (hits: Hit[]) => hits.map((h) => h.chunk_id);

test("a superseded document is never returned, even as the best keyword and meaning match", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const before = await retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum height LB1", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, record: false });
  assert.ok(ids(before.hits).includes(w.c.stale), "served while its document is active");
  await tx`update source_documents set status = 'superseded', effective_end = '2026-01-01' where id = ${w.old}`;
  const after = await retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum height LB1", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, record: false });
  assert.ok(!ids(after.hits).includes(w.c.stale) && !ids(after.context).includes(w.c.stale), "never returned once superseded");
}));

test("district and category filters: LB1 height gets the LB1 row, never the RM3 row or parking text", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const r = await retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum building height", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, record: false });
  assert.ok(ids(r.hits).includes(w.c.lb1Height));
  assert.ok(!ids(r.hits).includes(w.c.rmHeight), "a table row for other districts is filtered out");
  assert.ok(!ids(r.hits).includes(w.c.parking), "a chunk tagged only with another category is filtered out");
  assert.ok(ids(r.hits).includes(w.c.prose), "untagged, district-free prose stays in");
  for (const h of r.hits) assert.ok(h.district_codes.length === 0 || h.district_codes.includes("LB1"), `${h.section} applies to LB1`);
}));

test("a table row comes back with its footnotes attached", () => rolledBack(async (tx) => {
  const w = await world(tx);
  const r = await retrieve(tx, { jurisdictionId: w.J, subquestion: "minimum height", category: "height", districts: ["RS6"], analysisDate: "2026-09-22", versionId: w.v.id, record: false });
  const row = r.hits.find((h) => h.chunk_id === w.c.rsMinHeight);
  assert.ok(row, "the RS6 minimum-height row is returned");
  assert.deepEqual(row.footnotes.map((f) => f.split(" ")[0]), ["*", "**"]);
  assert.match(row.text, /\* The requirements of table 295-505-2-i/, "the footnote text is in the evidence itself");
}));

test("never unfiltered; reranking may only reorder; a recorded run's evidence all resolves to served chunks", () => rolledBack(async (tx) => {
  const w = await world(tx);
  await assert.rejects(retrieve(tx, { jurisdictionId: w.J, subquestion: "height", districts: [], analysisDate: "2026-09-22", versionId: w.v.id }), /never run without its hard filters/);
  const reverse = { name: "reverse", rerank: async (_q: string, c: Hit[]) => [...c].reverse() };
  const r = await retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum height", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, rerank: reverse });
  const plain = await retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum height", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, record: false });
  assert.deepEqual(new Set(ids(r.hits)), new Set(ids(plain.hits)), "same set");
  const liar = { name: "liar", rerank: async (_q: string, c: Hit[]) => c.slice(1) };
  await assert.rejects(retrieve(tx, { jurisdictionId: w.J, subquestion: "maximum height", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, rerank: liar, record: false }), /may only reorder/);
  const [run] = await tx`select reranker_model, planner_version, embedding_version_id from retrieval_runs where id = ${r.run_id}`;
  assert.deepEqual([run!["reranker_model"], run!["planner_version"], run!["embedding_version_id"]], ["reverse", "hybrid-v1", w.v.id]);
  const [bad] = await tx`select count(*)::int as n from retrieval_evidence e where e.retrieval_run_id = ${r.run_id} and not exists (select 1 from code_chunks c join source_documents d on d.id = c.source_document_id where c.id = e.code_chunk_id and c.status = 'active' and d.status = 'active')`;
  assert.equal(bad!["n"], 0);
}));

test("with pins on, a reranker cannot move approved-rule rows out of first place; with pins off it can", () => rolledBack(async (tx) => {
  const w = await world(tx);
  // An approved LB1 height rule citing the LB1 row, so that row is pinned.
  const [u] = await tx`insert into users (email) values ('rt-' || gen_random_uuid() || '@dev.local') returning id`;
  const [z] = await tx`insert into zoning_rules (family_id, version, jurisdiction_id, district_code, category, kind, params, criticality, status, approved_by, approved_at, effective_start)
    values ('rt-' || gen_random_uuid(), 1, ${w.J}, 'LB1', 'height', 'max_height_ft', '{"max_ft":45}', 'critical', 'approved', ${u!["id"]}, now(), '2025-07-15') returning id`;
  const doc = (await tx`select source_document_id from code_chunks where id = ${w.c.lb1Height}`)[0]!["source_document_id"];
  const [ci] = await tx`insert into citations (source_document_id, page_number, section, anchor, excerpt) values (${doc}, 16, '295-605-2', 'Table 295-605-2', 'Height, maximum (ft.): LB1 45') returning id`;
  await tx`insert into rule_citations (zoning_rule_id, citation_id) values (${z!["id"]}, ${ci!["id"]})`;
  const reverse = { name: "reverse", rerank: async (_q: string, c: Hit[]) => [...c].reverse() };
  const base = { jurisdictionId: w.J, subquestion: "maximum height", category: "height", districts: ["LB1"], analysisDate: "2026-09-22", versionId: w.v.id, record: false, rerank: reverse };
  const pinned = await retrieve(tx, base);
  assert.equal(pinned.hits[0]!.chunk_id, w.c.lb1Height, "the rule-cited row stays first");
  const raw = await retrieve(tx, { ...base, pinRuleRows: false });
  assert.notEqual(raw.hits[0]!.chunk_id, w.c.lb1Height, "without pins the reranker decides");
}));

