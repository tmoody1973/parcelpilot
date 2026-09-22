"""Seed the official-source registry from the local `data/` folder (MOO-802).

Idempotent: rows are keyed by sha256 (unique index) and objects by hash-named key.
Ordinance PDFs are uploaded to object storage; plans, forms, and incentives are registered
only (large, gitignored, out of v1 scope), with `local_path` for later ingestion.

Usage: uv run python -m app.seed_sources ../../data
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

logging.getLogger("pypdf").setLevel(logging.ERROR)  # font-encoding chatter from the large plan PDFs

JURISDICTION = ("milwaukee-wi", "City of Milwaukee", "WI")
DATE_STAMP = re.compile(r"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b")
OFFICIAL_BASE = "https://city.milwaukee.gov/ImageLibrary/Groups/ccClerk/Ordinances/Volume-2/"

# Subchapter titles as printed in the PDFs (verified 2026-09-21, docs/planning/00_source_verification.md §B).
SUBCHAPTER_TITLES = {
    1: "Introduction", 2: "Definitions and Rules of Measurement", 3: "Administration, Enforcement and Appeals",
    4: "General Provisions", 5: "Residential Districts", 6: "Commercial Districts", 7: "Downtown Districts",
    8: "Industrial Districts", 9: "Special Districts", 10: "Overlay Zones", 11: "Floodplain Overlay Zones",
}


@dataclass(frozen=True)
class Classified:
    source_type: str
    title: str
    official_url: str | None
    upload: bool


def classify(path: Path) -> Classified | None:
    """Map a file under data/ to a registry row. Returns None for files we do not register."""
    parts = path.parts
    name = path.name
    if "zoning-code-pdfs" in parts and name.lower().endswith(".pdf"):
        m = re.match(r"CH295-sub(\d+)\.pdf$", name, re.IGNORECASE)
        if m:
            n = int(m.group(1))
            return Classified("ordinance_subchapter", f"Chapter 295 Subchapter {n} — {SUBCHAPTER_TITLES.get(n, 'Untitled')}", OFFICIAL_BASE + name, True)
        if name.lower() == "ch295table.pdf":
            return Classified("ordinance_table_of_contents", "Chapter 295 Zoning — Table of Contents", OFFICIAL_BASE + name, True)
        return None
    if "plans" in parts and name.lower().endswith(".pdf"):
        return Classified("comprehensive_plan", path.stem.replace("-", " ").replace("_", " "), None, False)
    if "forms" in parts and name.lower().endswith(".pdf"):
        return Classified("procedure_form", path.stem, None, False)
    if "incentives" in parts and name.lower().endswith((".pdf", ".html")):
        return Classified("staff_guidance", path.stem, None, False)
    return None


def date_stamp_from_text(text: str) -> str | None:
    """The printed 'updated through' stamp on ordinance pages, e.g. '7/15/2025'. None if absent."""
    m = DATE_STAMP.search(text or "")
    return f"{int(m.group(1))}/{int(m.group(2))}/{m.group(3)}" if m else None


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pdf_meta(path: Path) -> tuple[int | None, str | None]:
    """(page_count, first-page date stamp). Tolerates non-PDF or unreadable files."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        first = reader.pages[0].extract_text() if reader.pages else ""
        return len(reader.pages), date_stamp_from_text(first)
    except Exception:  # noqa: BLE001 - registry must not fail on one odd file
        return None, None


def iter_files(data_dir: Path):
    for sub in ("zoning-code-pdfs", "plans", "forms", "incentives"):
        d = data_dir / sub
        if not d.exists():
            print(f"  (skip: {d} not present)")
            continue
        for p in sorted(d.rglob("*")):
            if p.is_file() and not p.name.startswith("."):
                yield p


def main(argv: list[str]) -> int:
    import boto3
    import psycopg

    data_dir = Path(argv[1] if len(argv) > 1 else "../../data").resolve()
    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    s3 = boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9100"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY_ID", "parcelpilot"),
        aws_secret_access_key=os.environ.get("S3_SECRET_ACCESS_KEY", "parcelpilot-local"),
        region_name="us-east-1",
    )
    bucket = os.environ.get("S3_BUCKET", "parcelpilot-sources")
    now = datetime.now(UTC)
    inserted = uploaded = skipped = 0

    with psycopg.connect(db_url) as conn:
        conn.execute(
            "insert into jurisdictions (id, name, state) values (%s, %s, %s) on conflict (id) do nothing", JURISDICTION
        )
        for path in iter_files(data_dir):
            c = classify(path)
            if c is None:
                continue
            digest = sha256_of(path)
            page_count, stamp = pdf_meta(path) if path.suffix.lower() == ".pdf" else (None, None)
            object_key = None
            if c.upload:
                object_key = f"{JURISDICTION[0]}/{c.source_type}/{digest}.pdf"
                try:
                    s3.head_object(Bucket=bucket, Key=object_key)
                except Exception:  # noqa: BLE001 - absent → upload
                    s3.upload_file(str(path), bucket, object_key, ExtraArgs={"ContentType": "application/pdf"})
                    uploaded += 1
            cur = conn.execute(
                """
                insert into source_documents
                  (jurisdiction_id, source_type, title, official_url, official_url_verified, local_path, object_key,
                   sha256, retrieved_at, retrieval_method, published_marker, page_count, status, review_status)
                values (%s, %s, %s, %s, false, %s, %s, %s, %s, 'manual_upload', %s, %s, 'pending_review', 'unreviewed')
                on conflict (sha256) do nothing
                """,
                (JURISDICTION[0], c.source_type, c.title, c.official_url, str(path.relative_to(data_dir.parent)),
                 object_key, digest, now, stamp, page_count),
            )
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1
        conn.commit()
    print(f"seed complete: inserted={inserted} skipped_existing={skipped} uploaded={uploaded}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
