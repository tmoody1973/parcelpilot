"""EvidenceBundle JSON Schema (MOO-833): the bundle built for the demo parcel validates in Python too, and a hand-edited
copy carrying a non-active source fails. The schema is emitted from packages/contracts (pnpm contracts:emit)."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator

from app.contracts import schema

BUNDLE = Path(__file__).parents[3] / "docs" / "eval" / "bundles" / "2050114000-G01.json"


def validator() -> Draft202012Validator:
    return Draft202012Validator(schema("EvidenceBundle"))


def test_the_demo_parcel_bundle_validates():
    bundle = json.loads(BUNDLE.read_text())
    assert list(validator().iter_errors(bundle)) == []
    assert bundle["items"] and all(i["status"] == "active" for i in bundle["items"])


def test_a_pending_source_fails_the_schema():
    bundle = json.loads(BUNDLE.read_text())
    edited = copy.deepcopy(bundle)
    edited["items"][0]["status"] = "pending_review"
    errors = [e.message for e in validator().iter_errors(edited)]
    assert any("active" in m for m in errors), errors
