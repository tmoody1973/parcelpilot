"""Section tree and chunking (MOO-823; PRD §10.4 B steps 4 and 6; 04_zoning_rag_design.md §3.2, §4.3).

Pure: page texts in, sections and chunks out. The numbering patterns are the ones observed in the
Chapter 295 PDFs: `295-603.` opens a section, `1.` / `2.` open numbered subsections (often inline
after the section title), `a.` opens a lettered clause, `a-2.` and `f-5-a.` open compound clauses.
A `Table 295-…` title opens a region that is skipped here (MOO-824 owns table rows). A heading
whose parent cannot be resolved is kept with confidence "low" so the queue can look at it.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

HEADER = re.compile(r"^(?:Zoning\s+295-[\d\-a-z]+|295-[\d\-a-z]+\s+Zoning)\s*$")
FOOTER = re.compile(r"^\s*(?:\d{1,2}/\d{1,2}/20\d{2}\s+-\d{3,4}[a-z]?-|-\d{3,4}[a-z]?-\s+\d{1,2}/\d{1,2}/20\d{2})\s*$")
SUBCHAPTER = re.compile(r"^SUBCHAPTER\s+(\d+)\s*$")
SECTION = re.compile(r"^(295-\d{3,4})\.\s+([^.]{2,120}?)\.(?:\s+(.*))?$")  # 295-601. … and 295-1001. … (subchapters 10, 11)
TABLE_TITLE = re.compile(r"^Table\s+295-\d{3,4}-\d+(?:-[a-z])?(?:\s+[A-Z][A-Z0-9 ,&/\-]+)?\s*$")
# Inline heading tokens inside a line of text: "1. USE TABLE." / "a. Family Day Care Home." / "a-2." / "f-5-a."
NUMBERED = re.compile(r"(?:(?<=^)|(?<=\s))(\d{1,2})\.\s+(?=[A-Z“\"])")
LETTERED = re.compile(r"(?:(?<=^)|(?<=\s))([a-z])\.\s+(?=[A-Z“\"(])(?![A-Z]{2,6}\s+\d)")
COMPOUND = re.compile(r"(?:(?<=^)|(?<=\s))([a-z])-(\d{1,2})(?:-([a-z]))?\.\s+")
TITLE_AFTER = re.compile(r"^([A-Z][A-Za-z0-9 ,;/&()'’\-]{2,90}?)\.\s+")
DISTRICT = re.compile(r"\b(NS[12]|LB[123]|RB[12]|CS|RS[1-6]|RT[1-4]|RM[1-7]|RO[12]|IL[12]|IM|IH|IO|C9[A-H]?|PK|TL|IC|PD|DPD|GPD)\b")
REF_BEFORE = re.compile(r"\b(?:sub|subd|subds|par|subpar|s|ss)\.\s*$")
CROSS_REF = re.compile(r"\bs\.\s*(295-\d{3,4}(?:-\d{1,2})?(?:-[a-z])?(?:-\d{1,2})?(?:-[a-z])?)")
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "use": ("use table", "permitted use", "limited use", "special use", "prohibited use", "dwelling unit", "uses"),
    "height": ("height",),
    "setback_front": ("front setback", "front yard"),
    "setback_side": ("side setback", "side yard", "side street setback"),
    "setback_rear": ("rear setback", "rear yard"),
    "density": ("lot area per dwelling unit", "density", "dwelling units per"),
    "parking": ("parking",),
    "lot_coverage": ("lot coverage", "impervious"),
}


@dataclass(frozen=True)
class Section:
    section: str  # e.g. 295-603-2-a-2
    heading: str
    level: int  # 0 subchapter, 1 section, 2 numbered, 3 lettered, 4 compound, 5 compound-deep
    parent: str | None
    page: int
    sort_order: int
    confidence: str  # high | low


@dataclass(frozen=True)
class Chunk:
    family_id: str
    section: str
    heading: str | None
    source_type: str  # ordinance_text | definition
    text: str
    page_start: int
    page_end: int
    district_codes: tuple[str, ...]
    rule_categories: tuple[str, ...]
    cross_refs: tuple[str, ...]  # section ids referenced as "s. 295-…"
    ordinal: int


@dataclass
class _Cursor:
    section: str | None = None
    numbered: str | None = None
    lettered: str | None = None
    compound: str | None = None
    subchapter: str | None = None
    sort: int = 0
    sections: list[Section] = field(default_factory=list)


def family_id(document_sha: str, section: str, ordinal: int) -> str:
    return f"{document_sha[:12]}:{section}:{ordinal}"


def _lines(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """(page, line) pairs with running headers, date footers and blank lines removed."""
    out: list[tuple[int, str]] = []
    for page, text in pages:
        for raw in (text or "").splitlines():
            line = raw.strip()
            if not line or HEADER.match(line) or FOOTER.match(line):
                continue
            out.append((page, line))
    return out


def _push(cur: _Cursor, section: str, heading: str, level: int, parent: str | None, page: int, confidence: str = "high") -> None:
    cur.sort += 1
    if any(s.section == section for s in cur.sections):
        confidence = "low"  # the same id twice means a heading was misread somewhere; a reviewer decides
    cur.sections.append(Section(section, heading.strip(" .:"), level, parent, page, cur.sort, confidence))


def _split_inline_headings(line: str) -> list[tuple[str, str, str, str]]:
    """Break one line into (kind, id_token, title, rest) segments at heading tokens, in order."""
    marks: list[tuple[int, int, str, str]] = []
    for m in COMPOUND.finditer(line):
        marks.append((m.start(), m.end(), "compound", m.group(0).strip().rstrip(".")))
    for m in NUMBERED.finditer(line):
        marks.append((m.start(), m.end(), "numbered", m.group(1)))
    for m in LETTERED.finditer(line):
        if not any(a <= m.start() < b for a, b, _, _ in marks):
            marks.append((m.start(), m.end(), "lettered", m.group(1)))
    # "subpar. c. With a gabled roof…" / "sub. 2. If…": a token right after a reference word is a citation, not a heading.
    marks = [m for m in marks if not REF_BEFORE.search(line[: m[0]])]
    marks.sort()
    if not marks:
        return [("text", "", "", line)]
    segments: list[tuple[str, str, str, str]] = []
    if marks[0][0] > 0:
        segments.append(("text", "", "", line[: marks[0][0]].strip()))
    for i, (start, end, kind, token) in enumerate(marks):
        stop = marks[i + 1][0] if i + 1 < len(marks) else len(line)
        body = line[end:stop].strip()
        title = ""
        t = TITLE_AFTER.match(body)
        if t and (kind in ("numbered", "lettered")) and t.group(1).count(" ") <= 9:
            title = t.group(1)
            body = body[t.end():].strip()
        segments.append((kind, token, title, body))
    return segments


def parse_structure(pages: list[tuple[int, str]], document_sha: str, subchapter_hint: int | None = None) -> tuple[list[Section], list[Chunk]]:
    """Walk the page text once. Every heading becomes a Section; the text after it (to the next heading) a Chunk."""
    cur = _Cursor()
    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_section: str | None = None
    buf_heading: str | None = None
    buf_page_start = 0
    buf_page_end = 0
    in_table = False
    ordinals: dict[str, int] = {}
    definitions = subchapter_hint == 2

    def flush() -> None:
        nonlocal buf, buf_section
        text = " ".join(buf).strip()
        if buf_section and text:
            n = ordinals.get(buf_section, 0) + 1
            ordinals[buf_section] = n
            heading_up = (buf_heading or "").upper()
            source_type = "definition" if definitions and buf_heading and buf_heading == heading_up and len(buf_heading) > 3 else "ordinance_text"
            chunks.append(Chunk(
                family_id(document_sha, buf_section, n), buf_section, buf_heading, source_type, text, buf_page_start, buf_page_end,
                tuple(sorted(set(DISTRICT.findall(text)))), tuple(c for c, words in CATEGORY_WORDS.items() if any(w in text.lower() for w in words)),
                tuple(dict.fromkeys(CROSS_REF.findall(text))), n,
            ))
        buf = []

    def start(section: str, heading: str | None, page: int) -> None:
        nonlocal buf_section, buf_heading, buf_page_start, buf_page_end
        flush()
        buf_section, buf_heading, buf_page_start, buf_page_end = section, heading, page, page

    REF_TAIL = re.compile(r"\b(?:sub|subd|par|subpar|s)\.\s*$")
    CAPS_TITLE = re.compile(r"^\d{1,2}\.\s+[A-Z][A-Z0-9 ,&/\-]{2,}\.")
    last_page = None
    for page, line in _lines(pages):
        if in_table and page != last_page and not TABLE_TITLE.match(line):
            in_table = False  # a multi-page table repeats its title on every page (04 §3.6); no title → the table ended
        last_page = page
        if buf and REF_TAIL.search(buf[-1]) and NUMBERED.match(line):
            # "…standards of sub." + "2. If the use…": a cross-reference split by a line break, not a heading.
            buf.append(line)
            buf_page_end = page
            continue
        if TABLE_TITLE.match(line):
            flush()
            in_table = True
            buf_section = None
            continue
        m = SUBCHAPTER.match(line)
        if m:
            flush()
            in_table = False
            cur.subchapter = f"subchapter-{m.group(1)}"
            _push(cur, cur.subchapter, f"Subchapter {m.group(1)}", 0, None, page)
            buf_section = None
            continue
        m = SECTION.match(line)
        if m:
            in_table = False
            sec, title, rest = m.group(1), m.group(2), m.group(3) or ""
            cur.section, cur.numbered, cur.lettered, cur.compound = sec, None, None, None
            _push(cur, sec, title, 1, cur.subchapter, page)
            start(sec, title, page)
            line = rest
            if not line:
                continue
        elif in_table:
            # Inside a table only a lettered/compound heading at line start, or a numbered heading with an
            # ALL-CAPS title ("2. LIMITED USE STANDARDS."), ends the region; numbered table rows do not.
            if not (LETTERED.match(line) or COMPOUND.match(line) or CAPS_TITLE.match(line)):
                continue
            in_table = False
        if cur.section is None:
            # Preamble before the first section (subchapter title line, purpose prose): attach to the subchapter.
            if cur.subchapter and not buf_section:
                start(cur.subchapter, None, page)
            buf.append(line)
            buf_page_end = page
            continue
        for kind, token, title, body in _split_inline_headings(line):
            if kind == "text":
                if body:
                    if buf_section is None:
                        start(cur.section, None, page)
                    buf.append(body)
                    buf_page_end = page
                continue
            if kind == "numbered":
                sid = f"{cur.section}-{token}"
                cur.numbered, cur.lettered, cur.compound = sid, None, None
                _push(cur, sid, title or body[:60], 2, cur.section, page)
            elif kind == "lettered":
                parent = cur.numbered or cur.section
                conf = "high" if cur.numbered else "low"
                sid = f"{parent}-{token}"
                cur.lettered, cur.compound = sid, None
                _push(cur, sid, title or body[:60], 3, parent, page, conf)
            else:  # compound a-2 / f-5-a
                letter, num, deep = token.split("-")[0], token.split("-")[1], (token.split("-")[2] if token.count("-") == 2 else None)
                base = cur.lettered if cur.lettered and cur.lettered.endswith(f"-{letter}") else (f"{cur.numbered}-{letter}" if cur.numbered else None)
                conf = "high" if cur.lettered and cur.lettered.endswith(f"-{letter}") else "low"
                if base is None:
                    base = f"{cur.section}-{letter}"
                if deep:
                    parent = f"{base}-{num}"
                    sid = f"{parent}-{deep}"
                    _push(cur, sid, title or body[:60], 5, parent, page, conf)
                else:
                    sid = f"{base}-{num}"
                    cur.compound = sid
                    _push(cur, sid, title or body[:60], 4, base, page, conf)
            start(sid, title or None, page)
            if body:
                buf.append(body)
                buf_page_end = page
    flush()
    return cur.sections, chunks


def hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
