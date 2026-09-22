"""Table-extractor bake-off against a hand-written answer key (MOO-822; 04 §9.x metrics).

Extractors: pdfplumber (built-in table finder; the verification layer from decision 003) and Docling
(layout model; installed in the `eval` dependency group only). Camelot lattice needs Ghostscript, which is
not installed; it is reported as unavailable rather than silently skipped.

Usage: uv run --group eval python -m app.eval_tables [--no-docling] [sub6.pdf sub5.pdf]
Every number in docs/decisions/009-structure-parser.md comes from this command.
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

KEY = Path(__file__).parent.parent / "tests" / "fixtures" / "tables" / "answer_key.json"
DEFAULT_PDFS = {"CH295-sub6.pdf": Path(__file__).parent.parent / "tests" / "fixtures" / "CH295-sub6.pdf", "CH295-sub5.pdf": Path(__file__).parent.parent.parent.parent / "data" / "zoning-code-pdfs" / "CH295-sub5.pdf"}
DISTRICT = re.compile(r"^(NS[12]|LB[123]|RB[12]|CS|RS[1-6]|RT[1-5]|RM[1-7]|RO[12])$")

Grid = list[list[str]]  # rows of normalized cell strings


def norm(cell: object) -> str:
    s = "" if cell is None else str(cell)
    s = s.replace("\n", " ").replace("R01", "RO1").replace("R02", "RO2")  # the PDF prints a zero in RO1/RO2 on sub5
    return re.sub(r"\s+", " ", s).strip()


def value_match(got: str, want: str) -> bool:
    g, w = got.replace(",", "").replace(" ", "").lower(), want.replace(",", "").replace(" ", "").lower()
    return g == w or (len(w) > 6 and g.startswith(w[:6]))  # long prose cells ("85; no limit if…") match on their start


# ---- extractors: each returns {page: [grid, ...]} for the requested pages ----

def run_pdfplumber(pdf: Path, pages: list[int]) -> dict[int, list[Grid]]:
    import pdfplumber

    out: dict[int, list[Grid]] = {}
    with pdfplumber.open(str(pdf)) as doc:
        for p in pages:
            tables = doc.pages[p - 1].extract_tables()
            out[p] = [[[norm(c) for c in row] for row in t] for t in tables]
    return out


def run_docling(pdf: Path, pages: list[int]) -> dict[int, list[Grid]]:
    from docling.document_converter import DocumentConverter

    res = DocumentConverter().convert(str(pdf), page_range=(min(pages), max(pages)))
    out: dict[int, list[Grid]] = {p: [] for p in pages}
    for tb in res.document.tables:
        page = tb.prov[0].page_no if tb.prov else min(pages)
        df = tb.export_to_dataframe(doc=res.document)
        grid: Grid = [[norm(c) for c in df.columns]] + [[norm(v) for v in row] for row in df.values.tolist()]
        out.setdefault(page, []).append(grid)
    return out


# ---- scoring ----

@dataclass
class Score:
    detected: int = 0
    pages: int = 0
    header_pages: int = 0
    header_expected: int = 0
    cells_ok: int = 0
    cells: int = 0
    markers_ok: int = 0
    markers: int = 0
    merges_ok: int = 0
    merges: int = 0
    seconds: float = 0.0
    misses: list[str] = field(default_factory=list)


def header_map(grid: Grid, expected: list[str]) -> dict[str, int] | None:
    """Column index per district code from the row that names the most of them."""
    best: dict[str, int] = {}
    for row in grid:
        found = {c: i for i, c in enumerate(row) if c in expected}
        if len(found) > len(best):
            best = found
    return best if len(best) >= len(expected) // 2 else None


def find_row(grid: Grid, label: str, first_col: int) -> list[str] | None:
    want = norm(label)[:22].lower()
    for row in grid:
        head = " ".join(c for c in row[:first_col] if c).lower()
        if head.startswith(want) or want in head:
            return row
    return None


def score_table(table: dict, grids: dict[int, list[Grid]], s: Score) -> None:
    blocks = table.get("column_blocks") or {str(p): table["columns"] for p in table["pages"]}
    headers: dict[int, dict[str, int] | None] = {}
    for p in table["pages"]:
        s.pages += 1
        page_grids = grids.get(p, [])
        s.detected += 1 if page_grids else 0
        expected = blocks[str(p)]
        best = None
        for g in page_grids:
            hm = header_map(g, expected)
            if hm and (best is None or len(hm) > len(best[1])):
                best = (g, hm)
        headers[p] = best[1] if best else None
        s.header_expected += 1
        s.header_pages += 1 if best else 0
        if not best:
            s.misses.append(f"page {p}: no header row naming the district columns")
    for a, b in table.get("continuations", []):
        s.merges += 1
        if headers.get(a) and headers.get(b) and set(headers[a]) == set(headers[b]):  # type: ignore[arg-type]
            s.merges_ok += 1
        else:
            s.misses.append(f"pages {a}->{b}: headers differ or missing, cannot merge by header")
    for row in table["rows"]:
        p = row["page"]
        hm = headers.get(p)
        grid = next((g for g in grids.get(p, []) if header_map(g, blocks[str(p)])), None)
        got = find_row(grid, row["label"], min(hm.values())) if (grid and hm) else None
        for col, want in row["cells"].items():
            s.cells += 1
            cell = got[hm[col]] if (got and hm and col in hm and hm[col] < len(got)) else ""
            if value_match(cell, want):
                s.cells_ok += 1
            else:
                s.misses.append(f"p{p} {row['label'][:28]} [{col}]: got {cell!r} want {want!r}")
        for col, marker in row.get("markers", {}).items():
            s.markers += 1
            text = (" ".join(got[: min(hm.values())]) if col == "_label" else got[hm[col]]) if (got and hm and (col == "_label" or col in hm)) else ""
            if marker in text:
                s.markers_ok += 1
            else:
                s.misses.append(f"p{p} {row['label'][:28]} marker {marker!r} on {col}: got {text!r}")


def main(argv: list[str]) -> int:
    use_docling = "--no-docling" not in argv
    key = json.loads(KEY.read_text())
    pdfs = dict(DEFAULT_PDFS)
    for a in argv[1:]:
        if a.endswith(".pdf"):
            pdfs[Path(a).name] = Path(a)
    extractors = {"pdfplumber": run_pdfplumber}
    if use_docling:
        extractors["docling"] = run_docling
    print(f"camelot_lattice: {'available' if shutil.which('gs') else 'unavailable (no Ghostscript binary)'}")
    results: dict[str, Score] = {}
    for name, run in extractors.items():
        s = Score()
        for table in key["tables"]:
            pdf = pdfs.get(table["document"])
            if not pdf or not pdf.exists():
                print(f"  skip {table['id']}: {table['document']} not present")
                continue
            t0 = time.monotonic()
            grids = run(pdf, table["pages"])
            s.seconds += time.monotonic() - t0
            score_table(table, grids, s)
        results[name] = s
    print("\n| extractor | tables detected | header rows found | cells correct | footnote markers kept | continuations mergeable | seconds |")
    print("|---|---|---|---|---|---|---|")
    for name, s in results.items():
        print(f"| {name} | {s.detected}/{s.pages} | {s.header_pages}/{s.header_expected} | {s.cells_ok}/{s.cells} ({s.cells_ok / max(s.cells, 1):.2f}) | {s.markers_ok}/{s.markers} ({s.markers_ok / max(s.markers, 1):.2f}) | {s.merges_ok}/{s.merges} | {s.seconds:.1f} |")
    for name, s in results.items():
        if s.misses:
            print(f"\n{name} misses ({len(s.misses)}):")
            for m in s.misses[:25]:
                print("  -", m)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
