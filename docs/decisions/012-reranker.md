# 012 — Reranker: none by default; Jev kept behind a flag as the one option worth re-testing

**Date:** 2026-09-22 · **Status:** decided · **Decided by:** Tarik (on the measured table below); Claude measured and recommended · **Linear:** MOO-832

**Decision.** Live retrieval runs with no reranker. The order comes from rule pinning plus reciprocal-rank fusion. Jev per-candidate reranking stays implemented behind the retriever's `rerank` hook and is re-run in this bake-off whenever the labelled set grows. bge-reranker-v2-m3 and Cohere rerank-v3.5 are not used.

**Why this came up.** The design (04 §6.x) left the reranker to be chosen in M4 by measurement. A reranker reorders the retriever's shortlist with a stronger model. It can lift the right passage higher, but it adds a call per query, cost, latency and, for the hosted options, a vendor. Whatever wins only orders evidence; it never decides pass or fail.

**How it was measured.** `pnpm retrieval:bakeoff` scored each option on the signed labelled set (MOO-831: 85 queries, 120 primary passages; 83 scored, 2 blocked on the residential merge), with a 20-candidate shortlist and OpenAI embeddings, in two configurations. **Pins on** is production: table rows cited by approved rules stay first and the reranker orders the rest. **Pins off** lets the reranker order everything, showing what it does on its own. Recall@10 was already 1.000 without a reranker, so the metric that can move is ordering: MRR (mean reciprocal rank of the required passages; 1.0 means always first) and Recall@1. Full table: `docs/eval/reranker-bakeoff-2026-09-22.md`.

| Option | MRR, pins on | MRR, pins off | Recall@1 / @5, pins off | p95 latency per query | Cost per 1,000 queries |
|---|---|---|---|---|---|
| **None** | **0.864** | 0.569 | 0.360 / 0.763 | 0 | $0 |
| bge-reranker-v2-m3 (local, CPU) | 0.858 | 0.578 | 0.342 / **0.991** | **17.0 s** | $0 (compute) |
| Cohere rerank-v3.5 | 0.858 | **0.399** | **0.009** / 0.886 | 2.2 s | ~$2.00 (assumed $0.002 per search unit; units measured) |
| Jev Noul per candidate | 0.858 | **0.589** | 0.360 / 0.886 | 0.53 s | ~$0.20 (measured tokens × $0.042/Mtok) |

**What the numbers say.**
1. **In production, no reranker helps.** All three rerankers score 0.858 against none's 0.864. Pinning already puts the rule-cited rows first, and reordering the rest moved the remaining primary passages slightly down, not up.
2. **Without pins, the options diverge sharply.** Jev is the only one that beats plain fusion on ordering (MRR +0.020) at half a second and about $0.20 per thousand queries. bge lifts Recall@5 from 0.763 to 0.991, but its first-place accuracy is no better, and at 17 seconds per query on this hardware it isn't usable in a live screen. Cohere made ordering much worse: it put a required passage first in 1 case in 100 (Recall@1 0.009), likely because table rows read as grids of codes, not prose.
3. **The shortlist boundary held.** Jev saw only shortlists (17 to 20 candidates per request, 26 requests in total, never the corpus), and every reranker left the candidate set unchanged, which the retriever enforces.

**Options.**
1. **None (chosen by Tarik, 2026-09-22).** Cost: nothing today; we give up whatever a reranker might add on questions the labelled set doesn't cover yet.
2. **Jev behind the flag, on in production.** Cost: ~$0.20 per thousand queries, half a second per query, a vendor in the retrieval path, and no measured benefit with pins on.
3. **bge self-hosted.** Cost: a 2.2 GB model and a GPU to make it fast; no measured benefit with pins on.
4. **Cohere.** Cost: ~$2.00 per thousand queries, and it made raw ordering worse on this corpus.

**What we give up.** A measured improvement we cannot see yet. The labelled set is small (13 distinct shortlists once repeated questions are cached) and saturated by pinning, so a reranker has little room to show value. Questions the rules don't pin, such as procedures, definitions and districts without approved rules, are where it would matter, and they are under-represented in the set.

**How we'll know if this was right.** Re-run `pnpm retrieval:bakeoff` when the labelled set grows beyond the 15 gold cases (M6) or covers districts without approved rules. If Jev's pins-off lift holds above +0.05 MRR there, switch it on for unpinned categories only.

**Boundary check after the decision.** One live Jev call for "front setback minimum and maximum in LB2" (pins off) sent 1 request with the 20 shortlisted candidates, 6,219 characters against the 166,996-character served corpus (3.7%), and a state of only the question and district. It ranked s. 295-605-2-f-4 (minimum height by street frontage) above the setback rows: the plausible-but-wrong ordering that rule pinning prevents.

**Run note.** During the bge pass one Postgres server process exited with code 2; Postgres recovered in 5 seconds, no query in the run failed, and the corpus, embeddings and rules were intact afterwards. The cause was not identified from the log.

**What actually happened.** _(Tarik fills in later.)_
