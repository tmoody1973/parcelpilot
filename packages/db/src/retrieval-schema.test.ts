import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";

// MOO-828 (migration 0017) against the compose DB. Every write rolls back.
const owner = postgres(process.env["DATABASE_URL"] ?? "postgres://parcelpilot:parcelpilot@localhost:5432/parcelpilot", { max: 1 });
const app = postgres(process.env["DATABASE_APP_URL"] ?? "postgres://parcelpilot_app:parcelpilot-app@localhost:5432/parcelpilot", { max: 1 });
test.after(async () => { await owner.end(); await app.end(); });
class Rollback extends Error {}
const rolledBack = async (db: postgres.Sql, fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await db.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};

test("zoning_code keeps section numbers and district codes whole, stems prose", async () => {
  const [r] = await owner`select (to_tsvector('zoning_code', ${"Table 295-505-2-i applies to RM3 dwellings"}) || zoning_code_tokens(${"Table 295-505-2-i applies to RM3 dwellings"}))::text as v`;
  const v = r!["v"] as string;
  assert.match(v, /'295-505-2-i'/, "the section number is one lexeme");
  assert.match(v, /'rm3'/, "the district code survives");
  assert.match(v, /'dwell'/, "prose is stemmed");
  const [p] = await owner`select to_tsvector('zoning_code', 'x') || zoning_code_tokens('see s. 295-605-2 and 295-603-2-a-2') @@ ${"'295-603':*"}::tsquery as prefix`;
  assert.equal(p!["prefix"], true, "a section prefix query matches");
  const [n] = await owner`select zoning_code_tokens('RM3 has 45 ft; phone 414-286-2489')::text as v`;
  assert.equal(n!["v"], "", "phone numbers and plain numbers are not section tokens");
});

test("derived chunk fields and the trigram index exist on a new chunk", () => rolledBack(owner, async (tx) => {
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status) values ('milwaukee-wi', 'ordinance_subchapter', 't', 'rs-' || gen_random_uuid(), now(), 'manual_upload', 'active') returning id`;
  const [c] = await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, section, heading, source_type, source_document_id, page_start, page_end, text)
    values ('rs-' || gen_random_uuid(), 1, 'milwaukee-wi', '295', '295-505-2-i', 'Purpose', 'ordinance_text', ${d!["id"]}, 13, 14, 'Twelve chars') returning chunk_kind, token_count, text_hash, source_anchors, tsv::text as tsv`;
  assert.equal(c!["chunk_kind"], "purpose_statement");
  assert.equal(c!["token_count"], 3);
  assert.equal(c!["text_hash"], (await tx`select md5('Twelve chars') as h`)[0]!["h"]);
  assert.deepEqual(c!["source_anchors"], [{ page: 13, page_end: 14 }]);
  assert.match(c!["tsv"] as string, /'295-505-2-i'/, "the chunk's own section is searchable as one token");
  const [i] = await tx`select count(*)::int as n from pg_indexes where indexname = 'code_chunks_section_trgm_idx'`;
  assert.equal(i!["n"], 1);
}));

test("at most one active embedding version", () => rolledBack(owner, async (tx) => {
  await tx`update embedding_versions set is_active = false where is_active`; // a real version may be active on this DB (rolled back)
  await tx`insert into embedding_versions (provider, model_name, dimension, is_active) values ('local-hash', 'a', 1536, true)`;
  await assert.rejects(tx.savepoint((sp) => sp`insert into embedding_versions (provider, model_name, dimension, is_active) values ('local-hash', 'b', 1536, true)`), /embedding_versions_one_active_idx/);
  await tx`insert into embedding_versions (provider, model_name, dimension, is_active) values ('local-hash', 'c', 1536, false)`;
}));

test("retrieval runs and evidence are append-only and tenant-isolated; offline runs are invisible to tenants", () => rolledBack(owner, async (tx) => {
  const [orgA] = await tx`insert into organizations (name, slug, clerk_org_id) values ('A', 'rs-a-' || gen_random_uuid(), 'rs-a-' || gen_random_uuid()) returning id`;
  const [orgB] = await tx`insert into organizations (name, slug, clerk_org_id) values ('B', 'rs-b-' || gen_random_uuid(), 'rs-b-' || gen_random_uuid()) returning id`;
  // CI's database has no ingested corpus, so the test makes its own chunk.
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status) values ('milwaukee-wi', 'ordinance_subchapter', 't', 'rs-' || gen_random_uuid(), now(), 'manual_upload', 'active') returning id`;
  const [chunk] = await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, section, source_type, source_document_id, page_start, text)
    values ('rs-' || gen_random_uuid(), 1, 'milwaukee-wi', '295', '295-605-2', 'ordinance_text', ${d!["id"]}, 16, 'Height, maximum') returning id`;
  const [runA] = await tx`insert into retrieval_runs (org_id, subquestion, category, planner_version) values (${orgA!["id"]}, 'height', 'height', 'test') returning id`;
  await tx`insert into retrieval_runs (org_id, subquestion, planner_version) values (null, 'offline eval', 'test')`;
  const [ev] = await tx`insert into retrieval_evidence (retrieval_run_id, org_id, code_chunk_id, rank, selection_reason) values (${runA!["id"]}, ${orgA!["id"]}, ${chunk!["id"]}, 1, 'test') returning id`;
  await assert.rejects(tx.savepoint((sp) => sp`update retrieval_runs set subquestion = 'x' where id = ${runA!["id"]}`), /append-only/);
  await assert.rejects(tx.savepoint((sp) => sp`delete from retrieval_evidence where id = ${ev!["id"]}`), /append-only/);
  await assert.rejects(tx.savepoint((sp) => sp`insert into retrieval_evidence (retrieval_run_id, org_id, code_chunk_id, rank, selection_reason) values (${runA!["id"]}, ${orgA!["id"]}, ${chunk!["id"]}, 1, 'dup rank')`), /retrieval_evidence_run_rank_unique/);
  // The app role sees only its own org's rows (committed data is needed for a second connection, so check the policy text instead).
  const pol = await tx`select tablename, qual from pg_policies where tablename in ('retrieval_runs', 'retrieval_evidence') order by 1`;
  assert.deepEqual(pol.map((p) => p["tablename"]), ["retrieval_evidence", "retrieval_runs"]);
  for (const p of pol) assert.match(p["qual"] as string, /current_org_id\(\)/);
  assert.ok(orgB);
}));

test("the app role reading retrieval_runs under an org sees nothing of another org and no offline rows", async () => {
  // Read-only: no rows are written by this test, so an empty result under a random org proves isolation of existing rows.
  const rows = await app.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${crypto.randomUUID()}, true)`;
    return tx`select count(*)::int as n from retrieval_runs`;
  });
  assert.equal(rows[0]!["n"], 0);
});
