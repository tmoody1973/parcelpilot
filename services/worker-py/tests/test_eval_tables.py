"""The table extractor MOO-824 builds on must keep reproducing the keyed cells of Table 295-605-2 (decision 009)."""

from __future__ import annotations

import json
from pathlib import Path

from app.eval_tables import KEY, Score, run_pdfplumber, score_table

SUB6 = Path(__file__).parent / "fixtures" / "CH295-sub6.pdf"


def test_pdfplumber_reproduces_every_keyed_cell_of_table_295_605_2():
    table = next(t for t in json.loads(KEY.read_text())["tables"] if t["id"] == "295-605-2")
    s = Score()
    score_table(table, run_pdfplumber(SUB6, table["pages"]), s)
    assert (s.detected, s.header_pages) == (1, 1)
    assert s.cells_ok == s.cells == 56, s.misses
    assert s.markers == 0  # this table has no footnote markers on the keyed rows


def test_answer_key_covers_the_signed_v1_values():
    """Every LB1/LB2 value the reviewer signed in MOO-813 is a keyed cell here, so MOO-824 can reconcile against it."""
    table = next(t for t in json.loads(KEY.read_text())["tables"] if t["id"] == "295-605-2")
    by_label = {r["label"]: r["cells"] for r in table["rows"]}
    assert by_label["Height, maximum (ft.)"]["LB1"] == "45" and by_label["Height, maximum (ft.)"]["LB2"] == "60"
    assert by_label["Height, minimum (ft.)"]["LB2"] == "18" and by_label["Height, minimum (ft.)"]["LB1"] == "none"
    assert by_label["Front setback, maximum (ft.)"]["LB1"] == "70" and by_label["Front setback, maximum (ft.)"]["LB2"] == "average"
    assert by_label["Lot area per dwelling unit, minimum (sq. ft.)"]["LB1"] == "1,200" and by_label["Lot area per dwelling unit, minimum (sq. ft.)"]["LB2"] == "800"
