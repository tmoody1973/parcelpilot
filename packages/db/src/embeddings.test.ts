import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { activateVersion, embedChunks, ensureVersion, localHashProvider, nearestChunks, type Provider } from "./embeddings.ts";

// MOO-829 against the compose DB with the deterministic local provider (no network, no key). Every test rolls back.
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
test.after(() => sql.end());
class Rollback extends Error {}
const rolledBack = async (fn: (tx: postgres.TransactionSql) => Promise<void>) => {
  await sql.begin(async (tx) => { await fn(tx); throw new Rollback(); }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
};

// A second deterministic model, so two vector spaces can coexist in one test.
const otherModel: Provider = { ...localHashProvider(), model: "fnv-bag-of-words-v2" };

async function corpus(tx: postgres.TransactionSql) {
  await tx`update embedding_versions set is_active = false where is_active`; // isolate from any real version on this DB (rolled back)
  const [d] = await tx`insert into source_documents (jurisdiction_id, source_type, title, sha256, retrieved_at, retrieval_method, status, effective_start)
    values ('milwaukee-wi', 'ordinance_subchapter', 'embed test', 'emb-' || gen_random_uuid(), now(), 'manual_upload', 'active', '2025-07-15') returning id`;
  const chunk = async (heading: string, text: string) => (await tx`insert into code_chunks (family_id, version, jurisdiction_id, chapter, section, heading, source_type, source_document_id, page_start, text, status, effective_start)
    values ('emb-' || gen_random_uuid(), 1, 'milwaukee-wi', '295', '295-605-2', ${heading}, 'ordinance_text', ${d!["id"]}, 16, ${text}, 'active', '2025-07-15') returning id`)[0]!["id"] as string;
  return {
    doc: d!["id"] as string,
    height: await chunk("Height", "Height, maximum (ft.) LB1 45 LB2 60 building height limit"),
    twoFamily: await chunk("Uses", "Two-family dwelling permitted as a residential use"),
    parking: await chunk("Parking", "Off-street parking spaces required per dwelling unit"),
  };
}

test("the first version becomes active; embedding is idempotent; the nearest chunk shares the query's words", () => rolledBack(async (tx) => {
  const c = await corpus(tx);
  const p = localHashProvider();
  const v = await ensureVersion(tx, p);
  assert.equal(v.is_active, true, "first version on an empty registry is active");
  const first = await embedChunks(tx, p, v, { documentIds: [c.doc] });
  assert.equal(first.embedded, 3);
  const second = await embedChunks(tx, p, v, { documentIds: [c.doc] });
  assert.equal(second.embedded, 0, "a chunk already embedded by this version is not touched");
  const q = (await p.embed(["maximum building height"])).vectors[0]!;
  const hits = await nearestChunks(tx, v.id, q, 3, { documentIds: [c.doc] });
  assert.equal(hits[0]!.id, c.height);
}));

test("two vector spaces never mix: a search under version A cannot return a chunk embedded by version B", () => rolledBack(async (tx) => {
  const c = await corpus(tx);
  const a = await ensureVersion(tx, localHashProvider());
  await embedChunks(tx, localHashProvider(), a, { documentIds: [c.doc] });
  const b = await ensureVersion(tx, otherModel);
  assert.equal(b.is_active, false, "a second version is not activated implicitly");
  await tx.savepoint(async (sp) => {
    await activateVersion(sp, b.id);
    // Re-embed only one chunk under B: the corpus is now mixed, which is exactly the state the rule must survive.
    await embedChunks(sp, otherModel, { ...b, is_active: true }, { documentIds: [c.doc], limit: 1 });
    const q = (await localHashProvider().embed(["maximum building height"])).vectors[0]!;
    const underA = await nearestChunks(sp, a.id, q, 10, { documentIds: [c.doc] });
    const underB = await nearestChunks(sp, b.id, q, 10, { documentIds: [c.doc] });
    const versionOf = async (id: string) => (await sp`select embedding_version_id from code_chunks where id = ${id}`)[0]!["embedding_version_id"];
    for (const h of underA) assert.equal(await versionOf(h.id), a.id, "every hit under A was embedded by A");
    for (const h of underB) assert.equal(await versionOf(h.id), b.id, "every hit under B was embedded by B");
    assert.equal(underA.length + underB.length, 3, "each chunk is in exactly one space");
    const [active] = await sp`select count(*)::int as n from embedding_versions where is_active`;
    assert.equal(active!["n"], 1, "exactly one active version after the switch");
  });
}));

test("the registry is append-only except is_active; chunk text stays frozen while embeddings are written", () => rolledBack(async (tx) => {
  const c = await corpus(tx);
  const v = await ensureVersion(tx, localHashProvider());
  await assert.rejects(tx.savepoint((sp) => sp`update embedding_versions set model_name = 'x' where id = ${v.id}`), /append-only/);
  await embedChunks(tx, localHashProvider(), v, { documentIds: [c.doc] });
  await assert.rejects(tx.savepoint((sp) => sp`update code_chunks set text = 'edited' where id = ${c.parking}`), /append-only/);
}));

test("the OpenAI provider refuses to start without a key and names the variable", async () => {
  const { openAiProvider } = await import("./embeddings.ts");
  assert.throws(() => openAiProvider(""), /OPENAI_API_KEY is not set/);
});
