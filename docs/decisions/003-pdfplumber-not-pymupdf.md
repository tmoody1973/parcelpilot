# 003 — pdfplumber as the PDF text extractor, not PyMuPDF

**Date:** 2026-09-21 · **Status:** proposed · **Decided by:** Claude (draft), Tarik to confirm

**Decision.** The Python parsing worker uses pdfplumber (MIT license) for text and character positions, pypdfium2 for page images, Camelot for tables, and OCRmyPDF only when a page has too little native text.

**Why this came up.** The PRD suggests "PyMuPDF and pdfplumber". PyMuPDF is the better layout engine, but it is licensed AGPL-3.0 (a license that can require you to open-source the software that uses it when it is offered over a network) unless you buy a commercial license. ParcelPilot is a commercial SaaS.

**Options.**
1. PyMuPDF under AGPL. Cost: legal review of whether our SaaS would have to publish source; risk of an unpleasant surprise later.
2. PyMuPDF commercial license. Cost: money and a vendor relationship for a twelve-file corpus.
3. pdfplumber + pypdfium2 + Camelot (chosen). Cost: slower, and layout detection on complex multi-page tables is weaker, so more falls to the human reviewer.

**What we chose and why.** Option 3. All twelve Chapter 295 PDFs were checked on 2026-09-21 and are native text, so the heavy-duty extractor buys little. Every executable rule is human-reviewed anyway.

**What we gave up.** Extraction speed and some table-detection accuracy. The reviewer queue absorbs it.

**Amendment, same day.** Tarik's research suggested Docling (IBM, MIT license) as a layout-aware structure parser. It is compatible with this decision (it does not depend on PyMuPDF) and will be evaluated in M2 on the multi-page Table 295-505-2; if it beats Camelot + pdfplumber on footnote attachment and continuation merging, it becomes the default structure parser with pdfplumber kept for coordinates and verification.

**How we'll know if this was right.** M2 exit: every dimensional table in subchapters 5 and 6 has a reviewed row set with footnotes attached, and no reviewer had to re-key a whole table by hand.

**What actually happened.** _(Tarik fills in later.)_
