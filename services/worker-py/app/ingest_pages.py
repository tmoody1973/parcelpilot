"""Write document_pages for every registered ordinance PDF (MOO-820).

Idempotent: a page is keyed by (source_document_id, page_number) and the row is never updated; a
changed PDF is a new source_documents row. Page images go to object storage under
{jurisdiction}/pages/{sha256}/{page}.png and are skipped when already present. Pages that needed
OCR, could not be OCR'd, or came out empty get a page_review task for the reviewer queue.

Usage: uv run python -m app.ingest_pages ../../data     (root: pnpm ingest:pages)
"""

from __future__ import annotations

import os
import statistics
import sys
import time
from pathlib import Path

from app.pages import extract_pages, render_page_png

ORDINANCE_TYPES = ("ordinance_subchapter", "ordinance_table_of_contents")


def main(argv: list[str]) -> int:
    import boto3
    import psycopg

    data_dir = Path(argv[1] if len(argv) > 1 else "../../data").resolve()
    repo_root = data_dir.parent
    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9100"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID", "parcelpilot"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY", "parcelpilot-local"),
        region_name="us-east-1",
    )
    bucket = os.environ.get("S3_BUCKET", "parcelpilot-sources")
    started = time.monotonic()
    totals = {"documents": 0, "pages": 0, "inserted": 0, "existing": 0, "uploaded": 0, "native": 0, "ocr": 0, "flagged": 0}
    densities: list[float] = []

    with psycopg.connect(db_url) as conn:
        docs = conn.execute(
            "select id, jurisdiction_id, sha256, local_path, title, page_count from source_documents where source_type = any(%s) and local_path is not null order by title",
            (list(ORDINANCE_TYPES),),
        ).fetchall()
        for doc_id, jurisdiction, sha, local_path, title, page_count in docs:
            pdf = repo_root / local_path
            if not pdf.exists():
                print(f"  skip {title}: {pdf} not present")
                continue
            records = extract_pages(pdf)
            totals["documents"] += 1
            totals["pages"] += len(records)
            if page_count and page_count != len(records):
                print(f"  warning {title}: registry says {page_count} pages, extractor saw {len(records)}")
            for r in records:
                densities.append(r.char_density)
                if r.ocr_status in ("native", "ocr"):
                    totals[r.ocr_status] += 1
                key = f"{jurisdiction}/pages/{sha}/{r.page_number}.png"
                try:
                    s3.head_object(Bucket=bucket, Key=key)
                except Exception:  # noqa: BLE001 - absent → upload
                    s3.put_object(Bucket=bucket, Key=key, Body=render_page_png(pdf, r.page_number), ContentType="image/png")
                    totals["uploaded"] += 1
                cur = conn.execute(
                    """
                    insert into document_pages (source_document_id, page_number, printed_page, raw_text, char_density, ocr_confidence, image_ref, content_hash)
                    values (%s, %s, %s, %s, %s, %s, %s, %s)
                    on conflict (source_document_id, page_number) do nothing
                    returning id
                    """,
                    (doc_id, r.page_number, r.printed_page, r.text, r.char_density, r.ocr_confidence, key, r.content_hash),
                )
                row = cur.fetchone()
                if row is None:
                    totals["existing"] += 1
                    continue
                totals["inserted"] += 1
                if r.ocr_status != "native":
                    # Thin or image-only pages always get a human look (04 §10: OCR'd pages stay out of the active corpus until cleared).
                    conn.execute(
                        """
                        insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
                        values (%s, 'page_review', 'document_page', %s, 'medium', %s)
                        on conflict (task_type, entity_type, entity_id) do nothing
                        """,
                        (jurisdiction, row[0], f"{r.ocr_status}: char_density {r.char_density}"),
                    )
                    totals["flagged"] += 1
        conn.commit()

    elapsed = round(time.monotonic() - started, 1)
    med = round(statistics.median(densities), 2) if densities else None
    print(
        f"pages: documents={totals['documents']} pages={totals['pages']} inserted={totals['inserted']} existing={totals['existing']} "
        f"uploaded={totals['uploaded']} native={totals['native']} ocr={totals['ocr']} flagged={totals['flagged']} "
        f"density min={min(densities) if densities else None} median={med} elapsed={elapsed}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
