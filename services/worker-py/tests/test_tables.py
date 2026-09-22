"""Table families (MOO-824): the reconciliation against the signed LB1/LB2 rules, and the four-page residential table."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pages import extract_pages
from app.tables import (
    build_families,
    extract_fragments,
    metrics,
    titles_on_page,
    unscramble_many,
)

FIXTURES = Path(__file__).parent / "fixtures"
SUB6 = FIXTURES / "CH295-sub6.pdf"
SUB5 = Path(__file__).parents[3] / "data" / "zoning-code-pdfs" / "CH295-sub5.pdf"
RULES = Path(__file__).parents[3] / "packages" / "contracts" / "rules" / "lb1-lb2-v1.json"

# Which canonical row a v1 rule kind reads, and how a printed cell maps onto the rule's number.
ROW_FOR_KIND = {
    "max_height_ft": ("295-605-2", "Height, maximum (ft.)", "max_ft"),
    "min_height_ft": ("295-605-2", "Height, minimum (ft.)", "min_ft"),
    "min_lot_area_per_unit": ("295-605-2", "Lot area per dwelling unit, minimum (sq. ft.)", "sqft_per_unit"),
    "max_setback_ft": ("295-605-2", "Front setback, maximum (ft.)", "max_ft"),
}
SETBACK_MIN_ROWS = {"setback_front": "Front setback, minimum (ft.)", "setback_side": "Side setback, minimum (ft.)", "setback_rear": "Rear setback, minimum (ft.)"}
# mixed_use and commercial are the form's catch-alls, mapped to the retail row (L) in docs/rules/lb1-lb2-v1.md.
USE_ROWS = {"multifamily": "Multi-family dwelling", "single_family": "Single-family dwelling", "two_family": "Two-family dwelling", "live_work": "Live-work unit", "office": "General office", "retail": "Retail establishment, general", "adult_retail": "Adult retail establishment", "mixed_use": "Retail establishment, general", "commercial": "Retail establishment, general"}


def families_of(pdf: Path, sha: str):
    pages = [(r.page_number, r.text) for r in extract_pages(pdf, ocr=False)]
    fams = build_families(extract_fragments(pdf, pages), sha)
    return fams, metrics(fams, {t for _, txt in pages for t, _ in titles_on_page(txt)})


@pytest.fixture(scope="module")
def sub6():
    return families_of(SUB6, "198a9062664ed8499838570152f0111392dd126366a4950b0dd3e28f32362f24")


def find_row(fams, table_id: str, label_prefix: str) -> dict:
    fam = next(f for f in fams if f.table_id == table_id)
    return next(r for r in fam.canonical_rows if r["label"].startswith(label_prefix))


def as_number(cell: str) -> float | None:
    c = cell.replace(",", "").strip()
    if c == "none":
        return 0.0
    try:
        return float(c)
    except ValueError:
        return None


def test_every_table_title_in_sub6_becomes_a_family(sub6):
    fams, m = sub6
    assert m["detection_recall"] == 1.0, m
    assert {f.table_id for f in fams} >= {"295-603-1", "295-605-2", "295-605-5"}
    assert m["rows_with_provenance"] == m["canonical_rows"], "every canonical row has a fragment, page and bbox"


def test_the_14_signed_lb1_lb2_rules_are_reproduced_from_table_295_605_2_and_295_603_1(sub6):
    fams, _ = sub6
    rules = json.loads(RULES.read_text())["rules"]
    checked = 0
    for rule in rules:
        d = rule["district_code"]
        if rule["kind"] == "allowed_use":
            for use, letter in rule["params"]["uses"].items():
                row = find_row(fams, "295-603-1", USE_ROWS[use])
                assert row["cells"][d] == letter, f"{d} {use}: table says {row['cells'][d]!r}, rule says {letter!r}"
                assert row["sources"][0]["page"] in (2, 3)
            checked += 1
            continue
        if rule["kind"] == "min_setback_ft":
            row = find_row(fams, "295-605-2", SETBACK_MIN_ROWS[rule["category"]])
            assert as_number(row["cells"][d]) == rule["params"]["min_ft"], f"{rule['id']}: {row['cells'][d]!r}"
        else:
            table_id, label, param = ROW_FOR_KIND[rule["kind"]]
            row = find_row(fams, table_id, label)
            cell = row["cells"][d]
            if rule["conditions"] and any(c["id"] == "average_front_setback" for c in rule["conditions"]):
                assert cell == "average", f"{rule['id']}: expected the printed 'average', got {cell!r}"
            else:
                assert as_number(cell) == rule["params"][param], f"{rule['id']}: table {cell!r} vs rule {rule['params'][param]}"
        assert row["sources"][0]["page"] == 16 and rule["citations"][0]["page"] == 16 and rule["citations"][0]["printed_page"] == 824
        checked += 1
    assert checked == 14


def test_use_table_headers_unscramble_and_span_pages(sub6):
    fams, _ = sub6
    fam = next(f for f in fams if f.table_id == "295-603-1")
    assert fam.columns == ["NS1", "NS2", "LB1", "LB2", "LB3", "RB1", "RB2", "CS"]
    assert [fr.page for fr in fam.fragments] == [2, 3, 4, 5, 6] and fam.needs_merge_review
    assert all("headers_equal" in fr.signals for fr in fam.fragments[1:])
    assert find_row(fams, "295-603-1", "Multi-family dwelling")["group"] == "RESIDENTIAL USES"
    assert unscramble_many("5 S R -1 S R") == ["RS1", "RS2", "RS3", "RS4", "RS5"] and unscramble_many("S C") == ["CS"]


def test_cells_stay_text(sub6):
    fams, _ = sub6
    row = find_row(fams, "295-605-2", "Front setback, maximum (ft.)")
    assert row["cells"]["LB2"] == "average" and row["cells"]["LB1"] == "70" and row["unit"] == "ft"


@pytest.mark.skipif(not SUB5.exists(), reason="CH295-sub5.pdf lives in data/ (not committed); runs locally")
def test_table_295_505_2_is_one_family_of_four_fragments_with_footnotes_attached():
    fams, m = families_of(SUB5, "fa92de2c8d86f6e448aae129436b455d23dc11d8815a6123e58df11ceb77ae49")
    assert m["detection_recall"] == 1.0, m
    fam = next(f for f in fams if f.table_id == "295-505-2")
    assert [fr.page for fr in fam.fragments] == [14, 15, 16, 17] and fam.needs_merge_review
    assert fam.fragments[1].headers == fam.fragments[0].headers, "page 15 inherits the RS/RT header"
    assert fam.fragments[3].headers == fam.fragments[2].headers, "page 17 inherits the RM/RO header"
    assert {n.marker for n in fam.footnotes} >= {"*", "**", "***", "****"}
    hmin = find_row(fams, "295-505-2", "Height, minimum (ft.)")
    assert hmin["markers"]["RS6"] == "**" and hmin["markers"]["RT4"] == "*" and hmin["markers"]["RM3"] == "*" and hmin["cells"]["RM7"] == "20"
    assert set(hmin["applicable_footnotes"]) == {"*", "**"} and hmin["unattached_markers"] == []
    lot = find_row(fams, "295-505-2", "Lot area per dwelling unit, minimum")
    assert lot["markers"].get("_row") == "***" and "***" in lot["applicable_footnotes"]
    assert lot["cells"]["RT4"] == "1,200" and lot["cells"]["RM3"].startswith("2,400 ea.")
    cov = find_row(fams, "295-505-2", "Lot coverage, minimum interior lot")
    assert cov["cells"]["RS6"] == "*" and cov["cells"]["RM3"] == "*" and cov["cells"]["RM7"] == "20%"
    use = next(f for f in fams if f.table_id == "295-503-1")
    assert set(use.columns) >= {"RS1", "RS5", "RS6", "RT4", "RM3", "RM7", "RO1", "RO2"}
    assert find_row(fams, "295-503-1", "Multi-family dwelling")["cells"]["RS1"] == "N"
    assert m["markers_unattached"] == 0
