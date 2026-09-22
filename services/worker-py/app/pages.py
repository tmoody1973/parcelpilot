"""Page extraction (MOO-820; PRD §10.4 B steps 2–3; 04_zoning_rag_design.md §3.2).

Pure functions over a PDF: one record per page with native text, a quality score, the printed page
number, and a content hash; a PNG render per page; OCR only when the native text is too thin.
No database, no object storage, no model. `ingest_pages.py` does the writing.
"""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from pathlib import Path

# Native characters per square inch of page. Chapter 295 pages sit around 8–12; a scanned page has
# ~0. Below this the page is treated as image-only and sent to OCR (04 §3.2 step 3).
OCR_DENSITY_THRESHOLD = 0.5
PRINTED_PAGE = re.compile(r"(?<!\S)-(\d{3,4})-(?!\S)")  # footer like "-824-", alone or at line end
RENDER_SCALE = 2.0  # 144 dpi: readable in the review UI, small enough to store per page


@dataclass(frozen=True)
class PageRecord:
    page_number: int  # 1-based, position in the PDF
    printed_page: int | None  # the number in the page footer, when present
    text: str
    char_density: float  # native characters per square inch
    content_hash: str  # sha256 of the text (or of the OCR text)
    ocr_confidence: float | None  # None when native text was used
    ocr_status: str  # native | ocr | ocr_unavailable | empty


def printed_page_of(text: str) -> int | None:
    m = PRINTED_PAGE.search(text or "")
    return int(m.group(1)) if m else None


def needs_ocr(char_density: float) -> bool:
    return char_density < OCR_DENSITY_THRESHOLD


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def render_page_png(pdf_path: Path, page_number: int, scale: float = RENDER_SCALE) -> bytes:
    """PNG bytes of one page (1-based). pypdfium2 is the renderer: MIT/BSD, no PyMuPDF (decision 003)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        image = pdf[page_number - 1].render(scale=scale).to_pil()
        buf = io.BytesIO()
        image.save(buf, format="PNG", optimize=True)
        return buf.getvalue()
    finally:
        pdf.close()


def ocr_png(png: bytes) -> tuple[str, float] | None:
    """OCR text and mean word confidence (0–100), or None when Tesseract is not installed."""
    try:
        import pytesseract
        from PIL import Image

        image = Image.open(io.BytesIO(png))
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    except (ImportError, OSError, RuntimeError):  # pytesseract's TesseractNotFoundError is an OSError
        return None
    confs = [float(c) for c in data.get("conf", []) if str(c) not in ("-1", "-1.0")]
    text = " ".join(w for w in data.get("text", []) if w and w.strip())
    return text, (sum(confs) / len(confs) if confs else 0.0)


def extract_pages(pdf_path: Path, *, ocr: bool = True) -> list[PageRecord]:
    """Native text per page via pdfplumber; OCR for thin pages when `ocr` and Tesseract are available."""
    import pdfplumber

    records: list[PageRecord] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            area_sqin = max((page.width / 72.0) * (page.height / 72.0), 1e-6)
            density = len(page.chars) / area_sqin
            printed = printed_page_of(text)
            if not needs_ocr(density):
                records.append(PageRecord(i, printed, text, round(density, 3), text_hash(text), None, "native"))
                continue
            result = ocr_png(render_page_png(pdf_path, i)) if ocr else None
            if result is None:
                status = "ocr_unavailable" if ocr else "empty"
                records.append(PageRecord(i, printed, text, round(density, 3), text_hash(text), None, status))
            else:
                ocr_text, conf = result
                records.append(PageRecord(i, printed_page_of(ocr_text) or printed, ocr_text, round(density, 3), text_hash(ocr_text), round(conf, 2), "ocr"))
    return records
