"""Write table families for subchapters 5 and 6 (MOO-824): source_tables, table_fragments, table_footnotes,
and one table_row code_chunk per canonical row; a merge_review task for every multi-fragment family.

Idempotent: a family is keyed by (document, family_key), a chunk by (family_id, version). Rows are
append-only, so a re-run inserts nothing; a changed PDF is a new document.

Usage: uv run python -m app.ingest_tables ../../data      (root: pnpm ingest:tables)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

from app.tables import (
    build_families,
    categories_for,
    extract_fragments,
    metrics,
    titles_on_page,
)

V1_SUBCHAPTERS = ("Subchapter 5", "Subchapter 6")


def main(argv: list[str]) -> int:
    import psycopg

    data_dir = Path(argv[1] if len(argv) > 1 else "../../data").resolve()
    repo_root = data_dir.parent
    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    started = time.monotonic()
    totals = {"documents": 0, "families": 0, "families_existing": 0, "fragments": 0, "footnotes": 0, "chunks": 0, "chunks_existing": 0, "merge_reviews": 0}
    all_metrics: dict[str, dict] = {}

    with psycopg.connect(db_url) as conn:
        docs = conn.execute(
            "select id, jurisdiction_id, sha256, title, local_path, effective_start from source_documents where source_type::text = 'ordinance_subchapter' and local_path is not null order by title"
        ).fetchall()
        for doc_id, jurisdiction, sha, title, local_path, effective_start in docs:
            if not any(s in (title or "") for s in V1_SUBCHAPTERS):
                continue
            pdf = repo_root / local_path
            if not pdf.exists():
                print(f"  skip {title}: {pdf} not present")
                continue
            pages = conn.execute("select id, page_number, raw_text from document_pages where source_document_id = %s order by page_number", (doc_id,)).fetchall()
            page_ids = {n: pid for pid, n, _ in pages}
            families = build_families(extract_fragments(pdf, [(n, t) for _, n, t in pages]), sha)
            all_metrics[title] = metrics(families, {tid for _, _, t in pages for tid, _ in titles_on_page(t)})
            totals["documents"] += 1
            subchapter = title.split("Subchapter ")[1].split(" ")[0] if "Subchapter " in title else None

            for fam in families:
                row = conn.execute(
                    """
                    insert into source_tables (source_document_id, family_key, caption, page_start, page_end, canonical_rows, column_schema, merge_review_status, extractor, metrics)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, 'pdfplumber', %s)
                    on conflict (source_document_id, family_key) do nothing returning id
                    """,
                    (doc_id, fam.family_key, fam.caption or fam.table_id, fam.fragments[0].page, fam.fragments[-1].page, json.dumps(fam.canonical_rows), json.dumps(fam.columns),
                     "unreviewed" if fam.needs_merge_review else "approved", json.dumps({"fragments": len(fam.fragments), "footnotes": len(fam.footnotes), "rows": len(fam.canonical_rows)})),
                ).fetchone()
                if row is None:
                    totals["families_existing"] += 1
                    continue
                table_id = row[0]
                totals["families"] += 1
                frag_ids: dict[int, str] = {}
                for frag in fam.fragments:
                    fid = conn.execute(
                        "insert into table_fragments (source_table_id, document_page_id, page_number, bbox, headers, rows, extractor, continuation_signals) values (%s, %s, %s, %s, %s, %s, 'pdfplumber', %s) returning id",
                        (table_id, page_ids[frag.page], frag.page, json.dumps(dict(zip(("x0", "y0", "x1", "y1"), frag.bbox))), json.dumps(frag.headers), json.dumps(frag.grid), json.dumps(frag.signals)),
                    ).fetchone()[0]
                    frag_ids[frag.page] = fid
                    totals["fragments"] += 1
                for note in fam.footnotes:
                    applies = [r["row_key"] for r in fam.canonical_rows if any(ref["marker"] == note.marker and ref["page"] == note.page for ref in r["footnote_refs"])]
                    conn.execute(
                        "insert into table_footnotes (source_table_id, fragment_id, marker, text, applies_to_row_keys) values (%s, %s, %s, %s, %s)",
                        (table_id, frag_ids.get(note.page), note.marker, note.text, applies),
                    )
                    totals["footnotes"] += 1
                if fam.needs_merge_review:
                    conn.execute(
                        "insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason) values (%s, 'merge_review', 'source_table', %s, 'high', %s) on conflict do nothing",
                        (jurisdiction, table_id, f"Table {fam.table_id} spans pages {fam.fragments[0].page}-{fam.fragments[-1].page}: confirm the fragments are one table and the headers carry over"),
                    )
                    totals["merge_reviews"] += 1
                # One retrievable chunk per canonical row: the row plus its footnotes, so a hit carries the exception with it.
                section_id = conn.execute("select id from code_sections where source_document_id = %s and section = %s order by sort_order limit 1", (doc_id, fam.table_id.rsplit("-", 1)[0] if fam.table_id.count("-") >= 2 else fam.table_id)).fetchone()
                for r in fam.canonical_rows:
                    cells = "; ".join(f"{k}: {v}" for k, v in r["cells"].items() if v)
                    note_text = " ".join(f"{ref['marker']} {ref['text']}" for ref in r["footnote_refs"])
                    text = f"Table {fam.table_id}. {r['label']}" + (f" ({r['group']})" if r.get("group") else "") + f". {cells}." + (f" Footnotes: {note_text}" if note_text else "")
                    districts = [k for k, v in r["cells"].items() if v]
                    ins = conn.execute(
                        """
                        insert into code_chunks (id, family_id, version, jurisdiction_id, chapter, subchapter, section, heading, source_type, district_codes, rule_categories,
                                                 source_document_id, page_start, page_end, text, table_json, parent_section_id, status, reviewer_status, effective_start)
                        values (%s, %s, 1, %s, '295', %s, %s, %s, 'table_row', %s, %s::rule_category[], %s, %s, %s, %s, %s, %s, 'pending_review', 'unreviewed', %s)
                        on conflict (family_id, version) do nothing returning id
                        """,
                        (str(uuid.uuid4()), r["family_id"], jurisdiction, subchapter, fam.table_id, r["label"], districts, categories_for(fam.table_id, r["label"]), doc_id,
                         min(s["page"] for s in r["sources"]), max(s["page"] for s in r["sources"]), text, json.dumps(r), section_id[0] if section_id else None, effective_start),
                    ).fetchone()
                    totals["chunks" if ins else "chunks_existing"] += 1
        conn.commit()

    elapsed = round(time.monotonic() - started, 1)
    for title, m in all_metrics.items():
        print(f"  {title}: {json.dumps(m)}")
    print(f"tables: documents={totals['documents']} families={totals['families']} (existing {totals['families_existing']}) fragments={totals['fragments']} footnotes={totals['footnotes']} chunks={totals['chunks']} (existing {totals['chunks_existing']}) merge_reviews={totals['merge_reviews']} elapsed={elapsed}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
