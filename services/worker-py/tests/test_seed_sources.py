from pathlib import Path

from app.seed_sources import classify, date_stamp_from_text


def test_date_stamp_parses_printed_marker():
    assert date_stamp_from_text("Zoning 295-605-2 ... -823- 7/15/2025") == "7/15/2025"
    assert date_stamp_from_text("no stamp here") is None


def test_classify_maps_each_folder():
    z = classify(Path("data/zoning-code-pdfs/CH295-sub6.pdf"))
    assert z and z.source_type == "ordinance_subchapter" and "Subchapter 6" in z.title and z.upload
    assert z.official_url and z.official_url.endswith("/CH295-sub6.pdf")
    s11 = classify(Path("data/zoning-code-pdfs/CH295-SUB11.pdf"))
    assert s11 and "Subchapter 11" in s11.title
    toc = classify(Path("data/zoning-code-pdfs/CH295table.pdf"))
    assert toc and toc.source_type == "ordinance_table_of_contents"
    plan = classify(Path("data/plans/SEPlan.pdf"))
    assert plan and plan.source_type == "comprehensive_plan" and not plan.upload and plan.official_url is None
    assert classify(Path("data/forms/zoningchange/zonecha1.pdf")).source_type == "procedure_form"
    assert classify(Path("data/incentives/ARCH Program.html")).source_type == "staff_guidance"
    assert classify(Path("data/zoning-code-pdfs/.DS_Store")) is None
