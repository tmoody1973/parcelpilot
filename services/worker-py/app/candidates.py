"""Rule candidates from canonical table rows, by code (04 §10 step 1; MOO-825).

Pure: takes the table families MOO-824 built and returns proposals in the contracts ZoningRule shape (minus the
fields approval fills in). Numbers come only from cells. A cell that is not a plain number ("average",
"see s. …", an asterisk) becomes a RuleCondition with evaluable=false so the engine says verify, never a
silent number. No model is involved anywhere here.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.tables import Family

DESIGN_TABLE = "295-605-2"
USE_TABLE = "295-603-1"
SIGNED_RULES = Path(__file__).parents[3] / "packages" / "contracts" / "rules" / "lb1-lb2-v1.json"

# 05 §1.4 defaults: use and height critical; setbacks and density high.
CRITICALITY = {"use": "critical", "height": "critical", "setback_front": "high", "setback_side": "high", "setback_rear": "high", "density": "high"}

# Table 295-605-2 rows the engine can evaluate, by canonical row_key prefix (labels wrap; keys are stable).
DESIGN_ROWS: dict[str, tuple[str, str, str]] = {  # row_key prefix → (category, kind, param)
    "height_maximum_ft": ("height", "max_height_ft", "max_ft"),
    "height_minimum_ft": ("height", "min_height_ft", "min_ft"),
    "front_setback_minimum_ft": ("setback_front", "min_setback_ft", "min_ft"),
    "front_setback_maximum_ft": ("setback_front", "max_setback_ft", "max_ft"),
    "side_setback_minimum_ft": ("setback_side", "min_setback_ft", "min_ft"),
    "side_setback_maximum_ft": ("setback_side", "max_setback_ft", "max_ft"),
    "rear_setback_minimum_ft": ("setback_rear", "min_setback_ft", "min_ft"),
    "rear_setback_maximum_ft": ("setback_rear", "max_setback_ft", "max_ft"),
    "lot_area_per_dwelling_unit_minimum_sq_ft": ("density", "min_lot_area_per_unit", "sqft_per_unit"),
}
# Scenario use values → Table 295-603-1 row label (docs/rules/lb1-lb2-v1.md: the form's catch-alls map to the retail row).
USE_ROWS = {
    "multifamily": "Multi-family dwelling", "single_family": "Single-family dwelling", "two_family": "Two-family dwelling", "live_work": "Live-work unit",
    "office": "General office", "retail": "Retail establishment, general", "adult_retail": "Adult retail establishment",
    "mixed_use": "Retail establishment, general", "commercial": "Retail establishment, general",
}
USE_LETTERS = {"Y", "L", "S", "N"}
NUMBER = re.compile(r"^-?\d+(?:\.\d+)?$")


@dataclass(frozen=True)
class Cite:
    page: int
    printed_page: int | None
    section: str
    table: str
    excerpt: str


@dataclass
class Candidate:
    district: str
    category: str
    kind: str
    params: dict[str, Any]
    criticality: str
    conditions: list[dict[str, Any]]
    citations: list[Cite]
    table_id: str
    row_key: str  # the row the value came from (the min row when a max cell became a condition)
    extracted: dict[str, str]  # district → raw cell text, exactly as pulled
    notes: list[str] = field(default_factory=list)

    def proposed_rule(self) -> dict[str, Any]:
        return {"district_code": self.district, "category": self.category, "kind": self.kind, "params": self.params, "conditions": self.conditions, "criticality": self.criticality}


def parse_cell(cell: str | None) -> tuple[str, float | str | None]:
    """('number', 45.0) | ('none', None) | ('empty', None) | ('text', 'average'). Commas are thousands separators."""
    s = (cell or "").strip()
    if not s:
        return ("empty", None)
    if s.lower() == "none":
        return ("none", None)
    if NUMBER.match(s.replace(",", "")):
        return ("number", float(s.replace(",", "")))
    return ("text", s)


def _printed(fam: Family, page: int, printed_by_page: dict[int, int | None]) -> int | None:
    return printed_by_page.get(page)


def _row(fam: Family, prefix: str) -> dict[str, Any] | None:
    return next((r for r in fam.canonical_rows if r["row_key"].startswith(prefix)), None)


def _cite_row(fam: Family, row: dict[str, Any], district: str, cell: str, printed_by_page: dict[int, int | None]) -> Cite:
    page = row["sources"][0]["page"]
    return Cite(page, _printed(fam, page, printed_by_page), fam.table_id, f"Table {fam.table_id}", f"{row['label']}: {district} {cell}")


def _nonnumeric_condition(fam: Family, row: dict[str, Any], district: str, cell: str, sha: str, printed_by_page: dict[int, int | None]) -> dict[str, Any]:
    """A cell the engine cannot read as a number forces verify (05 §1.3): the reviewer sees exactly what the page says."""
    is_average = cell.strip().lower() == "average"
    cid = "average_front_setback" if is_average and "front" in row["row_key"] else f"nonnumeric_cell:{row['row_key']}"
    description = (
        f"{district} {row['label'].split(' (see')[0]} is 'average': within 20% of the average front setback of adjacent buildings (295-505-2-b). Needs neighbouring setbacks, which are not a parcel fact yet."
        if is_average else f"{district} {row['label']} reads '{cell}' in Table {fam.table_id}; not a plain number, so a person must read it."
    )
    c = _cite_row(fam, row, district, cell, printed_by_page)
    return {"id": cid, "description": description, "evaluable": False, "effect": {"status": "verify"},
            "citation": {"document_id": sha, "page": c.page, **({"printed_page": c.printed_page} if c.printed_page else {}), "section": c.section, "table": c.table, "excerpt": c.excerpt}}


def design_candidates(fam: Family, district: str, sha: str, printed_by_page: dict[int, int | None]) -> list[Candidate]:
    """Height, setbacks and density for one district from Table 295-605-2's canonical rows."""
    out: list[Candidate] = []
    by_category: dict[str, Candidate] = {}
    pending_conditions: dict[str, list[dict[str, Any]]] = {}
    for prefix, (category, kind, param) in DESIGN_ROWS.items():
        row = _row(fam, prefix)
        if row is None:
            continue
        cell = row["cells"].get(district, "")
        kind_of, value = parse_cell(cell)
        is_min = kind.startswith("min_")
        if kind_of == "number":
            cand = Candidate(district, category, kind, {param: value}, CRITICALITY[category], [], [_cite_row(fam, row, district, cell, printed_by_page)], fam.table_id, row["row_key"], {district: cell})
            out.append(cand)
            if is_min:
                by_category[category] = cand
        elif kind_of == "none":
            if is_min and kind == "min_setback_ft":  # "none" minimum = 0 ft (lb1-lb2-v1 pattern); a "none" maximum or minimum height is simply no rule
                cand = Candidate(district, category, kind, {param: 0}, CRITICALITY[category], [], [_cite_row(fam, row, district, cell, printed_by_page)], fam.table_id, row["row_key"], {district: cell})
                out.append(cand)
                by_category[category] = cand
        elif kind_of == "text":
            cond = _nonnumeric_condition(fam, row, district, cell, sha, printed_by_page)
            if is_min:
                # The minimum itself is not a number: keep the row as a 0 ft floor that always routes to verify.
                cand = Candidate(district, category, kind, {param: 0}, CRITICALITY[category], [cond], [_cite_row(fam, row, district, cell, printed_by_page)], fam.table_id, row["row_key"], {district: cell},
                                 notes=[f"minimum reads '{cell}'; floor set to 0 with a non-evaluable condition"])
                out.append(cand)
                by_category[category] = cand
            else:
                pending_conditions.setdefault(category, []).append(cond)
    # A non-numeric maximum attaches to the category's minimum rule (lb2-front-min carries the 'average' maximum this way).
    for category, conds in pending_conditions.items():
        target = by_category.get(category)
        if target is None:
            continue
        for cond in conds:
            if cond["id"] not in {c["id"] for c in target.conditions}:
                target.conditions.append(cond)
                target.notes.append(f"maximum reads '{cond['citation']['excerpt'].split(': ')[-1]}'; carried as a non-evaluable condition")
    return out


def use_candidate(fam: Family, district: str, sha: str, printed_by_page: dict[int, int | None]) -> Candidate | None:
    """One allowed_use rule per district: the legend letters for the nine scenario uses, with the signed street-classification condition."""
    uses: dict[str, str] = {}
    extracted: dict[str, str] = {}
    by_page: dict[int, list[str]] = {}
    for use, label in USE_ROWS.items():
        row = next((r for r in fam.canonical_rows if r["label"] == label), None)
        if row is None:
            continue
        letter = (row["cells"].get(district) or "").strip()
        if letter not in USE_LETTERS:
            continue
        uses[use] = letter
        extracted[f"{district}:{label}"] = letter
        page = row["sources"][0]["page"]
        line = f"{label}: {district} {letter}"
        if line not in by_page.setdefault(page, []):
            by_page[page].append(line)
    if not uses:
        return None
    cites = [Cite(p, _printed(fam, p, printed_by_page), fam.table_id, f"Table {fam.table_id}", "; ".join(lines)) for p, lines in sorted(by_page.items())]
    signed = json.loads(SIGNED_RULES.read_text())
    street = next(c for r in signed["rules"] if r["kind"] == "allowed_use" for c in r["conditions"] if c["id"] == "street_classification")
    return Candidate(district, "use", "allowed_use", {"uses": uses}, CRITICALITY["use"], [street], cites, fam.table_id, "allowed_use", extracted)


def candidates_for(families: list[Family], districts: list[str], sha: str, printed_by_page: dict[int, int | None]) -> list[Candidate]:
    design = next((f for f in families if f.table_id == DESIGN_TABLE), None)
    use = next((f for f in families if f.table_id == USE_TABLE), None)
    out: list[Candidate] = []
    for d in districts:
        if use is not None:
            c = use_candidate(use, d, sha, printed_by_page)
            if c:
                out.append(c)
        if design is not None:
            out.extend(design_candidates(design, d, sha, printed_by_page))
    return out


def reconcile(cand: Candidate, existing: dict[str, Any] | None) -> str:
    """'new' when no approved rule exists for (district, category, kind); 'match' when params and condition ids agree; else 'differs'."""
    if existing is None:
        return "new"
    same_params = json.loads(json.dumps(existing["params"])) == json.loads(json.dumps(cand.params))
    same_conditions = {c["id"] for c in existing.get("conditions") or []} == {c["id"] for c in cand.conditions}
    return "match" if same_params and same_conditions else "differs"


def family_id(cand: Candidate, existing: dict[str, Any] | None, sha: str) -> str:
    """Reuse the approved rule's family so a change becomes version 2; otherwise <sha12>:<table>:<row_key>:<district>."""
    if existing is not None:
        return str(existing["family_id"])
    return f"{sha[:12]}:{cand.table_id}:{cand.row_key}:{cand.district}"
