"""Render the approved rules for given districts as a reviewer document in the shape of docs/rules/lb1-lb2-v1.md.

Usage: uv run python -m app.rules_review_doc LB3,RB1,RB2 ../../docs/rules/lb3-rb1-rb2-v1.md
Every row comes from zoning_rules + rule_citations in the database: nothing here is typed by hand.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime
from pathlib import Path

OP = {"max_height_ft": "≤ {max_ft} ft", "min_height_ft": "≥ {min_ft} ft", "min_setback_ft": "≥ {min_ft} ft", "max_setback_ft": "≤ {max_ft} ft", "min_lot_area_per_unit": "≥ {sqft_per_unit:,} sq ft lot area per unit"}


def main(argv: list[str]) -> int:
    import psycopg

    districts = [d.strip().upper() for d in argv[1].split(",")]
    out = Path(argv[2])
    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    with psycopg.connect(db_url) as conn:
        rules = conn.execute(
            """select z.id, z.family_id, z.version, z.district_code, z.category::text, z.kind::text, z.params, z.conditions, z.criticality::text, z.effective_start, u.email, z.approved_at
               from zoning_rules z left join users u on u.id = z.approved_by
               where z.district_code = any(%s) and z.status = 'approved'
                 and z.version = (select max(version) from zoning_rules z2 where z2.family_id = z.family_id and z2.status = 'approved')
               order by z.district_code, z.category, z.kind""",
            (districts,),
        ).fetchall()
        cites = {}
        for rid in [r[0] for r in rules]:
            cites[rid] = conn.execute(
                "select c.page_number, c.printed_page, c.section, c.excerpt, d.sha256, c.document_page_id is not null from rule_citations rc join citations c on c.id = rc.citation_id join source_documents d on d.id = c.source_document_id where rc.zoning_rule_id = %s order by c.page_number",
                (rid,),
            ).fetchall()
        rejected = conn.execute(
            "select c.district_code, c.category::text, c.proposed_rule->>'kind', c.reviewer_notes, u.email from rule_candidates c left join users u on u.id = c.reviewer_id where c.district_code = any(%s) and c.reviewer_status = 'rejected' order by 1, 2",
            (districts,),
        ).fetchall()

    lines = [f"# Queue-born rules, v1: {', '.join(districts)}", "",
             "**Source:** `data/zoning-code-pdfs/CH295-sub6.pdf` (Chapter 295 Subchapter 6, Commercial Districts; date stamp 7/15/2025; sha256 `198a9062664e…`).",
             "**How these rows were made:** code read the canonical rows of Table 295-603-1 and Table 295-605-2 (`services/worker-py/app/candidates.py`), each candidate landed in the review queue with its page citation, and a reviewer signed it off in the app. Every row below is read back from `zoning_rules` by `app/rules_review_doc.py`; nothing is typed by hand.",
             f"**Generated:** {datetime.now(tz=UTC).date().isoformat()}. Reviewer signature at the bottom.", "",
             "\"pdf p.\" is the page in the PDF file; \"printed\" is the number in the page footer. A cell the engine cannot read as a number becomes a *condition* that forces the category to \"verify\".", "",
             "| Family | v | District | Category | Kind | Value | Criticality | Cell text (pdf p. / printed) | Conditions | Signed off by |", "|---|---|---|---|---|---|---|---|---|---|"]
    for rid, fam, ver, dist, cat, kind, params, conds, crit, _eff, email, at in rules:
        value = OP.get(kind, "{}").format(**params) if kind != "allowed_use" else ", ".join(f"{k} {v}" for k, v in params["uses"].items())
        cell = "<br>".join(f"\"{ex}\" (p. {p} / {pp or '?'}){'' if has_page else ' ⚠ no page link'}" for p, pp, _sec, ex, _sha, has_page in cites[rid])
        cond = "<br>".join(f"`{c['id']}`{'' if c.get('evaluable') else ' (not evaluable → verify)'}" for c in conds) or "none"
        lines.append(f"| `{fam}` | {ver} | {dist} | {cat} | {kind} | {value} | {crit} | {cell} | {cond} | {email or '?'} {at.date().isoformat() if at else ''} |")
    lines += ["", "## Rejected candidates (kept so nobody assumes they were checked)", ""]
    lines += [f"- {d} {cat} {kind}: {note or 'no reason recorded'} ({email or '?'})" for d, cat, kind, note, email in rejected] or ["- none"]
    lines += ["", "## Not modelled in v1", "", "Side-street setback maximum (needs a corner-lot fact), glazing and build-out percentages, permanent supportive housing and transitional housing lot-area rows, sign table 295-605-5, conversion rule 295-605-2-h, height exemptions in 295-605-2-f.", "",
              "## Reviewer sign-off", "", "Interim reviewer (product owner, per MOO-795): ______ Date: ______ (signed on Linear MOO-825)", ""]
    out.write_text("\n".join(lines))
    print(f"wrote {out} ({len(rules)} rules, {len(rejected)} rejected)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
