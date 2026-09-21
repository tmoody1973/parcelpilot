# 002 — Search lives in Postgres (full-text + pgvector), no separate search engine or vector database

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** Lexical search (exact words, section numbers, district codes) uses Postgres full-text search; semantic search (meaning-similar passages) uses the pgvector extension in the same database; results are merged with Reciprocal Rank Fusion (a simple formula that combines two ranked lists) and then reranked by a cross-encoder (a model that scores a query and a passage together).

**Why this came up.** Zoning questions mix exact lookups ("RM4", "295-505-2-i", a defined term) with fuzzy ones ("can I put shops on the ground floor"). Teams usually reach for OpenSearch plus Pinecone. That is two more systems to keep in sync with the source-version rules we must enforce.

**Options.**
1. OpenSearch + a hosted vector DB. Cost: two more services, two more places where a superseded document can linger, index-sync bugs.
2. Postgres only (chosen). Cost: full-text search is less tunable than a dedicated engine; HNSW indexes need a little care; at very large corpora Postgres would lag. Our corpus is twelve PDFs, ~270 pages.
3. A hosted "RAG platform" that does chunking and retrieval for you. Cost: it owns chunking, which is precisely the thing we need to control (tables and footnotes must stay together) and audit.

**What we chose and why.** Option 2. The corpus is tiny, the filters (active version, district, category) are relational, and one database means one `status = active` check protects every query path.

**What we gave up.** Best-in-class lexical ranking. If the gold-set recall gate fails on lexical queries, OpenSearch is the escape hatch, as the PRD allows.

**How we'll know if this was right.** M4 gate: Recall@10 ≥ 0.9 on required operative passages and footnote recall ≥ 0.95 on the gold set, with p95 retrieval under one second.

**What actually happened.** _(Tarik fills in later.)_
