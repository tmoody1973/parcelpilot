"""Page extraction on a real chapter (CH295-sub6.pdf, a public City ordinance) and a scanned fixture."""

from __future__ import annotations

import io
import shutil
from pathlib import Path

import pytest

from app.pages import (
    OCR_DENSITY_THRESHOLD,
    extract_pages,
    needs_ocr,
    printed_page_of,
    render_page_png,
)

FIXTURES = Path(__file__).parent / "fixtures"
SUB6 = FIXTURES / "CH295-sub6.pdf"


@pytest.fixture(scope="module")
def sub6_pages():
    return extract_pages(SUB6, ocr=False)


@pytest.fixture(scope="module")
def scanned_pdf(tmp_path_factory) -> Path:
    """Two image-only pages (sub6 pages 16–17 rendered and re-saved without a text layer)."""
    from PIL import Image

    images = [Image.open(io.BytesIO(render_page_png(SUB6, n, scale=2.0))).convert("RGB") for n in (16, 17)]
    out = tmp_path_factory.mktemp("scan") / "scanned-2p.pdf"
    images[0].save(out, format="PDF", save_all=True, append_images=images[1:], resolution=144)
    return out


def test_sub6_has_24_pages_all_native(sub6_pages):
    assert len(sub6_pages) == 24
    assert all(r.ocr_status == "native" for r in sub6_pages)
    assert all(r.char_density > OCR_DENSITY_THRESHOLD for r in sub6_pages)
    assert len({r.content_hash for r in sub6_pages}) == 24, "every page hashes differently"


def test_page_16_is_the_design_standards_table(sub6_pages):
    p16 = sub6_pages[15]
    assert p16.page_number == 16
    assert "Height, maximum (ft.)" in p16.text
    assert "TABLE 295-605-2" in p16.text
    assert p16.printed_page == 824, "footer reads -824-"
    assert sub6_pages[1].printed_page == 812 and sub6_pages[5].printed_page == 816


def test_printed_page_regex():
    assert printed_page_of("Zoning 295-605-2\n\n7/15/2025 -824-\n") == 824
    assert printed_page_of("no footer") is None


def test_scanned_pages_route_to_ocr(scanned_pdf):
    records = extract_pages(scanned_pdf, ocr=False)
    assert len(records) == 2
    assert all(needs_ocr(r.char_density) for r in records)
    assert all(r.ocr_status == "empty" for r in records)


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="tesseract binary not installed (CI installs it)")
def test_ocr_recovers_the_table_heading(scanned_pdf):
    records = extract_pages(scanned_pdf, ocr=True)
    p = records[0]
    assert p.ocr_status == "ocr"
    assert p.ocr_confidence is not None and p.ocr_confidence > 40  # 144 dpi scan of a dense table; native pages never reach OCR
    assert "295-605-2" in p.text.replace(" ", "") or "PRINCIPAL BUILDING" in p.text.upper()


def test_ocr_unavailable_is_flagged_not_fatal(monkeypatch, scanned_pdf):
    monkeypatch.setattr("app.pages.ocr_png", lambda png: None)
    records = extract_pages(scanned_pdf, ocr=True)
    assert all(r.ocr_status == "ocr_unavailable" and r.ocr_confidence is None for r in records)


def test_render_page_png_is_a_png():
    png = render_page_png(SUB6, 16, scale=0.5)
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 1000
