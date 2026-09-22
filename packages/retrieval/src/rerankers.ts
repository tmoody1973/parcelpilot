import type { Hit, Reranker } from "./retrieve.ts";

// The reranker candidates for the MOO-832 bake-off (04 §6.x). Each reorders a shortlist and never adds to it; the
// retriever enforces that. Each keeps a usage ledger so the bake-off reports measured latency and cost, and a cache
// keyed by query + candidate ids, because many labelled queries repeat the same question for the same district.
export type Usage = { calls: number; cached: number; latencies_ms: number[]; units: number; unit_name: string; cost_usd: number };
export type MeteredReranker = Reranker & { usage: Usage; available: boolean; unavailable_reason?: string };

const excerpt = (h: Hit) => h.text.slice(0, 2000);

function metered(name: string, unitName: string, score: (query: string, docs: Hit[]) => Promise<{ scores: number[]; units: number; cost: number }>): MeteredReranker {
  const cache = new Map<string, number[]>();
  const usage: Usage = { calls: 0, cached: 0, latencies_ms: [], units: 0, unit_name: unitName, cost_usd: 0 };
  return {
    name, usage, available: true,
    async rerank(query, candidates) {
      const key = `${query}\u0000${candidates.map((c) => c.chunk_id).sort().join(",")}`;
      let scores = cache.get(key);
      if (scores) usage.cached++;
      else {
        const t0 = performance.now();
        const out = await score(query, candidates);
        usage.latencies_ms.push(performance.now() - t0);
        usage.calls++; usage.units += out.units; usage.cost_usd += out.cost;
        scores = out.scores;
        cache.set(key, scores);
      }
      const s = scores;
      return candidates.map((h, i) => ({ ...h, rerank_score: s[i] ?? 0 })).sort((a, b) => (b.rerank_score ?? 0) - (a.rerank_score ?? 0) || a.rank - b.rank);
    },
  };
}

async function retrying(fn: () => Promise<Response>, what: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fn();
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < 6) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    throw new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

// Cohere rerank-v3.5. Billed per search unit (one query over up to 100 documents); the price per unit is a list price
// passed in, so the report says which number is measured (units) and which is assumed (price).
export function cohereReranker(apiKey = process.env["COHERE_API_KEY"], usdPerSearchUnit = 0.002): MeteredReranker {
  if (!apiKey) return { name: "cohere-rerank-v3.5", available: false, unavailable_reason: "COHERE_API_KEY not set", usage: { calls: 0, cached: 0, latencies_ms: [], units: 0, unit_name: "search units", cost_usd: 0 }, rerank: async (_q, c) => c };
  return metered("cohere-rerank-v3.5", "search units", async (query, docs) => {
    const res = await retrying(() => fetch("https://api.cohere.com/v2/rerank", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "rerank-v3.5", query, documents: docs.map(excerpt), top_n: docs.length }),
    }), "Cohere rerank");
    const body = (await res.json()) as { results: Array<{ index: number; relevance_score: number }>; meta?: { billed_units?: { search_units?: number } } };
    const scores = new Array<number>(docs.length).fill(0);
    for (const r of body.results) scores[r.index] = r.relevance_score;
    const units = body.meta?.billed_units?.search_units ?? 1;
    return { scores, units, cost: units * usdPerSearchUnit };
  });
}

// Jev (TypeSafe System One): one Noul per candidate, all candidates of one query in a single request so the query state
// is read once and the questions run in parallel (docs.typesafe.ai/api). Only the shortlist is ever sent, never the corpus.
// Price from docs.typesafe.ai/models: $0.042 per million input tokens (jev-1.13.0).
export function jevReranker(apiKey = process.env["TYPESAFE_API_KEY"], context: { districts: () => string[] } = { districts: () => [] }): MeteredReranker & { payloads: unknown[] } {
  const payloads: unknown[] = [];
  if (!apiKey) return { name: "jev-noul", available: false, unavailable_reason: "TYPESAFE_API_KEY not set", payloads, usage: { calls: 0, cached: 0, latencies_ms: [], units: 0, unit_name: "input tokens", cost_usd: 0 }, rerank: async (_q, c) => c };
  const r = metered("jev-noul", "input tokens", async (query, docs) => {
    const questions = Object.fromEntries(docs.map((d, i) => [`c${i}`, {
      type: "noul",
      instructions: {
        candidate: { section: d.section, text: excerpt(d) },
        question: "Does `candidate` state the zoning provision, table row or definition that answers `query.question` for the parcel's districts in `query.districts`?",
      },
      criteria: {
        true: "The candidate states the rule, value, permitted-use letter or definition the question asks about, and it applies to at least one of those districts.",
        false: "The candidate is on a related topic, applies only to other districts, or does not answer the question.",
      },
    }]));
    const body = { model: "jev-latest", state: { query: { question: query, districts: context.districts() } }, questions };
    payloads.push({ query, candidates: docs.length, sections: docs.map((d) => d.section) });
    const res = await retrying(() => fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body) }), "TypeSafe systemone");
    const out = (await res.json()) as { model: string; answers: Record<string, { noul: number }>; usage: { input_tokens: number } };
    return { scores: docs.map((_, i) => out.answers[`c${i}`]?.noul ?? 0), units: out.usage.input_tokens, cost: (out.usage.input_tokens / 1_000_000) * 0.042 };
  });
  return { ...r, payloads };
}

// bge-reranker-v2-m3 served by worker-py /rerank (self-hosted; no per-call price, latency is the cost).
export function bgeReranker(baseUrl = process.env["WORKER_PY_URL"] ?? "http://localhost:8000"): MeteredReranker {
  return metered("bge-reranker-v2-m3", "pairs", async (query, docs) => {
    const res = await retrying(() => fetch(`${baseUrl}/rerank`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, documents: docs.map(excerpt) }) }), "worker-py /rerank");
    const out = (await res.json()) as { scores: number[] };
    return { scores: out.scores, units: docs.length, cost: 0 };
  });
}

export const p95 = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
