"""Hierarchy accuracy against a hand-checked answer key (04 §9.x: section id → correct parent ≥ 0.98).

The key lives in tests/fixtures/structure/answer_key.json: {"<sha12>": {"<section>": "<parent>"}}, each
pair read against the PDF. Usage: uv run python -m app.eval_structure [pdf ...]; with no arguments the
committed sub6 fixture is used.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.pages import extract_pages
from app.seed_sources import sha256_of
from app.structure import parse_structure

KEY = Path(__file__).parent.parent / "tests" / "fixtures" / "structure" / "answer_key.json"


def evaluate(pdfs: list[Path]) -> tuple[int, int, list[tuple[str, str | None, str]]]:
    key = json.loads(KEY.read_text())
    hits = total = 0
    misses: list[tuple[str, str | None, str]] = []
    for pdf in pdfs:
        sha = sha256_of(pdf)
        expected = key.get(sha[:12])
        if not expected:
            continue
        pages = [(r.page_number, r.text) for r in extract_pages(pdf, ocr=False)]
        sections, _ = parse_structure(pages, sha)
        parents = {s.section: s.parent for s in sections}
        for section, parent in expected.items():
            total += 1
            got = parents.get(section, "<missing>")
            if got == parent:
                hits += 1
            else:
                misses.append((section, got, parent))
    return hits, total, misses


def main(argv: list[str]) -> int:
    pdfs = [Path(p) for p in argv[1:]] or [Path(__file__).parent.parent / "tests" / "fixtures" / "CH295-sub6.pdf"]
    hits, total, misses = evaluate(pdfs)
    acc = hits / total if total else 0.0
    print(f"hierarchy accuracy: {hits}/{total} = {acc:.3f} (gate 0.98)")
    for section, got, want in misses:
        print(f"  MISS {section}: parsed parent {got!r}, key says {want!r}")
    return 0 if acc >= 0.98 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
