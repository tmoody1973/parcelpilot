# 006 — Demo the first real parcel with hand-reviewed rules before building retrieval

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** The first demo (milestones M0, M1, M3) runs one real Milwaukee parcel through parcel lookup, a scenario, the deterministic rules engine with rules the domain reviewer entered and approved by hand from the printed tables, a conservative status, and a templated, page-cited memo. The PDF ingestion and retrieval system (M2, M4) come after.

**Why this came up.** The natural build order is "ingest the code, then search it, then compute". That puts the riskiest, slowest work (table extraction, footnotes, reranking) in front of the first moment anyone can see the product work.

**Options.**
1. Ingestion first. Cost: weeks before a demo; retrieval bugs mask rules-engine bugs.
2. Rules first with hand-entered rules (chosen). Cost: a few hours of reviewer data entry that the ingestion pipeline will later replace; a risk that hand-entered rules diverge from extracted ones (mitigated: extracted rules must match the hand-entered set for the demo district before they replace them).
3. Mock everything. Cost: proves nothing about real data.

**What we chose and why.** Option 2. Rules are data; where they came from does not change how the engine or the policy behaves. The demo proves the safety chain on real parcel and GIS data with the fewest moving parts.

**What we gave up.** A little rework, and the demo cannot show the evidence viewer's search; it can show page-level citations because hand-entered rules still cite a page.

**How we'll know if this was right.** The demo parcel's gold case passes in CI by the end of M3, and the reviewer signs off on the memo language, before any retrieval code exists.

**What actually happened.** _(Tarik fills in later.)_
