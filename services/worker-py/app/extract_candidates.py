"""Write rule candidates from approved table families into the review queue (MOO-825).

Usage: uv run python -m app.extract_candidates --districts LB3,RB1,RB2      (root: pnpm candidates:extract)

For each district: the use rule from Table 295-603-1 and the dimensional rules from Table 295-605-2, as code
extracts them (app/candidates.py). Every candidate cites the row's page (citations.document_page_id set) and
lands in review_tasks. Reconciliation against approved rules for the same (district, category, kind):
  match   → reviewer_status = approved, approved_rule_id, note "matches <family> v<n>", no new version
  differs → unreviewed + task; the reviewer picks, and an approval becomes version 2 of the same family
  new     → unreviewed + task
An open candidate for the same (district, category, kind) is adopted rather than duplicated. Rejected ones are
regenerated. Families whose merge review is not approved are refused by the database trigger (0015).
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any

from app.candidates import candidates_for, family_id, reconcile
from app.contracts import schema
from app.tables import Family, build_families, extract_fragments

V1_DISTRICTS = ["LB1", "LB2", "LB3", "RB1", "RB2"]


def validate_proposal(proposal: dict[str, Any]) -> list[str]:
    """The contracts ZoningRule schema, with placeholders for what approval fills in."""
    from jsonschema import Draft202012Validator

    full = {"id": "pending", "family_id": "pending", "version": 1, "jurisdiction_id": "milwaukee-wi", **proposal,
            "citations": [{"document_id": "pending", "page": 1, "section": ""}], "effective_start": "2025-01-01", "effective_end": None, "status": "approved"}
    return [f"{'/'.join(str(p) for p in e.path) or 'rule'}: {e.message}" for e in Draft202012Validator(schema("ZoningRule")).iter_errors(full)]


def main(argv: list[str]) -> int:
    import psycopg

    districts = V1_DISTRICTS
    for i, a in enumerate(argv):
        if a == "--districts" and i + 1 < len(argv):
            districts = [d.strip().upper() for d in argv[i + 1].split(",") if d.strip()]
    db_url = os.environ.get("DATABASE_SERVICE_URL", "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot")
    started = time.monotonic()
    totals = {"candidates": 0, "matched": 0, "differs": 0, "new": 0, "adopted": 0, "existing": 0, "tasks": 0, "citations": 0, "invalid": 0}

    with psycopg.connect(db_url) as conn:
        [doc] = conn.execute("select id, jurisdiction_id, sha256, local_path from source_documents where title like 'Chapter 295 Subchapter 6%' and status = 'active'").fetchall()
        doc_id, jurisdiction, sha, local_path = doc
        pages = conn.execute("select id, page_number, printed_page, raw_text from document_pages where source_document_id = %s order by page_number", (doc_id,)).fetchall()
        page_ids = {n: pid for pid, n, _, _ in pages}
        printed = {n: pp for _, n, pp, _ in pages}
        tables = {fk: (tid, status) for tid, fk, status in conn.execute("select id, family_key, merge_review_status::text from source_tables where source_document_id = %s", (doc_id,)).fetchall()}
        from pathlib import Path
        pdf = (Path(__file__).parents[3] / local_path).resolve()
        families: list[Family] = build_families(extract_fragments(pdf, [(n, t) for _, n, _, t in pages]), sha)
        approved_families = [f for f in families if tables.get(f.family_key, (None, None))[1] == "approved"]
        skipped = [f.table_id for f in families if f not in approved_families and f.table_id in ("295-603-1", "295-605-2")]
        if skipped:
            print(f"  skipping tables without an approved merge: {skipped}")

        for cand in candidates_for(approved_families, districts, sha, printed):
            proposal = cand.proposed_rule()
            errors = validate_proposal(proposal)
            if errors:
                totals["invalid"] += 1
                print(f"  invalid {cand.district} {cand.category} {cand.kind}: {errors}")
                continue
            totals["candidates"] += 1
            existing = conn.execute(
                "select id, family_id, version, params, conditions from zoning_rules where jurisdiction_id = %s and district_code = %s and category = %s and kind = %s and status = 'approved' order by version desc limit 1",
                (jurisdiction, cand.district, cand.category, cand.kind),
            ).fetchone()
            existing_rule = {"id": existing[0], "family_id": existing[1], "version": existing[2], "params": existing[3], "conditions": existing[4]} if existing else None
            fam_id = family_id(cand, existing_rule, sha)
            verdict = reconcile(cand, existing_rule)
            totals[verdict if verdict != "match" else "matched"] += 1

            # Citations: one row per cited page, keyed like the seed so reruns reuse them.
            citation_ids: list[str] = []
            for c in cand.citations:
                found = conn.execute("select id from citations where source_document_id = %s and page_number = %s and section is not distinct from %s and excerpt = %s", (doc_id, c.page, c.section, c.excerpt)).fetchone()
                if found:
                    citation_ids.append(found[0])
                else:
                    row = conn.execute(
                        "insert into citations (source_document_id, document_page_id, page_number, printed_page, section, anchor, excerpt) values (%s, %s, %s, %s, %s, %s, %s) returning id",
                        (doc_id, page_ids.get(c.page), c.page, c.printed_page, c.section, c.table, c.excerpt),
                    ).fetchone()
                    citation_ids.append(row[0])
                    totals["citations"] += 1

            table_id = tables.get(f"tbl_{cand.table_id.replace('-', '_')}", (None, None))[0]
            status = "approved" if verdict == "match" else "unreviewed"
            note = (f"matches {existing_rule['family_id']} v{existing_rule['version']}" if verdict == "match"
                    else f"differs from {existing_rule['family_id']} v{existing_rule['version']}: params {json.dumps(existing_rule['params'])} → {json.dumps(cand.params)}" if verdict == "differs"
                    else None)
            note = "; ".join(x for x in [note, *cand.notes] if x) or None

            open_same = conn.execute(
                "select id, family_id, proposed_rule from rule_candidates where jurisdiction_id = %s and district_code = %s and category = %s and proposed_rule->>'kind' = %s and reviewer_status in ('unreviewed', 'in_review', 'approved') order by created_at desc limit 1",
                (jurisdiction, cand.district, cand.category, cand.kind),
            ).fetchone()
            if open_same and open_same[2].get("params") == proposal["params"] and {c["id"] for c in open_same[2].get("conditions", [])} == {c["id"] for c in proposal["conditions"]}:
                # Same extraction already in the queue (or already approved): adopt it under the resolved family and reconcile in place.
                cand_id = open_same[0]
                if open_same[1] != fam_id or verdict == "match":
                    conn.execute("update rule_candidates set family_id = %s, reviewer_status = case when reviewer_status = 'approved' then reviewer_status else %s::review_status end, reviewer_notes = coalesce(%s, reviewer_notes), approved_rule_id = coalesce(approved_rule_id, %s), updated_at = now() where id = %s",
                                 (fam_id, status, note, existing_rule["id"] if verdict == "match" else None, cand_id))
                    if verdict == "match":
                        conn.execute("update review_tasks set status = 'approved', reason = %s, resolved_at = now(), updated_at = now() where entity_type = 'rule_candidate' and entity_id = %s and status in ('unreviewed', 'in_review')", (note, cand_id))
                    totals["adopted"] += 1
                else:
                    totals["existing"] += 1
            else:
                row = conn.execute(
                    """insert into rule_candidates (jurisdiction_id, family_id, district_code, category, proposed_rule, extracted_value, source_table_id, row_key, citation_ids, extraction_method, reviewer_status, reviewer_notes, approved_rule_id)
                       values (%s, %s, %s, %s::rule_category, %s, %s, %s, %s, %s, 'table_row', %s::review_status, %s, %s) returning id""",
                    (jurisdiction, fam_id, cand.district, cand.category, json.dumps(proposal), json.dumps(cand.extracted), table_id, cand.row_key, citation_ids, status, note, existing_rule["id"] if verdict == "match" else None),
                ).fetchone()
                cand_id = row[0]
            if status == "unreviewed":
                res = conn.execute(
                    """insert into review_tasks (jurisdiction_id, task_type, entity_type, entity_id, priority, reason)
                       values (%s, 'rule_candidate_review', 'rule_candidate', %s, %s::criticality, %s) on conflict (task_type, entity_type, entity_id) do nothing""",
                    (jurisdiction, cand_id, cand.criticality, f"Candidate {cand.category} rule for {cand.district} extracted by table_row" + (f" · {note}" if note else "")),
                )
                totals["tasks"] += res.rowcount
        conn.commit()
    print(f"candidates: districts={','.join(districts)} {json.dumps(totals)} elapsed={round(time.monotonic() - started, 1)}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
