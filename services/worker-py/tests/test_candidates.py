"""Rule candidates from canonical rows (MOO-825): values come only from cells; non-numeric cells become conditions."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.candidates import (
    SIGNED_RULES,
    candidates_for,
    family_id,
    parse_cell,
    reconcile,
)
from app.extract_candidates import validate_proposal
from app.pages import extract_pages
from app.tables import build_families, extract_fragments

SUB6 = Path(__file__).parent / "fixtures" / "CH295-sub6.pdf"
SHA = "198a9062664ed8499838570152f0111392dd126366a4950b0dd3e28f32362f24"


@pytest.fixture(scope="module")
def cands():
    pages = [(r.page_number, r.text) for r in extract_pages(SUB6, ocr=False)]
    fams = build_families(extract_fragments(SUB6, pages), SHA)
    printed = {r.page_number: r.printed_page for r in extract_pages(SUB6, ocr=False)}
    return candidates_for(fams, ["LB1", "LB2", "LB3", "RB1", "RB2"], SHA, printed)


def find(cands, district, category, kind):
    return next(c for c in cands if c.district == district and c.category == category and c.kind == kind)


def test_parse_cell():
    assert parse_cell("1,200") == ("number", 1200.0) and parse_cell("45") == ("number", 45.0)
    assert parse_cell("none") == ("none", None) and parse_cell("") == ("empty", None) and parse_cell(None) == ("empty", None)
    assert parse_cell("average") == ("text", "average") and parse_cell("see s. 295-505-2-b") == ("text", "see s. 295-505-2-b")


def test_every_proposal_validates_against_the_contract(cands):
    assert cands, "no candidates"
    for c in cands:
        assert validate_proposal(c.proposed_rule()) == [], (c.district, c.kind)
        assert c.citations and all(ci.page > 0 and ci.excerpt for ci in c.citations)


def test_lb3_rb1_rb2_dimensional_values_come_from_the_cells(cands):
    assert find(cands, "LB3", "height", "max_height_ft").params == {"max_ft": 75}
    assert find(cands, "LB3", "height", "min_height_ft").params == {"min_ft": 30}
    assert find(cands, "RB1", "height", "max_height_ft").params == {"max_ft": 85}
    assert find(cands, "RB2", "height", "min_height_ft").params == {"min_ft": 24}
    assert not [c for c in cands if c.district == "RB1" and c.kind == "min_height_ft"], "RB1 minimum height is 'none': no rule"
    assert find(cands, "LB3", "density", "min_lot_area_per_unit").params == {"sqft_per_unit": 300}
    assert find(cands, "RB1", "density", "min_lot_area_per_unit").params == {"sqft_per_unit": 1200}
    assert find(cands, "RB2", "density", "min_lot_area_per_unit").params == {"sqft_per_unit": 800}
    assert find(cands, "RB2", "setback_front", "max_setback_ft").params == {"max_ft": 70}
    assert find(cands, "LB3", "setback_side", "min_setback_ft").params == {"min_ft": 0}
    assert not [c for c in cands if c.district == "LB3" and c.kind == "max_setback_ft"], "'none' and 'average' maxima never become a number"
    cite = find(cands, "LB3", "height", "max_height_ft").citations[0]
    assert (cite.page, cite.printed_page, cite.section, cite.excerpt) == (16, 824, "295-605-2", "Height, maximum (ft.): LB3 75")


def test_non_numeric_cells_become_non_evaluable_conditions(cands):
    lb3_front = find(cands, "LB3", "setback_front", "min_setback_ft")
    assert lb3_front.params == {"min_ft": 0}
    assert [c["id"] for c in lb3_front.conditions] == ["average_front_setback"] and lb3_front.conditions[0]["evaluable"] is False
    assert lb3_front.conditions[0]["citation"]["excerpt"].endswith(": LB3 average")
    rb1_front = find(cands, "RB1", "setback_front", "min_setback_ft")
    assert rb1_front.params == {"min_ft": 0} and rb1_front.conditions[0]["id"] == "average_front_setback"
    assert any("reads 'average'" in n for n in rb1_front.notes)
    assert not find(cands, "LB1", "setback_front", "min_setback_ft").conditions, "LB1 front setback has plain numbers"


def test_use_candidates_carry_the_letters_and_the_signed_street_condition(cands):
    lb3 = find(cands, "LB3", "use", "allowed_use")
    assert lb3.params["uses"] == {"multifamily": "L", "single_family": "L", "two_family": "L", "live_work": "L", "office": "Y", "retail": "L", "adult_retail": "N", "mixed_use": "L", "commercial": "L"}
    rb1 = find(cands, "RB1", "use", "allowed_use")
    assert rb1.params["uses"]["adult_retail"] == "S" and rb1.params["uses"]["multifamily"] == "Y"
    signed = json.loads(SIGNED_RULES.read_text())
    street = next(c for r in signed["rules"] if r["kind"] == "allowed_use" for c in r["conditions"])
    assert lb3.conditions == [street]
    assert [c.page for c in lb3.citations] == [2, 3] and lb3.criticality == "critical"


def test_lb1_lb2_reconcile_to_the_signed_rules(cands):
    signed = json.loads(SIGNED_RULES.read_text())["rules"]
    for r in signed:
        cand = find(cands, r["district_code"], r["category"], r["kind"])
        assert reconcile(cand, r) == "match", f"{r['id']}: {cand.params} {[c['id'] for c in cand.conditions]} vs {r['params']} {[c['id'] for c in r['conditions']]}"
        assert family_id(cand, r, SHA) == r["family_id"]
    lb3 = find(cands, "LB3", "height", "max_height_ft")
    assert reconcile(lb3, None) == "new" and family_id(lb3, None, SHA) == "198a9062664e:295-605-2:height_maximum_ft:LB3"
    assert reconcile(lb3, {"family_id": "x", "params": {"max_ft": 60}, "conditions": []}) == "differs"
