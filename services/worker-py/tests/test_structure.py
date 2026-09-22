"""Section tree and chunks on the real Subchapter 6 fixture (MOO-823)."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import pytest

from app.eval_structure import KEY, evaluate
from app.pages import extract_pages
from app.structure import family_id, parse_structure

FIXTURES = Path(__file__).parent / "fixtures"
SUB6 = FIXTURES / "CH295-sub6.pdf"
SHA6 = "198a9062664ed8499838570152f0111392dd126366a4950b0dd3e28f32362f24"


@pytest.fixture(scope="module")
def parsed():
    pages = [(r.page_number, r.text) for r in extract_pages(SUB6, ocr=False)]
    return parse_structure(pages, SHA6, 6)


def test_sub6_tree_shape(parsed):
    sections, chunks = parsed
    assert len(sections) == 294 and len(chunks) == 292
    assert [s.section for s in sections if s.level == 1] == ["295-601", "295-603", "295-605"]
    assert Counter(s.section for s in sections).most_common(1)[0][1] == 1, "no duplicate section ids"
    assert [s for s in sections if s.confidence == "low"] == []
    assert [s.section for s in sections if s.parent == "295-605-2"] == [f"295-605-2-{x}" for x in "abcdefghi"]


def test_street_level_dwelling_clause(parsed):
    _, chunks = parsed
    c = next(c for c in chunks if "No dwelling unit shall be permitted in the street-level area" in c.text)
    assert c.section == "295-603-2-a-2" and c.page_start == 6 and c.page_end == 6
    assert "use" in c.rule_categories and c.district_codes == ()
    assert c.family_id == family_id(SHA6, "295-603-2-a-2", 1) == "198a9062664e:295-603-2-a-2:1"


def test_table_rows_are_not_chunked_and_footers_are_stripped(parsed):
    _, chunks = parsed
    text = " ".join(c.text for c in chunks)
    assert "Health club" not in text and "Festival grounds" not in text, "use-table rows belong to MOO-824"
    assert "-824-" not in text and "7/15/2025" not in text and "Zoning 295-601" not in text


def test_tags_and_cross_references(parsed):
    _, chunks = parsed
    by = {c.section: c for c in chunks}
    assert "295-201" in by["295-603-1"].cross_refs, "the use table intro cites s. 295-201"
    assert "295-311-2" in by["295-603-1-b"].cross_refs
    height = by["295-605-2-f-1"]
    assert "height" in height.rule_categories
    purposes = by["295-601-2"]
    assert {"LB1", "LB2", "LB3"} <= set(purposes.district_codes)


def test_deterministic_family_ids_and_ordering(parsed):
    _, chunks = parsed
    ids = [c.family_id for c in chunks]
    assert len(set(ids)) == len(ids)
    again = parse_structure([(r.page_number, r.text) for r in extract_pages(SUB6, ocr=False)], SHA6, 6)[1]
    assert [c.family_id for c in again] == ids


def test_hierarchy_accuracy_gate():
    key = json.loads(KEY.read_text())
    assert len(key["198a9062664e"]) >= 60, "the answer key covers at least 60 hand-checked pairs"
    hits, total, misses = evaluate([SUB6])
    assert total >= 60
    assert hits / total >= 0.98, misses
