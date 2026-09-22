# 009 — pdfplumber stays the table extractor; Docling is not adopted

**Date:** 2026-09-22 · **Status:** decided · **Decided by:** Claude (measured), Tarik to confirm · **Linear:** MOO-822

**Decision.** Zoning tables are extracted with pdfplumber's built-in table finder (the tool decision 003 already picked for text and coordinates), followed by our own table-family step for multi-page tables and footnotes (`04_zoning_rag_design.md` §3.6). Docling (IBM's layout-model parser) is not adopted. It stays installed in an evaluation-only dependency group so this bake-off can be re-run, and it is not in the production image.

**Why this came up.** Decision 003 was amended after Tarik's research pointed at Docling as a possibly better structure parser. Zoning tables are the riskiest part of the corpus: a footnote detached from the cell it modifies, or a multi-page table split in two, can turn a wrong number into a confident finding. The amendment said: evaluate Docling on the two hardest tables and adopt it only if it beats the baseline on footnote attachment and continuation merging.

**How it was measured.** An answer key was written by hand from the printed pages *before* any extractor ran (`services/worker-py/tests/fixtures/tables/answer_key.json`): the keyed rows of Table 295-605-2 (commercial districts, one page) and Table 295-505-2 (residential districts, four pages, two column blocks, four asterisk footnotes), with the exact cell strings and every footnote marker. `uv run --group eval python -m app.eval_tables` scores each extractor on: tables detected per page, header rows that name the district columns, keyed cells correct, footnote markers kept in their cell, continuation pages mergeable by identical headers, and wall time. Camelot's lattice mode needs the Ghostscript binary, which is not installed; it is reported as unavailable rather than skipped silently.

**Options and the numbers.**

| Extractor | Tables detected | Header rows found | Keyed cells correct | Footnote markers kept | Continuations mergeable | Seconds |
|---|---|---|---|---|---|---|
| pdfplumber (built-in table finder) | 5/5 | 5/5 | 136/136 (1.00) | 18/20 (0.90) | 2/2 | 6.5 |
| Docling 2.129 (layout model, CPU) | 5/5 | 1/5 | 42/136 (0.31) | 0/20 (0.00) | 0/2 | 472.6 |

1. **pdfplumber (chosen).** Cost: no layout understanding; multi-page merging and footnote linkage are our code (§3.6), and the two marker misses are ours to fix: a `***` on the second line of a wrapped row label, where the table's rotated side caption ("Density") bleeds into the label cell. Both are post-processing on a grid that is otherwise exact.
2. **Docling.** Cost: on these tables it merges neighbouring cells ("300 1,200", "75 85"), does not surface the district header row on four of five pages, and drops every footnote marker, so the two things we needed most are the two it does worst. It also needs a first-run model download (about six minutes) and roughly a minute per page on CPU, against a few seconds. Install itself was easy (45 seconds, MIT license).
3. **Camelot lattice.** Not measured: requires Ghostscript. Worth a re-run if pdfplumber's grid ever fails on a lattice-ruled table; nothing in subchapters 5 and 6 needs it.

**What we chose and why.** Option 1. The baseline reproduces every keyed value, including the 14 values a reviewer signed by hand in MOO-813, and its only misses are fixable in our own code. Adopting a slower parser that loses footnotes would move the risk in the wrong direction.

**What we gave up.** Docling's reading-order and heading detection for prose, which we did not need: the section parser built in MOO-823 already reaches 82/82 on the hand-checked hierarchy key. And a future where a layout model handles a scanned or irregular table for free; if that document ever arrives, the bake-off is one command.

**How we'll know if this was right.** MOO-824's reconciliation test: the canonical rows of Table 295-605-2 must reproduce all 14 signed LB1/LB2 values, and the four-page residential table must come out as one family with its footnotes attached and a merge-review task. If pdfplumber plus our table-family code cannot get there, this decision reopens with the same script and key.

**What actually happened.** _(Tarik fills in later.)_
