# 04. Zoning RAG design

## 1. Purpose and the one rule

This document designs the retrieval-augmented generation (RAG) system that turns Milwaukee's
official Chapter 295 zoning PDFs, and the related maps, amendments, and staff records, into
searchable, versioned, page-cited evidence. RAG is the phrase for a pattern where a system
retrieves relevant passages from a document store and hands them to something else, instead of
asking a language model to answer from memory alone. Here, the "something else" is a rule
engine, a decision model, and a briefing writer, none of which are allowed to touch a raw PDF
directly.

The one rule that governs every choice in this document: **RAG produces evidence, never
decisions.** It finds the right passages, tables, footnotes, and definitions, and it hands them
over with a citation attached. It never says whether a proposed project passes a zoning rule,
never computes a setback, and never decides a feasibility status. Those jobs belong to the pure
TypeScript rules engine (for numbers), the bounded decision model (JEV, for routing and risk),
and the briefing LLM (for prose, after the decision is locked). If a retrieval step ever finds
itself producing a `pass`, `fail`, or a recommended next step, that is a bug in this design, not
a feature of it.

## 2. Official source registry

Every document ParcelPilot treats as zoning evidence is a row in `source_documents`. Nothing
becomes evidence by being dropped in a folder; it becomes evidence by being registered, hashed,
and eventually reviewed into `active` status.

### 2.1 Fields

| Field | Meaning |
|---|---|
| `jurisdiction_id` | Which municipality this document belongs to (v1: `milwaukee-wi` only). |
| `source_type` | One of: `ordinance_subchapter`, `ordinance_table_of_contents`, `zoning_map`, `amendment`, `staff_guidance`, `special_district_record`, `comprehensive_plan`, `procedure_form`, `gis_layer_snapshot`. |
| `official_url` | Where the document lives on the city's own site, when known. |
| `local_path` | Where ParcelPilot's own immutable copy lives in object storage. |
| `sha256` | A hash (a short fingerprint computed from the file's exact bytes) of the stored file. Any edit to the file changes the hash, so a changed hash is how the system notices a document changed without having to compare full text every time. |
| `retrieved_at` | When ParcelPilot fetched or received this copy. |
| `published_marker` | The date stamp the city itself prints on the document, e.g. "7/15/2025". This is the city's own claim about currency, not ParcelPilot's. |
| `effective_start` / `effective_end` | The window during which this version was the active law, as best known. `effective_end` is null while a version is current. |
| `page_count` | Page count of the stored file, used both for citation bounds and as a cheap sanity check on re-fetch. |
| `status` | `SourceStatus`: `pending_review` \| `active` \| `superseded` \| `withdrawn`. |
| `supersedes_id` | Points to the `source_documents` row this version replaced, if any, so the supersession chain is walkable. |
| `retrieval_method` | `browser_download` \| `manual_upload` \| `api_fetch`. Records how the copy was obtained, because it affects how much we trust the fetch and how the refresh job should try again. |

### 2.2 Seed table: local Chapter 295 files

Per `00_source_verification.md`, all twelve local Chapter 295 files were inspected on 2026-09-21 with
`pdfinfo`/`pdftotext` and are **native text** (a PDF whose pages carry an actual embedded text
layer, as opposed to a scanned image) — none of them need optical character recognition (OCR),
the process of turning a scanned image of text into machine-readable text, to be read. Each
carries a printed date stamp on its pages. This is the seed set for `source_documents`, all with
`source_type = ordinance_subchapter` except the table of contents:

| Local file | Subchapter | Pages | Date stamp | `source_type` |
|---|---|---|---|---|
| `CH295table.pdf` | Table of contents | 2 | 11/4/2025 | `ordinance_table_of_contents` |
| `CH295-sub1.pdf` | 1 — Introduction | 4 | 4/22/2025 | `ordinance_subchapter` |
| `CH295-sub2.pdf` | 2 — Definitions & Rules of Measurement | 42 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub3.pdf` | 3 — Administration, Enforcement, Appeals | 14 | 3/29/2016 | `ordinance_subchapter` |
| `CH295-sub4.pdf` | 4 — General Provisions | 44 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub5.pdf` | 5 — Residential Districts | 35 | 4/22/2025 | `ordinance_subchapter` |
| `CH295-sub6.pdf` | 6 — Commercial Districts | 24 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub7.pdf` | 7 — Downtown Districts | 18 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub8.pdf` | 8 — Industrial Districts | 20 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub9.pdf` | 9 — Special Districts (incl. PD) | 22 | 7/15/2025 | `ordinance_subchapter` |
| `CH295-sub10.pdf` | 10 — Overlay Zones | 12 | 6/18/2019 | `ordinance_subchapter` |
| `CH295-SUB11.pdf` | 11 — Floodplain Overlay Zones | 30 | 11/4/2025 | `ordinance_subchapter` |

Note the date stamps are not uniform: sub3 was last updated in 2016 and sub10 in 2019, while most
others carry 2025 stamps. That spread is itself evidence — it tells a reviewer which subchapters
are more likely to have drifted from the live code and deserve a closer look on ingestion.

Also registered, but **not ingested into chunks or rules in v1** (see §11):

| Local material | `source_type` | Ingestion status |
|---|---|---|
| `data/plans/` — 16 comprehensive/area plan PDFs | `comprehensive_plan` | Registered only. |
| `data/incentives/` — HBA, STRONG Homes, down payment assistance, ARCH program | (registered, no chunk-level `source_type` needed since not ingested) | Registered only. |
| `data/forms/zoningchange/` — map amendment application, approval schedule, affidavit | `procedure_form` | Registered only; useful later as "contact the city" links. |

Milwaukee's own zoning map service (see the ArcGIS layers in `00_source_verification.md` §A) is not a PDF and is
handled by the GIS pipeline, not this one, but a snapshot of it is still registered here under
`source_type = zoning_map` (or `gis_layer_snapshot` for a raw layer pull) so that a saved
feasibility run can point at the exact map state it used, the same way it points at exact PDF
versions.

### 2.3 Refresh process

`city.milwaukee.gov` returns a Cloudflare challenge (a bot-detection page) to automated fetches —
verified in `00_source_verification.md` §B, every attempt to fetch a `CH295-sub*.pdf` directly returned HTTP 403.
That rules out a plain HTTP cron job as the refresh mechanism; something with a real browser has
to be in the loop periodically. The design has four stages:

1. **Weekly automated check.** A scheduled worker job polls `milwaukee.legistar.com` (confirmed
   fetchable live) for new ordinance legislation files that touch "295", and attempts the
   `city.milwaukee.gov/cityclerk/LRB/ordinances/CodeUpdates` changelog page (unverified reachable
   — the job tries it and logs a failure rather than assuming success). Either signal creates a
   `review_tasks` row of type "possible amendment" naming the found item, with no PDF attached
   yet.
2. **Monthly manual/browser-assisted download.** Once a month, a human-in-the-loop step — an
   operator, or a browser-automation task that inherits a signed-in Chrome session the way
   ego-browser does — opens the city's zoning code pages in a real browser and downloads current
   copies of anything that looks changed, dropping them into a `pending` inbox prefix in object
   storage. This is the only step that can actually get past the Cloudflare challenge.
3. **Hash and diff.** A worker job picks up files from the pending inbox, computes their SHA-256,
   and compares it against the hash on the current `active` `source_documents` row for that
   subchapter. An unchanged hash is discarded (or logged as a no-op confirmation). A changed hash
   creates a new `source_documents` row with `status = pending_review`, `retrieval_method =
   manual_upload` (or `browser_download` if the automation did it), and a page-level text diff
   report against the previous active version, attached to a new `review_tasks` row.
4. **Reviewer gate.** Nothing changes to `active` without a reviewer looking at the diff and
   approving it. On approval, the new row becomes `active`, the old row becomes `superseded` with
   `effective_end` set to the approval date (or the document's own effective date, if the
   ordinance states one), and `supersedes_id` on the new row points back at the old one. Any
   `feasibility_runs` that already cited the old version keep citing it unchanged — see §8.

As a secondary signal, the ingestion worker also reads the "date stamp on the first page" pattern
observed in every one of the twelve local files (e.g. "7/15/2025" printed near the top or bottom
of each page). If a newly downloaded file's printed date stamp differs from the currently active
version's stamp, that alone is enough to flag it for review even before the hash comparison
finishes, because it is the city's own claim that something changed.

## 3. Parsing and normalization pipeline

This pipeline lives in the Python worker service, `services/worker-py`, per the canonical
component list. It exists because a zoning PDF is not a bag of text — it is a filing cabinet with
a strict, if slightly inconsistent, internal structure, and losing that structure loses the
ability to say "this fact came from this exact table cell."

### 3.1 Tooling choice

- **pdfplumber** (MIT-licensed) is the primary per-page text and word-position extractor. It
  returns not just text but the pixel coordinates of each word, which is what makes page-level
  citation highlighting possible later.
- **pypdfium2** (Apache/BSD-licensed) renders page images, used for the table extraction step and
  for the source-viewer page image.
- **OCRmyPDF + Tesseract** run only as a fallback, when a page's extracted character count is
  below 60% of the page's expected character count for its size and font density (a threshold to
  tune once real low-quality scans are seen; 60% is a starting point, not a measured constant).
  Per §2.2, **all twelve current Chapter 295 files are native text**, so this path will not fire
  on the current corpus — but future amendments, especially older special-district records or
  scanned staff guidance, may not be, so the fallback has to exist even though it is unexercised
  today.
- **Camelot** (MIT-licensed) extracts tables, trying the `lattice` mode (tables with visible ruling
  lines) first and falling back to `stream` mode (tables inferred from whitespace alignment) when
  lattice finds nothing, because Chapter 295's tables — see `Table 295-505-2` in §4 below — mix
  both styles across subchapters.
- **pymupdf is explicitly not the default.** It is a capable library, but it is AGPL-3.0 or
  requires a commercial license, and ParcelPilot has no confirmed license posture for that yet.
  pdfplumber and Camelot cover the same ground under permissive licenses, so pymupdf is a
  documented trade-off to revisit only if a specific extraction gap forces the question, not a
  default choice.

### 3.2 Steps

1. **Per-page text extraction.** For each page, pdfplumber returns text plus character-level
   bounding boxes. This is stored as one `document_pages` row per page: `page_no`, `text`,
   `char_count`, `ocr_used` (boolean), `ocr_confidence` (null unless OCR ran), `image_path` (the
   rendered page image from pypdfium2, used later for citation highlighting and the source
   viewer).
2. **Hierarchy detection.** The pipeline walks the extracted text looking for the numbering
   patterns actually observed in the PDFs:
   - Subchapter headers: `SUBCHAPTER N` in all caps, e.g. `SUBCHAPTER 2` (confirmed at the top of
     `CH295-sub2.pdf`, `DEFINITIONS AND RULES OF MEASUREMENT`).
   - Section numbers: `295-NNN.` followed by a title, e.g. `295-503. Uses.` and `295-201.
     Definitions.` (both confirmed).
   - Numbered subsections: plain digits with a period, e.g. `1.`, `3.`, `5.` (confirmed in
     `295-201`'s definition list, which numbers by odd integers — `1.`, `3.`, `5.`, `7.` — not
     sequentially by one; the regex must not assume consecutive integers).
   - Lettered subsections: `a.`, `b.`, `c.` (confirmed under `295-503.1`, the use-table legend).
   - Compound sub-provision IDs of the form `295-NNN-N-x`, e.g. `295-505-2-b`, `295-505-2-e`,
     `295-505-2-f`, `295-505-2-i`, `295-505-2-m`, `295-505-2-n` (all confirmed as cross-referenced
     inside `CH295-sub5.pdf`, each one a distinct sub-provision with its own heading and, in
     several cases, its own sub-table).
   - Table identifiers: `Table 295-NNN-N` (e.g. `Table 295-503-1`, `Table 295-505-2`, `Table
     295-603-1`) and the compound form `Table 295-NNN-N-x` (e.g. `Table 295-505-2-f`, `Table
     295-505-2-i`).
   
   **Important observed inconsistency:** the numbering scheme is not uniform across subchapters.
   Residential design standards live at `295-505` with sub-provisions `295-505-2-a` through at
   least `-n`, but the commercial subchapter's equivalent design-standards table is `Table
   295-605-5`, not `295-605-2` — the sub-provision numbering does not mirror across chapters.
   The parser therefore treats subchapter-to-section-family mapping as data (looked up per
   subchapter) rather than as a formula (computed from the subchapter number), and a hierarchy
   detection failure on an unfamiliar pattern produces a review task rather than a silent guess.
3. **Section tree construction.** Detected headers become `code_sections` rows, nested by the
   hierarchy above (subchapter → section → subsection → lettered clause → compound sub-provision).
   Each row keeps its page range so any later chunk can point back at exactly where it sits in the
   tree.
4. **Table extraction.** For each detected table identifier, Camelot extracts the grid (lattice
   first, stream fallback), the page image is kept for the source viewer, header rows are
   captured, and district columns are mapped by matching header text against the known district
   code list (e.g. `RS1`, `RS2`, ... `RM7`, `RO1`, `RO2` from `Table 295-503-1`'s column headers,
   confirmed verbatim in `CH295-sub5.pdf`). Units printed near a row label (e.g. "sq. ft.", "ft.")
   are captured onto that row. Footnotes and notes — single, double, and triple asterisks in
   `Table 295-505-2`, and lettered footnotes elsewhere — are detected by their marker characters
   and linked to the specific cell(s) whose value carries that marker, stored as `table_footnotes`
   rows, never as free text floating below the table.
5. **Cross-reference normalization.** Regexes find and resolve references like `s. 295-505-2-b`,
   `sub. 2`, and `table 295-505-2-i` (all confirmed patterns — see the "see s. 295-505-2-b" and
   "see s. 295-505-2-e" annotations directly inside `Table 295-505-2`, and the `*The requirements
   of table 295-505-2-i apply in lieu of...` footnote) into `code_chunks.crossReferenceIds`, so a
   chunk that says "see s. 295-505-2-b" can be expanded to the actual text of that sub-provision
   at retrieval time instead of leaving the reader to go find it.
6. **Chunking.** See §4 for the chunk schema and rules.
7. **Review task generation.** Any low-confidence hierarchy match, any OCR'd page (should be rare
   per §3.1), any table extraction Camelot could not resolve cleanly, and every proposed rule
   candidate (§10) each produce a `review_tasks` row. Nothing skips review by default.
8. **Publish.** Only chunks and rules that clear review move from `pending_review`/`unreviewed`
   status to `active`/`approved`. Everything else stays visible to reviewers but invisible to
   retrieval that feeds the rule engine.

### 3.3 Failure modes

| Step | Failure mode | Detection signal |
|---|---|---|
| Text extraction | Page has no extractable text layer | `char_count` far below expected for page size → triggers OCR fallback |
| Text extraction | Extracted text garbled (bad encoding) | Ratio of non-printable/unexpected characters above a threshold |
| Hierarchy detection | Numbering pattern doesn't match any known regex | Unmatched heading-like line → `review_tasks` "unrecognized structure" |
| Hierarchy detection | Section family numbering differs across subchapters (§3.2 note) | Table/section ID doesn't resolve against the subchapter's known family map |
| Table extraction | Lattice mode finds no grid lines | Zero rows returned → automatic stream-mode retry |
| Table extraction | Stream mode misaligns columns (common with merged/spanning header cells, seen in `Table 295-505-2`'s two-row district group headers) | Row count mismatch against detected header column count → `review_tasks` "table needs manual mapping" |
| Footnote linking | Footnote marker on a cell but no matching footnote text found on the page | Orphan marker → `review_tasks` "unlinked footnote" |
| Cross-reference normalization | Reference text doesn't match a known `code_sections` or `source_tables` id | Unresolved reference kept as raw text, flagged, chunk still published but the cross-reference link is null until reviewed |
| OCR fallback | Confidence below threshold even after OCR | `ocr_confidence` stored on the page; low-confidence pages always get a `review_tasks` row regardless of downstream use |

### 3.6 Multi-page table reconstruction (table families)

Observed in the real source (2026-09-21): `Table 295-505-2 PRINCIPAL BUILDING DESIGN STANDARDS` in subchapter 5 spans pages 783–784, repeats its title on each page, uses district codes as column headers, and carries asterisk footnotes that replace cell values with another table (`*The requirements of table 295-505-2-i apply in lieu of...`). Treating each page as its own table, or flattening to Markdown, would silently drop the footnote from the value it modifies. So the pipeline builds a **table family**: one logical table with per-page fragments and row-level provenance.

```
source_tables (family: tbl_295_505_2)
├── table_fragments: page 783 — page image, detected headers, rows, footnotes * ** ***
├── table_fragments: page 784 — repeated title, headers, remaining rows, footnotes
└── canonical: normalized column schema (district codes), all rows in source order,
    page range, source fragment + row index for every row, inherited headers,
    applicable_footnote_ids per row
```

**Continuation detector.** A fragment on page N+1 becomes a candidate continuation of the family on page N only when several signals agree, and the join is never permanent without review:

1. Adjacent pages (or an explicit "continued" reference).
2. Repeated table title / "continued" label / compatible nearby heading.
3. Matching or near-matching normalized column headers.
4. Compatible column count and column geometry (x-positions within tolerance).
5. Row-label or category ordering that continues logically.
6. No intervening section heading that changes legal context.
7. Mandatory reviewer approval (`source_tables.merge_review_status = approved`) before any row from a multi-fragment family may seed a `rule_candidates` row.

Every canonical row keeps: `source_fragment_id`, `row_index_on_page`, `bbox`, `applicable_footnote_ids`. Example row record:

```json
{
  "family_key": "tbl_295_505_2",
  "row_key": "tbl_295_505_2_height_max_ft",
  "label": "Height, maximum (ft.)",
  "unit": "ft",
  "cells": { "RS1": "45", "RS2": "45", "RT4": "48", "RT5": "48" },
  "source_fragment_id": "…", "page": 783, "row_index_on_page": 22,
  "applicable_footnote_ids": [],
  "review_status": "approved"
}
```

**Extractor cascade.** No single extractor is trusted. Order: Docling (MIT, layout-aware document model with reading order and table structure; evaluated in M2 on this exact table) → Camelot lattice → Camelot stream → pdfplumber line/word geometry for verification and visual debugging → manual entry in the review UI. Each fragment records which extractor produced it and its metrics. Adopt Docling as the default structure parser only if it beats Camelot+pdfplumber on the M2 footnote-attachment and continuation-merge tests; PyMuPDF stays out for licensing reasons (decision 003).

## 4. Chunk schema

Rather than splitting documents into arbitrary fixed-length token chunks, each chunk is
**one self-contained provision or one complete table row with its header and its footnotes
attached** — a design choice PRD §10.4.B already establishes and this document reuses without
change, because splitting a table row from its footnote is exactly the failure mode that would
make ParcelPilot cite a number without the exception that governs it.

### 4.1 Base type (from PRD §10.4.C, reproduced)

```ts
type CodeChunk = {
  id: string;
  jurisdiction: "milwaukee-wi";
  codeFamily: "zoning";
  chapter: string;
  subchapter?: string;
  section: string;
  subsection?: string;
  heading?: string;
  sourceType: "ordinance_text" | "table_row" | "footnote" | "definition" | "amendment" | "map_legend";
  districtCodes: string[];
  overlayCodes: string[];
  ruleCategories: Array<"use" | "height" | "setback_front" | "setback_side" | "setback_rear" | "density" | "parking" | "lot_coverage">; // canonical RuleCategory; procedure/definition chunks carry an empty list and are found via chunk_kind
  documentId: string;
  officialUrl: string;
  documentHash: string;
  effectiveStart?: string;
  effectiveEnd?: string;
  status: "pending_review" | "active" | "superseded";
  pageStart: number;
  pageEnd?: number;
  text: string;
  tableJson?: Record<string, unknown>;
  parentSectionId?: string;
  precedingChunkId?: string;
  followingChunkId?: string;
  crossReferenceIds: string[];
  reviewerStatus: "unreviewed" | "reviewed" | "approved";
};
```

### 4.2 Added fields for this design

| Field | Type | Purpose |
|---|---|---|
| `embedding_version_id` | `string` | Points at the `embedding_versions` row whose model+dimension produced this chunk's stored vector, so an index never mixes vectors from two different embedding models. |
| `tsv` | `tsvector` (Postgres full-text index column) | The lexical search index for this chunk; see §5 for why it needs a custom configuration. |
| `chunk_kind` | `"operative_provision" \| "table_row" \| "table_header" \| "footnote" \| "definition" \| "exception" \| "purpose_statement" \| "procedure"` | A finer label than `sourceType`: distinguishes an actual table row (with its cell values) from the header row that gives those values meaning, and separates a definition from the ordinary operative text that uses it. |
| `source_anchors` | `Array<{ page: number; bbox?: [x0, y0, x1, y1] }>` | Exact page and box(es) the chunk's text came from, from pdfplumber char positions or a `table_fragments` row. This is what the source viewer highlights. |
| `table_family_id` | `uuid?` | For table rows/headers/footnotes: the `source_tables` family the chunk belongs to. |
| `applicable_footnote_ids[]` | `uuid[]` | For table rows: the `table_footnotes` rows that qualify this row's values. Retrieval always pulls these with the row. |
| `district_codes[]` | `string[]` | For `chunk_kind = table_row`, the district column(s) that row's values apply to, read directly off the table's column headers (e.g. a `Table 295-503-1` row's `district_codes` includes `RS1`...`RS6`, `RT1`...`RT5`, `RM1`...`RM7`, `RO1`, `RO2` for uses permitted everywhere, or a narrower list for uses limited to some districts). This is the field retrieval filters on to answer "does this apply to my parcel's district." |
| `token_count` | `integer` | Size of the chunk's text, used both for budget planning when assembling an evidence bundle (§7) and as an input to chunk-size review (very large or very small chunks are flagged). |
| `text_hash` | `string` | A hash of this chunk's own text, distinct from the parent document's `sha256`, so re-parsing that produces byte-identical chunk text does not spuriously create a new chunk version. |
| `review_status` | `ReviewStatus`: `unreviewed` \| `in_review` \| `approved` \| `rejected` | The chunk's own review state, separate from `reviewerStatus` inherited from the PRD type — kept because the canonical `ReviewStatus` enum (§2 of the conventions doc) is what the rest of the system's review tooling uses, and this document should not introduce a second name for the same idea. |

### 4.3 Chunking rules

- A chunk is never split across a footnote boundary: if a table row carries a footnote marker (an
  asterisk, or a lettered note), the full footnote text is embedded in that row's chunk in
  addition to being its own separate `footnote`-kind chunk with a link back, so a retrieval that
  only surfaces the row still carries the exception with it.
- Every term in `CH295-sub2.pdf` that is printed in ALL CAPS as a defined term (e.g. `ACCESSORY
  DWELLING UNIT`, `ADULT FAMILY HOME`, confirmed patterns from the definitions subchapter) becomes
  its own `chunk_kind = definition` chunk. Any other chunk whose text uses that same term (matched
  by a case-sensitive scan for the exact defined phrase) gets that definition's chunk id added to
  its `crossReferenceIds`, so "what does 'accessory dwelling unit' mean here" never requires a
  separate search.
- A purpose/intent paragraph (e.g. the RO1/RO2 district-purpose prose seen at the top of
  `CH295-sub5.pdf`, before `295-503`) becomes its own `purpose_statement` chunk — useful context
  for a briefing but never load-bearing for a numeric finding.
- **Target sizes:** an `operative_provision` chunk targets 150–400 tokens (a token is roughly a
  word-and-a-half, so this is a paragraph to a few paragraphs); a `table_row` chunk targets
  whatever its row plus header plus footnotes actually take, with no artificial cap, because
  truncating a table row loses the fact it exists to record; a `definition` chunk is usually
  50–200 tokens. Chunks meaningfully outside these bands are not rejected automatically, but they
  are flagged in review as a signal the hierarchy detection may have merged or split something it
  shouldn't have.

## 5. Indexes

Two indexes back retrieval, and they are combined, never used alone, because zoning questions mix
two different kinds of lookup: exact identifiers (a district code, a section number) and fuzzy
concepts (a user's description of what they want to build, which will not use the ordinance's own
vocabulary).

### 5.1 Lexical index

A Postgres `tsvector` column (`tsv`) holds a lexical search index — the same technology behind
Postgres full-text search generally, a database index built from stemmed, weighted words that
supports fast keyword search. It uses a **custom text search configuration** rather than the
default English config, because the default stems and normalizes words in a way that would corrupt
the exact strings that matter most in this domain: a section number like `295-505-2-i` or a
district code like `RM3` must never be stemmed, lowercased-and-merged with a similar-looking word,
or split at the hyphen the way English stemming would treat a normal compound word. The
configuration routes tokens recognized as section numbers, table IDs, and district/overlay codes
(matched by pattern before indexing) through the `simple` dictionary (a Postgres built-in that only
lowercases, without any stemming or stopword removal), while ordinary prose tokens go through the
normal English stemming dictionary. A **trigram index** (using Postgres's `pg_trgm` extension,
which indexes overlapping three-character sequences) is added specifically for section-number
prefix search, so a user or the query planner typing `295-505` finds every provision under that
family even with a partial or slightly malformed input.

### 5.2 Semantic index

A `pgvector` HNSW index (Hierarchical Navigable Small World — an index type that makes
nearest-neighbor vector search fast by building a layered graph of nearby points, instead of
comparing a query against every stored vector one by one) on `code_chunks.embedding`, using cosine
distance (a similarity measure between two vectors based on the angle between them, common for
text embeddings). The vector's dimension is pinned per `embedding_versions` row — a re-embed job
runs whenever the embedding model or dimension changes, and **an index never mixes chunks embedded
by two different model versions**, because comparing vectors from different embedding spaces
produces meaningless similarity scores. `retrieval_runs` records which `embedding_version_id` was
active for that run, so a saved evidence bundle can always be traced back to the exact model that
produced its semantic matches.

Embedding model default: per the conventions doc, OpenAI `text-embedding-3-large` (truncated from
3072 to 1536 dimensions) or Voyage `voyage-3` as an alternative; either choice gets its own
`embedding_versions` row, and switching later is a re-embed job, not a schema change.

### 5.3 Metadata filters

Every query, lexical or semantic, always carries hard metadata filters before ranking runs:
jurisdiction (`milwaukee-wi` in v1), `status = active`, the effective-date window relevant to the
analysis date, the chapter family relevant to the subquestion (e.g. don't search Chapter 295's
industrial subchapter for a residential parcel's use question), `district_codes` and
`overlay_codes` intersected against the parcel's actual districts and overlays, and the relevant
`rule_categories`. A semantic search is never allowed to run unfiltered across the whole corpus —
doing so is both slower and more likely to surface a plausible-sounding but wrong-district match.

## 6. Retrieval plan

For a given feasibility run, the query planner builds one set of subquestions and works through
them in a fixed order. This section describes that order; §7 describes what comes out the other
end.

### 6.1 Subquestion construction

One subquestion per `RuleCategory` in scope for the run (per the conventions doc's v1 list: `use`,
`height`, `setback_front`, `setback_side`, `setback_rear`, plus whichever one of `density` /
`parking` / `lot_coverage` the reviewer has enabled), plus a district-and-overlay-applicability
subquestion, and a procedure subquestion (what process, if any, applies — e.g. is a special use
permit required per the `S` code in the use table).

### 6.2 Per-subquestion retrieval order

1. **Hard filters.** Apply §5.3's metadata filters scoped to this subquestion's category and the
   scenario's parcel districts/overlays.
2. **Exact lexical lookup.** District code, section number, defined term, or use name — an exact
   or near-exact string match against the `simple`-dictionary tokens described in §5.1. For a use
   question this might be a direct lookup of the use name (e.g. "Two-family dwelling") against
   `Table 295-503-1`'s row labels.
3. **Semantic retrieval.** A `pgvector` search over the filtered chunk set, to catch cases where
   the user's or scenario's own terminology doesn't exactly match the ordinance's phrasing (e.g. a
   scenario describing "a duplex" should still find "Two-family dwelling").
4. **Table and rule lookup.** For categories backed by an approved rule (§10), retrieve the
   `zoning_rules` record itself plus its linked `source_tables` row and every `table_footnotes`
   row attached to the cell(s) it came from — never the rule number alone, always with its table
   context.
5. **Required-context expansion.** Before the bundle is considered complete, the planner pulls in:
   the parent section (so a table row isn't shown orphaned from its governing section text), any
   defined term used in the retrieved text (via `crossReferenceIds`, per §4.3), the adjacent
   subsection, any exception clause that cross-references the retrieved provision, any Subchapter
   4 (General Provisions) text that names the district in question, Subchapter 10/11 overlay text
   if the parcel's overlay detection (from GIS) found one, and any amendment chunk that
   supersedes or modifies the retrieved text.
6. **Merge with Reciprocal Rank Fusion (RRF).** Lexical and semantic result lists are merged using
   `RRF = 1/(60 + rank_lex) + 1/(60 + rank_vec)` — a rank-based (not score-based) fusion formula
   that rewards a chunk appearing near the top of either list without needing the two lists' raw
   scores to be on comparable scales, which lexical and semantic scores otherwise are not. The
   constant 60 is the standard RRF smoothing value used in the reference implementations this
   project is drawing on (Supabase's hybrid-search guide, ParadeDB's hybrid-search writeup), not a
   value tuned specifically for this corpus yet.
7. **Reranking.** The merged candidate set is reranked by a cross-encoder (a model that scores a
   query and a candidate passage together, rather than comparing separately computed vectors,
   which is slower but more accurate for final-stage ranking). Default: Cohere Rerank (hosted
   API). Fallback for offline or cost-sensitive operation: `bge-reranker-v2-m3`
   (Apache-2.0-licensed, self-hostable).

### 6.3 Required-context checklist, worked example: height

For a `height` subquestion, the bundle is not considered complete until it contains:

- The relevant row of `Table 295-505-2` (or the equivalent design-standards table for the parcel's
  actual subchapter — recall from §3.2 that this is not always numbered `-505-2`) for the parcel's
  district, giving the printed "Height, maximum (ft.)" value.
- Every footnote marker attached to that height cell — confirmed in `CH295-sub5.pdf`, several
  districts' height cells carry a `*` or `**` marker pointing to `Table 295-505-2-i`, which
  supplies minimum height and front-façade-width standards that apply "in lieu of" the base
  table's minimum. Missing that footnote would make the base table look like it has no minimum
  height requirement when in fact a different table sets one.
- The `295-201` definition of "height" (or whatever the exact defined term is; confirmed pattern:
  `CH295-sub2.pdf` is titled "Definitions and Rules of Measurement," which is where a rule of
  measurement like how height is measured from grade would live, distinct from a plain-English
  definition).
- Any general-provision text in Subchapter 4 that modifies height city-wide (e.g. height bonuses,
  height exceptions for rooftop mechanicals) — pulled in by the required-context-expansion step,
  not assumed absent.
- Overlay text, if the parcel's GIS-detected overlay includes a height-restricting overlay zone
  from Subchapter 10 or 11.

A bundle missing any of these is not "close enough" — the retrieval evaluation gate in §9 treats a
missing footnote or missing definition on a required category as a recall failure, same as a
missing table row.

### 6.x Reranker options (decided in M4 by measurement)

| Option | How | Trade-off |
|---|---|---|
| Cohere Rerank (default to start) | Hosted cross-encoder API | Per-query cost, one more vendor, strong out of the box |
| bge-reranker-v2-m3 | Self-hosted, Apache-2.0 | Ops burden, cheapest at scale |
| JEV Noul per candidate | One Noul per (subquestion, chunk) pair, e.g. "Does this passage state a rule that applies to district RM4 for building height?", sort by probability (TypeSafe `rerank_typesafe` cookbook: 1,200 calls cost about $0.06) | Batched calls add latency unless run concurrently; reranking only reorders, never adds candidates; JEV must never see the full corpus, only the shortlist |

All three are evaluated on the same gold-set retrieval metrics (§9). Whichever wins, the reranker's output is evidence ordering only; it never decides pass/fail.

## 7. Evidence bundle construction

Each retrieval pass writes one `retrieval_runs` row (the run-level record: which query planner
version, which embedding version, when) and a `retrieval_evidence` row per surfaced chunk, with:
`chunk_id`, `subquestion`, `rank`, `lexical_score`, `semantic_score`, `rerank_score`,
`selection_reason` (a short machine-written note like "table row for district RM3, height
category"), `required_context_type` (which slot in the §6.3-style checklist this chunk fills, or
null if it's supplementary), and page anchors (document id, page number, and the character-offset
span within that page's text, so the citation can be drawn precisely).

### 7.1 What each consumer receives

| Consumer | Gets | Never gets |
|---|---|---|
| Rules engine | Only `approved` `zoning_rules` rows plus their `rule_citations` and the exact source version they were approved against. | A raw retrieved chunk, however well it scored. |
| JEV state builder | Structured metadata flags only: required-context-found booleans per category, active-version-confirmed, overlay-detected, citation-validation-result, coverage-gap-list. | Any excerpt text, any raw PDF, any table. |
| Briefing LLM | At most N verbatim excerpts (N is a token-budget-driven cap, not a fixed count — set by the frozen briefing contract, not by this document) with page anchors attached to each one. | Search access to the corpus, or any excerpt outside the frozen bundle it was handed. |
| Source viewer | The stored PDF page image, the exact highlight box(es) computed from the citation's character-offset span, and, for a table citation, the extracted table image alongside the live table row. | Nothing withheld here — this is the one consumer meant to show everything, including limitations. |

This mirrors PRD §10.4.E's consumer table, tightened to the exact field-level detail above.

## 8. Page-level citations and versions

A citation is the tuple: `(document_id, page_no, char_start, char_end, section, chunk_id,
document_sha256)`. The `document_sha256` is included in the citation itself, not just looked up
from the document row, so that even if a document row's status later changes, the citation still
carries proof of exactly which bytes it pointed at.

The source viewer opens the stored PDF (or its rendered page image) at `page_no` and draws a
highlight box computed from `char_start`/`char_end` against that page's stored word-position data
from pdfplumber (§3.1).

**Superseded handling.** A saved `feasibility_runs` row cites the exact `code_chunks` /
`source_documents` version that was active when the run executed — that citation is immutable and
never silently repointed at a newer version. If the cited document is later superseded (§2.3), the
viewer detects this by checking the cited `source_documents` row's current `status`, and if it is
`superseded`, shows a banner: *"This source has been superseded by version X on date Y"* — without
changing anything about what the saved run actually says or cited. The run is a historical record;
the banner is a live annotation on top of it, and the two are kept clearly separate so a saved memo
never quietly starts disagreeing with itself.

## 9. Retrieval evaluation

A gold set (`gold_cases`, per the conventions doc) records, for retrieval purposes, the required chunk
ids per case and per `RuleCategory`, including the footnotes and definitions each case's checklist
(§6.3-style) demands — not just the primary operative section.

### 9.1 Metrics

| Metric | What it measures |
|---|---|
| Recall@k (k = 5, 10, 20) | Of the required passages for a case, how many appear in the top-k retrieved results. |
| Exact table-row + footnote recall | Whether the specific table row and every attached footnote were retrieved together, not just the table in general. |
| Active-version correctness | Whether every citation in the bundle points at a chunk whose source document is `active` as of the case's analysis date — a citation to a `superseded` or `pending_review` document is a failure. |
| District/overlay filter correctness | Whether the retrieved chunks' `district_codes`/`overlay_codes` actually match the case's parcel. |
| Bundle completeness rate | The fraction of cases where every required-context slot (§6.3) was filled, not just the primary passage. |
| Reranker lift | Recall@k with reranking enabled minus Recall@k without it, to justify keeping the reranking stage. |

### 9.2 Where this runs

Run in CI on every retrieval-affecting change (query planner, chunking rules, embedding version,
reranker choice) — this is a gate, not a periodic report, because a silent regression in retrieval
quality is exactly the kind of failure that is invisible until a briefing cites the wrong table.

### 9.3 Initial gates (proposed, not yet measured against a real gold set)

- Recall@10 ≥ 0.90 on required operative passages.
- Footnote recall ≥ 0.95.
- Zero inactive-version citations in any passing run.

These are starting targets to validate or revise once the 50-case gold set (per the milestone plan
in `06`) exists; they are not backed yet by a measured baseline.

### 9.x Parsing and table-reconstruction metrics (before retrieval metrics)

Retrieval cannot be better than the corpus. Track, on a labeled sample of pages and tables from the twelve local PDFs:

| Layer | Metric | Proposed gate |
|---|---|---|
| Parsing | Section-hierarchy accuracy (section id → correct parent) | ≥ 0.98 on labeled pages |
| Parsing | Table detection recall (every `Table 295-…` title has a family) | 1.0 for subchapters 5 and 6 |
| Table reconstruction | Correct continuation-merge rate (no false merges, no missed continuations) | 1.0 after review; extractor-only rate reported |
| Table reconstruction | Header inheritance correctness on continuation pages | 1.0 after review |
| Table reconstruction | Footnote attachment accuracy (footnote linked to the right cells) | ≥ 0.95 extractor-only; 1.0 after review |
| Provenance | Every canonical row has a fragment + page + bbox | 1.0 (DB constraint) |

## 10. Reviewer workflow before a rule becomes executable

A `zoning_rules` row is never created directly from parsed text. The path is:

1. **Extraction.** `rule_candidates` are extracted **by code**, from table rows and their linked
   footnotes, never by a language model reading and summarizing prose. Code extraction means the
   candidate's numeric value, unit, and district scope trace directly back to specific table cells
   — there is no interpretive step to get wrong. An LLM may be used to **propose a candidate's
   human-readable label** (e.g. suggesting "Rear setback, RM3" as a friendly name for a raw table
   row), and that proposal is explicitly flagged in the UI as LLM-suggested, never presented as
   though the underlying value came from the LLM.
2. **Review queue.** Each `rule_candidate` lands in `review_tasks`, visible in the web app's
   reviewer-role view, showing: the source page image, the extracted row exactly as pulled, every
   linked footnote, and the proposed rule parameters.
3. **Reviewer action.** A reviewer approves, edits, or rejects the candidate, and a rejection or an
   edit requires a stated reason, kept with the task for audit purposes.
4. **Immutable approval.** Approval creates a new, immutable `zoning_rules` row (a new version row,
   never an in-place edit, per the conventions doc's append-only rule for this table) with its
   `rule_citations` populated from the exact chunks and table cells it was approved against.
5. **Second sign-off for critical rules.** A rule marked `Criticality = critical` requires a second
   reviewer, or Tarik directly, to sign off before it can move to `approved` — a single reviewer's
   approval is not sufficient for the rules most likely to sit at the center of a feasibility call.
6. **Only `approved` loads into the engine.** The rules engine (§7.1) reads only rows with
   `ReviewStatus = approved`; anything still `unreviewed`, `in_review`, or `rejected` is invisible
   to it, however confident the extraction was.

Chunk-level review follows the same shape for the cases §3.3 flags automatically: low-confidence
hierarchy detection, OCR'd pages, and tables Camelot couldn't cleanly resolve all produce their own
`review_tasks` and stay out of the `active` corpus that feeds retrieval until a reviewer clears
them — a low-confidence chunk can be searched and shown to a reviewer, but it does not reach a live
feasibility run's evidence bundle.

## 11. Out of scope for v1

- **Comprehensive and area plans** (`data/plans/`) are registered as `source_type =
  comprehensive_plan` but are never chunked, never indexed, and never surfaced to the rule engine
  or the RAG evidence bundle — they are city policy context, not zoning rule text, and mixing the
  two risks a briefing citing aspirational planning language as if it were binding code.
- **Incentive programs** (`data/incentives/`) are registered but not ingested; they are mostly
  irrelevant to the infill-developer wedge this prototype targets and can wait.
- **No LLM-generated chunks, ever.** Every chunk that reaches the active corpus comes from the
  code-driven parsing pipeline in §3, not from a language model summarizing or restructuring
  ordinance text. An LLM's only sanctioned role anywhere in this pipeline is the narrow,
  explicitly-flagged rule-candidate-labeling assist in §10.1.
- **No cross-jurisdiction support.** Everything in this document is scoped to `milwaukee-wi`; the
  schema has a `jurisdiction_id`/`jurisdiction` field precisely so a second jurisdiction can be
  added later without a schema change, but nothing in v1 builds, tests, or assumes a second one
  exists.
