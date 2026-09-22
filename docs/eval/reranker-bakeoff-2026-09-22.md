# Reranker bake-off — 2026-09-22

Labelled set `retrieval-gold.v1` (85 queries), embedding `openai/text-embedding-3-large`, shortlist 20, retrieval planner hybrid-v1. Measured by `pnpm retrieval:bakeoff`.
“Pins on” is production: table rows cited by approved rules stay first and the reranker orders the rest of the shortlist. “Pins off” lets the reranker order everything, to see what it does on its own.

| Reranker | Pins | MRR | Recall@1 | Recall@5 | Recall@10 | Lift in MRR vs none | Footnote recall | Calls (cached) | p95 latency / call | Cost this run | Cost per 1,000 queries |
|---|---|---|---|---|---|---|---|---|---|---|---|
| none | on | 0.864 | 0.728 | 1.000 | 1.000 | +0.000 | n/a | – | – | $0 | $0 |
| none | off | 0.569 | 0.360 | 0.763 | 0.991 | +0.000 | n/a | – | – | $0 | $0 |
| bge-reranker-v2-m3 | on | 0.858 | 0.728 | 1.000 | 1.000 | -0.006 | n/a | 13 (70) | 17041 ms | $0.0000 | $0.000 |
| bge-reranker-v2-m3 | off | 0.578 | 0.342 | 0.991 | 0.991 | +0.009 | n/a | 13 (70) | 17367 ms | $0.0000 | $0.000 |
| cohere-rerank-v3.5 | on | 0.858 | 0.728 | 1.000 | 1.000 | -0.006 | n/a | 13 (70) | 2216 ms | $0.0260 | $2.000 |
| cohere-rerank-v3.5 | off | 0.399 | 0.009 | 0.886 | 0.939 | -0.170 | n/a | 13 (70) | 1949 ms | $0.0260 | $2.000 |
| jev-noul | on | 0.858 | 0.728 | 1.000 | 1.000 | -0.006 | n/a | 13 (70) | 531 ms | $0.0026 | $0.200 |
| jev-noul | off | 0.589 | 0.360 | 0.886 | 0.991 | +0.020 | n/a | 13 (70) | 547 ms | $0.0028 | $0.215 |

Cost per 1,000 queries = measured cost per real call × 1,000, since every live query makes a call (the cache only saved this bake-off; column corrected after the run from the logged per-run cost ÷ 13 calls). Cohere is measured in billed search units priced at an assumed $0.002 per unit; Jev in measured input tokens at $0.042 per million (docs.typesafe.ai/models); bge runs locally and costs compute only.

**Run note.** During the bge pass one Postgres server process exited with code 2 (19:53:31 UTC); Postgres reinitialised and recovered in 5 s. No query in the run failed and the corpus, embeddings and rules were intact afterwards (3,509 chunks, 3,287 OpenAI vectors, 35 rules). Cause not identified from the log.
