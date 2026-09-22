"""Table families (MOO-824; 04_zoning_rag_design.md §3.6; decision 009).

Pure: a PDF path and its page texts in, table families out. A family is one logical table that may
span pages: per-page fragments keep the grid, bbox and headers; canonical rows carry row-level
provenance and the footnote markers printed in their cells. Cells stay text ("average", "none",
"*"): nothing here coerces a value to a number. Extractor: pdfplumber's table finder.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

TABLE_TITLE = re.compile(r"^Table\s+(295-\d{3,4}-\d+(?:-[a-z])?)\b\s*(.*)$", re.IGNORECASE)
DISTRICT = re.compile(r"^(NS[12]|LB[123]|RB[12]|CS|RS[1-6]|RT[1-5]|RM[1-7]|RO[12]|IL[12]|IM|IH|IO|C9[A-H]|PK|TL|IC)$")
MARKER = re.compile(r"(\*{1,4})")
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "height": ("height",), "setback_front": ("front setback",), "setback_side": ("side setback",), "setback_rear": ("rear setback",),
    "density": ("lot area per dwelling unit",), "parking": ("parking",), "lot_coverage": ("lot coverage",),
}
USE_TABLES = ("295-503-1", "295-603-1", "295-703-1", "295-803-1")


@dataclass(frozen=True)
class Footnote:
    marker: str
    text: str
    page: int


@dataclass(frozen=True)
class Row:
    row_key: str
    label: str
    group: str | None
    unit: str | None
    cells: dict[str, str]  # district → printed cell text (marker stripped)
    markers: dict[str, str]  # district → marker printed in that cell; "_row" for a label-level marker
    page: int
    row_index_on_page: int
    bbox: tuple[float, float, float, float]


@dataclass
class Fragment:
    table_id: str
    page: int
    caption: str
    bbox: tuple[float, float, float, float]
    headers: list[str]  # district codes in column order
    grid: list[list[str]]  # raw normalized grid
    rows: list[Row]
    footnotes: list[Footnote]
    signals: list[str] = field(default_factory=list)


@dataclass
class Family:
    table_id: str
    family_key: str
    caption: str
    fragments: list[Fragment]
    canonical_rows: list[dict]
    footnotes: list[Footnote]
    columns: list[str]

    @property
    def needs_merge_review(self) -> bool:
        return len(self.fragments) > 1


def norm(cell: object) -> str:
    s = "" if cell is None else str(cell)
    return re.sub(r"\s+", " ", s.replace("\n", " ")).strip()


RANGE = re.compile(r"^([A-Z]{2})(\d)-\1(\d)$")


def unscramble_many(cell: str) -> list[str]:
    """Vertical headers come out reversed with spaces ('1 S N' → NS1; '5 S R -1 S R' → RS1-RS5 → RS1…RS5; 'R01' is printed with a zero)."""
    t = cell.replace(" ", "")
    for cand in (t, t[::-1]):
        cand = cand.replace("R01", "RO1").replace("R02", "RO2")  # after reversal too: '1 0 R' → 'R01' → RO1
        if DISTRICT.match(cand):
            return [cand]
        m = RANGE.match(cand)
        if m and int(m.group(2)) < int(m.group(3)):
            codes = [f"{m.group(1)}{n}" for n in range(int(m.group(2)), int(m.group(3)) + 1)]
            if all(DISTRICT.match(c) for c in codes):
                return codes
    return []


def unscramble(cell: str) -> str | None:
    codes = unscramble_many(cell)
    return codes[0] if len(codes) == 1 else None


def slug(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:60]


def unit_of(label: str, cells: dict[str, str]) -> str | None:
    lab = label.lower()
    if "(sq. ft.)" in lab or "(sq ft)" in lab:
        return "sq ft"
    if "(ft.)" in lab or "(ft)" in lab:
        return "ft"
    if any(v.endswith("%") for v in cells.values()):
        return "%"
    return None


def titles_on_page(text: str) -> list[tuple[str, str]]:
    out = []
    for line in (text or "").splitlines():
        m = TABLE_TITLE.match(line.strip())
        if m:
            out.append((m.group(1), m.group(2).strip()))
    return out


def _split_marker(value: str) -> tuple[str, str | None]:
    """'45*' → ('45', '*'); '**' → ('**', '**'); 'none' → ('none', None)."""
    v = value.strip()
    if v and set(v) <= {"*"}:
        return v, v
    m = re.search(r"(\*{1,4})\s*$", v)
    if m:
        return v[: m.start()].strip(), m.group(1)
    return v, None


def parse_fragment(table_id: str, caption: str, page_no: int, plumber_table) -> Fragment | None:
    """One pdfplumber Table → a Fragment with district-mapped rows, wrapped labels joined, footnotes split out."""
    grid = [[norm(c) for c in row] for row in plumber_table.extract()]
    row_boxes = [r.bbox for r in plumber_table.rows]
    # Header row: the one naming the most district columns.
    best_i, best_map = -1, {}
    for i, row in enumerate(grid):
        found = {code: j for j, c in enumerate(row) if c for code in unscramble_many(c)}
        if len(found) > len(best_map):
            best_i, best_map = i, found
    if len(best_map) < 3:
        # Not a district-column table (e.g. Table 295-505-2-f lists standards per row). Keep the grid for the
        # reviewer and for later table kinds; no canonical rows are minted from it in v1.
        return Fragment(table_id, page_no, caption, tuple(float(x) for x in plumber_table.bbox), [], grid, [], [], ["no_district_header"])  # type: ignore[arg-type]
    dcols = sorted(best_map.items(), key=lambda kv: kv[1])
    headers = [code for code, _ in dcols]
    first_dcol = dcols[0][1]
    # Label column: the column left of the districts with the most text.
    counts = [sum(1 for row in grid[best_i + 1:] if j < len(row) and row[j]) for j in range(first_dcol)]
    label_col = max(range(first_dcol), key=lambda j: counts[j]) if first_dcol > 0 else 0

    rows: list[Row] = []
    footnotes: list[Footnote] = []
    group: str | None = None
    in_footnotes = False
    for i in range(best_i + 1, len(grid)):
        row = grid[i]
        label = row[label_col] if label_col < len(row) else ""
        cells = {code: (row[j] if j < len(row) else "") for code, j in dcols}
        has_cells = any(cells.values())
        first_text = next((c for c in row if c), "")
        if first_text.startswith("*") and first_text.strip("* ") and not has_cells:
            in_footnotes = True  # "*The requirements of table 295-505-2-i apply…": marker followed by text
            m = MARKER.match(first_text)
            footnotes.append(Footnote(m.group(1), first_text[m.end():].strip(), page_no))
            continue
        if in_footnotes:
            if first_text and footnotes:  # wrapped footnote line
                footnotes[-1] = Footnote(footnotes[-1].marker, f"{footnotes[-1].text} {first_text}".strip(), page_no)
            continue
        if not has_cells:
            if not label:
                continue
            if rows and (label[0].islower() or label[0] in "(*"):
                # Wrapped label line ("minimum (sq. ft.) ***", "(see s. 295-505-2-b)", "detached housing").
                prev = rows[-1]
                text, marker = _split_marker(f"{prev.label} {label}")
                markers = dict(prev.markers)
                if marker:
                    markers["_row"] = marker
                rows[-1] = Row(slug(text), text, prev.group, unit_of(text, prev.cells), prev.cells, markers, prev.page, prev.row_index_on_page, prev.bbox)
            else:
                group = label  # "Primary Street", "RESIDENTIAL USES"
            continue
        if not label and rows:
            # Continuation values for the previous row (p15: "25 ft.," then "average" on the next grid row).
            prev = rows[-1]
            merged = {k: (f"{prev.cells[k]} {v}".strip() if v and prev.cells[k] else (v or prev.cells[k])) for k, v in cells.items()}
            rows[-1] = Row(prev.row_key, prev.label, prev.group, prev.unit, merged, prev.markers, prev.page, prev.row_index_on_page, prev.bbox)
            continue
        label_text, row_marker = _split_marker(label)
        values, markers = {}, {}
        for code, v in cells.items():
            val, mk = _split_marker(v)
            values[code] = val
            if mk:
                markers[code] = mk
        if row_marker:
            markers["_row"] = row_marker
        bbox = tuple(float(x) for x in row_boxes[i]) if i < len(row_boxes) else tuple(float(x) for x in plumber_table.bbox)
        rows.append(Row(slug(label_text), label_text, group, unit_of(label_text, values), values, markers, page_no, i, bbox))  # type: ignore[arg-type]
    return Fragment(table_id, page_no, caption, tuple(float(x) for x in plumber_table.bbox), headers, grid, rows, footnotes)  # type: ignore[arg-type]


def extract_fragments(pdf_path: Path, pages: list[tuple[int, str]]) -> list[Fragment]:
    """Every page whose text carries a table title yields one fragment per detected table (largest first)."""
    import pdfplumber

    out: list[Fragment] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_no, text in pages:
            titles = titles_on_page(text)
            if not titles:
                continue
            tables = sorted(pdf.pages[page_no - 1].find_tables(), key=lambda t: -(t.bbox[2] - t.bbox[0]) * (t.bbox[3] - t.bbox[1]))
            for (table_id, caption), t in zip(titles, tables):
                frag = parse_fragment(table_id, caption, page_no, t)
                if frag:
                    out.append(frag)
    return out


def build_families(fragments: list[Fragment], document_sha: str) -> list[Family]:
    """Adjacent pages with the same table id join one family (04 §3.6 signals recorded per fragment)."""
    families: list[Family] = []
    for frag in fragments:
        fam = families[-1] if families else None
        prev = fam.fragments[-1] if fam else None
        if fam and prev and fam.table_id == frag.table_id and frag.page == prev.page + 1:
            frag.signals = [*frag.signals, "adjacent_pages", "title_repeated"] + (["headers_equal"] if frag.headers == prev.headers else ["column_block_changed"]) + (["column_count_compatible"] if abs(len(frag.headers) - len(prev.headers)) <= 2 else [])
            fam.fragments.append(frag)
        else:
            frag.signals = [*frag.signals, "first_fragment"]
            families.append(Family(frag.table_id, f"tbl_{frag.table_id.replace('-', '_')}", frag.caption, [frag], [], [], []))
    for fam in families:
        seen: dict[str, dict] = {}
        columns: list[str] = []
        notes: dict[tuple[str, str], Footnote] = {}
        for frag in fam.fragments:
            for h in frag.headers:
                if h not in columns:
                    columns.append(h)
            for n in frag.footnotes:
                notes.setdefault((n.marker, n.text), n)
            for r in frag.rows:
                key = r.row_key
                if key in seen and set(seen[key]["cells"]) & set(r.cells):
                    key = f"{r.row_key}_p{r.page}"  # same label again on a later page with the same columns: keep both
                entry = seen.setdefault(key, {"row_key": key, "label": r.label, "group": r.group, "unit": r.unit, "cells": {}, "markers": {}, "sources": []})
                entry["cells"].update(r.cells)
                entry["markers"].update(r.markers)
                entry["sources"].append({"page": r.page, "row_index_on_page": r.row_index_on_page, "bbox": list(r.bbox), "fragment_page": frag.page})
                if r.unit and not entry["unit"]:
                    entry["unit"] = r.unit
        fam.footnotes = list(notes.values())
        fam.columns = columns
        by_page = {frag.page: {n.marker: n for n in frag.footnotes} for frag in fam.fragments}
        for entry in seen.values():
            # A marker resolves against the footnotes printed on the same page as the cell that carries it
            # (Table 295-505-2 restarts "***" per column block); the family's notes are the fallback.
            refs: list[dict] = []
            unattached: set[str] = set()
            for src in entry["sources"]:
                page_markers = {m for col, m in entry["markers"].items() if col == "_row" or any(s["page"] == src["page"] for s in entry["sources"] if col in fam_columns_on(fam, s["page"]))}
                for m in sorted(page_markers):
                    note = by_page.get(src["page"], {}).get(m) or next((n for n in fam.footnotes if n.marker == m), None)
                    if note is None:
                        unattached.add(m)
                    elif not any(r["marker"] == m and r["page"] == note.page for r in refs):
                        refs.append({"marker": m, "page": note.page, "text": note.text})
            entry["footnote_refs"] = refs
            entry["applicable_footnotes"] = sorted({r["marker"] for r in refs})
            entry["unattached_markers"] = sorted(unattached)
            entry["family_id"] = f"{document_sha[:12]}:{fam.table_id}:{entry['row_key']}"
        fam.canonical_rows = list(seen.values())
    return families


def fam_columns_on(fam: Family, page: int) -> list[str]:
    frag = next((f for f in fam.fragments if f.page == page), None)
    return frag.headers if frag else []


def categories_for(table_id: str, label: str) -> list[str]:
    lab = label.lower()
    cats = [c for c, words in CATEGORY_WORDS.items() if any(w in lab for w in words)]
    if table_id in USE_TABLES:
        cats.append("use")
    return cats


def metrics(families: list[Family], table_ids_seen: set[str]) -> dict:
    rows = [r for f in families for r in f.canonical_rows]
    found = {f.table_id for f in families}
    return {
        "table_ids_seen": len(table_ids_seen),
        "families": len(families),
        "detection_recall": round(len(found & table_ids_seen) / len(table_ids_seen), 3) if table_ids_seen else None,
        "families_without_district_columns": sum(1 for f in families if not f.columns),
        "fragments": sum(len(f.fragments) for f in families),
        "multi_page_families": sum(1 for f in families if f.needs_merge_review),
        "continuations_with_equal_headers": sum(1 for f in families for fr in f.fragments if "headers_equal" in fr.signals),
        "canonical_rows": len(rows),
        "rows_with_provenance": sum(1 for r in rows if r["sources"] and all(s["bbox"] for s in r["sources"])),
        "rows_with_markers": sum(1 for r in rows if r["markers"]),
        "markers_attached": sum(len(r["applicable_footnotes"]) for r in rows),
        "markers_unattached": sum(len(r["unattached_markers"]) for r in rows),
        "footnotes": sum(len(f.footnotes) for f in families),
    }
