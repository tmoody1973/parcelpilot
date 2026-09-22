"""Write code_sections and code_chunks for every document that has pages (MOO-823).

Idempotent: chunks are keyed by (family_id, version) with family_id deterministic from
(document sha, section id, ordinal); sections by (document, section, sort_order). A section whose
parent could not be resolved (confidence low) gets a page_review task, and its chunks stay
reviewer_status = unreviewed. Everything is inserted pending_review; the reviewer queue activates.

Usage: uv run python -m app.ingest_structure      (root: pnpm ingest:structure)
"""

from __future__ import annotations

import os
import re
import sys
import time
import uuid

from app.structure import parse_structure

SUBCHAPTER_OF_TITLE = re.compile(r"Subchapter (\d+)")


def main(argv: list[str]) -> int:
    import psycopg

    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    started = time.monotonic()
    totals = {"documents": 0, "sections": 0, "sections_existing": 0, "chunks": 0, "chunks_existing": 0, "low": 0, "unresolved_refs": 0}

    with psycopg.connect(db_url) as conn:
        docs = conn.execute(
            "select d.id, d.jurisdiction_id, d.sha256, d.title, d.effective_start from source_documents d where exists (select 1 from document_pages p where p.source_document_id = d.id) order by d.title"
        ).fetchall()
        for doc_id, jurisdiction, sha, title, effective_start in docs:
            pages = conn.execute("select page_number, raw_text from document_pages where source_document_id = %s order by page_number", (doc_id,)).fetchall()
            m = SUBCHAPTER_OF_TITLE.search(title or "")
            sections, chunks = parse_structure([(n, t) for n, t in pages], sha, int(m.group(1)) if m else None)
            totals["documents"] += 1
            chapter = "295"
            subchapter = m.group(1) if m else None

            # Sections first, so chunks can point at them. parent_section_id is resolved by section id within the document.
            section_ids: dict[str, str] = {}
            for s in sections:
                row = conn.execute(
                    """
                    insert into code_sections (source_document_id, chapter, subchapter, section, heading, parent_section_id, page_start, sort_order, confidence)
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (source_document_id, section, sort_order) do nothing returning id
                    """,
                    (doc_id, chapter, subchapter, s.section, s.heading or s.section, section_ids.get(s.parent) if s.parent else None, s.page, s.sort_order, s.confidence),
                ).fetchone()
                if row is None:
                    existing = conn.execute("select id from code_sections where source_document_id = %s and section = %s and sort_order = %s", (doc_id, s.section, s.sort_order)).fetchone()
                    if existing is None:
                        continue
                    section_ids.setdefault(s.section, existing[0])
                    totals["sections_existing"] += 1
                    continue
                section_ids.setdefault(s.section, row[0])
                totals["sections"] += 1
                if s.confidence == "low":
                    totals["low"] += 1
                    conn.execute(
                        "insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason) values (%s, 'page_review', 'code_section', %s, 'medium', %s) on conflict do nothing",
                        (jurisdiction, row[0], f"hierarchy: parent of {s.section} on page {s.page} could not be resolved with confidence"),
                    )

            low_sections = {s.section for s in sections if s.confidence == "low"}
            # Chunks are append-only, so reading-order neighbours must be known before insert: ids are minted here.
            ids = [str(uuid.uuid4()) for _ in chunks]
            for i, c in enumerate(chunks):
                refs = [section_ids[r] for r in c.cross_refs if r in section_ids]
                totals["unresolved_refs"] += len(c.cross_refs) - len(refs)
                row = conn.execute(
                    """
                    insert into code_chunks (id, family_id, version, jurisdiction_id, chapter, subchapter, section, heading, source_type, district_codes, rule_categories,
                                             source_document_id, page_start, page_end, text, parent_section_id, preceding_chunk_id, following_chunk_id, cross_reference_ids,
                                             status, reviewer_status, effective_start)
                    values (%s, %s, 1, %s, %s, %s, %s, %s, %s, %s, %s::rule_category[], %s, %s, %s, %s, %s, %s, %s, %s::uuid[], 'pending_review', 'unreviewed', %s)
                    on conflict (family_id, version) do nothing returning id
                    """,
                    (ids[i], c.family_id, jurisdiction, chapter, subchapter, c.section, c.heading, c.source_type, list(c.district_codes), list(c.rule_categories),
                     doc_id, c.page_start, c.page_end, c.text, section_ids.get(c.section), ids[i - 1] if i > 0 else None, ids[i + 1] if i + 1 < len(chunks) else None, refs, effective_start),
                ).fetchone()
                if row is None:
                    totals["chunks_existing"] += 1
                else:
                    totals["chunks"] += 1
                    if c.section in low_sections:
                        totals.setdefault("chunks_low", 0)
            # Note: on a partial re-run (some chunks already present) neighbour ids of new rows point at ids that were
            # not inserted; ingestion is all-or-nothing per document in practice (family ids are deterministic), and a
            # changed document is a new source_documents row with a fresh set.
        conn.commit()

    elapsed = round(time.monotonic() - started, 1)
    print(
        f"structure: documents={totals['documents']} sections={totals['sections']} (existing {totals['sections_existing']}) "
        f"chunks={totals['chunks']} (existing {totals['chunks_existing']}) low_confidence={totals['low']} unresolved_refs={totals['unresolved_refs']} elapsed={elapsed}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
