import { createHash } from "node:crypto";
import type postgres from "postgres";

// Semantic fingerprints for chunks (MOO-829; 04 §5.2). One embedding_versions row per model + dimension; exactly one is
// active. A chunk's vector records the version that produced it, and every semantic search is scoped to one version,
// so vectors from two models are never compared (their similarity scores would be meaningless).
type Q = postgres.Sql | postgres.TransactionSql;
export const DIMENSION = 1536;

export type Provider = {
  name: string; // stored as embedding_versions.provider
  model: string; // stored as embedding_versions.model_name
  truncatedFrom: number | null;
  costPerMillionTokens: number; // USD, for the printed estimate only
  embed(texts: string[]): Promise<{ vectors: number[][]; tokens: number }>;
};

// OpenAI text-embedding-3-large, shortened to 1536 dimensions by the API's own `dimensions` parameter (the model is
// trained so a prefix is still a good embedding). The key is read from the environment only and never logged.
export function openAiProvider(apiKey = process.env["OPENAI_API_KEY"]): Provider {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set; put it in .env (never committed) or use --provider local-hash");
  return {
    name: "openai", model: "text-embedding-3-large", truncatedFrom: 3072, costPerMillionTokens: 0.13,
    async embed(texts) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "text-embedding-3-large", input: texts, dimensions: DIMENSION, encoding_format: "float" }),
        });
        if (res.ok) {
          const body = (await res.json()) as { data: Array<{ index: number; embedding: number[] }>; usage: { prompt_tokens: number } };
          const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
          return { vectors, tokens: body.usage.prompt_tokens };
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= 5) throw new Error(`OpenAI embeddings failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    },
  };
}

// Deterministic stand-in for CI and tests: each word is hashed into one of 1536 buckets with a sign, then the vector is
// normalised. Texts sharing words land close together, so ranking tests are meaningful without a network or a key.
// ponytail: bag-of-words only (no synonyms); it proves the pipeline, not semantic quality.
export function localHashProvider(): Provider {
  return {
    name: "local-hash", model: "fnv-bag-of-words-v1", truncatedFrom: null, costPerMillionTokens: 0,
    async embed(texts) {
      let tokens = 0;
      const vectors = texts.map((t) => {
        const v = new Array<number>(DIMENSION).fill(0);
        for (const w of t.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
          tokens++;
          const h = createHash("sha1").update(w).digest();
          v[h.readUInt32BE(0) % DIMENSION]! += h[4]! & 1 ? 1 : -1;
        }
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      });
      return { vectors, tokens };
    },
  };
}

export type EmbeddingVersion = { id: string; provider: string; model_name: string; dimension: number; is_active: boolean };

// The registry row for a provider, created on first use. The very first version becomes active; switching later is
// explicit (activateVersion), because it starts a full re-embed.
export async function ensureVersion(sql: Q, p: Provider): Promise<EmbeddingVersion> {
  const [found] = await sql<EmbeddingVersion[]>`select id, provider, model_name, dimension, is_active from embedding_versions where provider = ${p.name} and model_name = ${p.model} and dimension = ${DIMENSION}`;
  if (found) return found;
  const [anyActive] = await sql`select 1 from embedding_versions where is_active`;
  const [row] = await sql<EmbeddingVersion[]>`insert into embedding_versions (provider, model_name, dimension, truncated_from, is_active)
    values (${p.name}, ${p.model}, ${DIMENSION}, ${p.truncatedFrom}, ${!anyActive}) returning id, provider, model_name, dimension, is_active`;
  return row!;
}

export async function activateVersion(sql: Q, versionId: string): Promise<void> {
  // Two statements in one transaction: the partial unique index allows only one active row at any instant.
  await sql`update embedding_versions set is_active = false where is_active and id <> ${versionId}`;
  await sql`update embedding_versions set is_active = true where id = ${versionId}`;
}

export async function activeVersion(sql: Q): Promise<EmbeddingVersion | null> {
  const [v] = await sql<EmbeddingVersion[]>`select id, provider, model_name, dimension, is_active from embedding_versions where is_active`;
  return v ?? null;
}

export const toVectorLiteral = (v: number[]): string => `[${v.join(",")}]`;
const chunkInput = (heading: string | null, text: string) => `${heading ? `${heading}\n` : ""}${text}`.slice(0, 24_000); // ~6k tokens, under the model's 8,191 limit

export type EmbedReport = { version: EmbeddingVersion; embedded: number; skipped: number; tokens: number; cost_usd: number; batches: number };

// Embeds every active chunk whose vector is missing or came from another version. Idempotent: a chunk already embedded
// by this version is never touched. Chunks are embedded when their own status is active, even if their document is not
// yet active, so activating a document later needs no second pass.
export async function embedChunks(sql: Q, p: Provider, version: EmbeddingVersion, opts: { batchSize?: number; limit?: number; documentIds?: string[] } = {}): Promise<EmbedReport> {
  const batchSize = opts.batchSize ?? 96;
  const scope = opts.documentIds?.length ? sql`and source_document_id = any(${opts.documentIds})` : sql``;
  const [counts] = await sql<{ done: number }[]>`select count(*)::int as done from code_chunks where status = 'active' and embedding_version_id = ${version.id} ${scope}`;
  const todo = await sql<{ id: string; heading: string | null; text: string }[]>`
    select id, heading, text from code_chunks
    where status = 'active' and embedding_version_id is distinct from ${version.id} ${scope}
    order by id ${opts.limit ? sql`limit ${opts.limit}` : sql``}`;
  let tokens = 0, batches = 0;
  for (let i = 0; i < todo.length; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    const out = await p.embed(batch.map((c) => chunkInput(c.heading, c.text)));
    if (out.vectors.length !== batch.length || out.vectors.some((v) => v.length !== DIMENSION)) throw new Error(`provider returned ${out.vectors.length} vectors for ${batch.length} inputs, or the wrong dimension`);
    tokens += out.tokens;
    batches++;
    for (let j = 0; j < batch.length; j++) {
      await sql`update code_chunks set embedding = ${toVectorLiteral(out.vectors[j]!)}::vector, embedding_version_id = ${version.id} where id = ${batch[j]!.id}`;
    }
  }
  return { version, embedded: todo.length, skipped: counts!.done, tokens, cost_usd: Number(((tokens / 1_000_000) * p.costPerMillionTokens).toFixed(4)), batches };
}

export type NearHit = { id: string; section: string; heading: string | null; page_start: number; source_type: string; distance: number; text: string };

// Cosine nearest neighbours among served chunks embedded by exactly this version. The version filter is the rule that
// keeps vector spaces apart; the retriever (MOO-830) adds its hard metadata filters on top of this.
export async function nearestChunks(sql: Q, versionId: string, queryVector: number[], k = 10, where: { documentIds?: string[] } = {}): Promise<NearHit[]> {
  return sql<NearHit[]>`
    select id, section, heading, page_start, source_type::text as source_type, (embedding <=> ${toVectorLiteral(queryVector)}::vector)::float as distance, left(text, 160) as text
    from active_code_chunks
    where embedding_version_id = ${versionId} and embedding is not null
      ${where.documentIds?.length ? sql`and source_document_id = any(${where.documentIds})` : sql``}
    order by embedding <=> ${toVectorLiteral(queryVector)}::vector
    limit ${k}`;
}
