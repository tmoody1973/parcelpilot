import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENUMS, FinalStatus, RuleCategory, JevRoute, DecisionMode, DEFAULT_DECISION_MODE } from "./enums.ts";

test("canonical enum values match 00_conventions.md", () => {
  assert.deepEqual(FinalStatus.options, ["proceed_to_concept_design", "revise_scenario", "verify_before_committing", "insufficient_evidence"]);
  assert.deepEqual(RuleCategory.options, ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"]);
  assert.equal(JevRoute.options.length, 6);
  assert.deepEqual(DecisionMode.options, ["rules_only", "structured_output_baseline", "jev", "shadow"]);
  assert.equal(DEFAULT_DECISION_MODE, "rules_only");
  assert.equal(Object.keys(ENUMS).length, 12);
});

test("emitted JSON Schemas exist in both trees and are identical", () => {
  const a = join(import.meta.dirname, "..", "schema");
  const b = join(import.meta.dirname, "..", "..", "..", "services", "worker-py", "app", "schema");
  for (const name of Object.keys(ENUMS)) {
    const fa = readFileSync(join(a, `${name}.schema.json`), "utf8");
    const fb = readFileSync(join(b, `${name}.schema.json`), "utf8");
    assert.equal(fa, fb, `${name} schema drifted between contracts and worker-py; run pnpm contracts:emit`);
    assert.deepEqual(JSON.parse(fa).enum, ENUMS[name as keyof typeof ENUMS].options);
  }
});
