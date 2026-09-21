"""Validate values against the canonical enums emitted from packages/contracts (JSON Schema)."""

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_DIR = Path(__file__).parent / "schema"


@lru_cache(maxsize=None)
def schema(name: str) -> dict:
    return json.loads((SCHEMA_DIR / f"{name}.schema.json").read_text())


def is_valid(name: str, value: object) -> bool:
    return Draft202012Validator(schema(name)).is_valid(value)


def enum_values(name: str) -> list[str]:
    return list(schema(name)["enum"])
