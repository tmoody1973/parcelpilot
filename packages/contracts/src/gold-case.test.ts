import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase } from "./gold-case.ts";
import { FINAL_STATUS_PERMISSIVENESS } from "./enums.ts";

const dir = join(import.meta.dirname, "..", "gold");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const cases = files.map((f) => ({ f, c: GoldCase.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))) }));

test("every gold case (at least 50) parses against the schema", () => {
  assert.ok(cases.length >= 50, `${cases.length} cases`);
  assert.deepEqual(cases.map((x) => x.c.id), files.map((f) => f.replace(".json", "")));
});

test("every pass/fail finding is backed by at least one citation, unless the run is blocked before analysis", () => {
  for (const { c } of cases) {
    if (c.expected.pre_run_block) continue;
    const decided = Object.values(c.expected.findings).some((f) => f.status === "pass" || f.status === "fail");
    if (decided) assert.ok(c.citations.length > 0, `${c.id} has decided findings but no citations`);
  }
});

test("final status is never more permissive than the strictest override implied by the findings", () => {
  const rank = (s: string) => FINAL_STATUS_PERMISSIVENESS.indexOf(s as never);
  for (const { c } of cases) {
    const f = Object.values(c.expected.findings);
    let floor = 0;
    if (f.some((x) => x.status === "fail" && (x.criticality === "critical" || x.criticality === "high"))) floor = Math.max(floor, 1);
    if (f.some((x) => x.status === "verify") || c.expected.policy_flags.special_district_detected || c.expected.policy_flags.gis_ambiguity) floor = Math.max(floor, 2);
    if (f.some((x) => x.status === "insufficient_evidence") || !c.expected.evidence.citation_validator_passed) floor = 3;
    assert.ok(rank(c.expected.final_status) >= floor, `${c.id}: ${c.expected.final_status} is more permissive than floor ${FINAL_STATUS_PERMISSIVENESS[floor]}`);
  }
});

test("no gold case is marked reviewed yet (no reviewer on record)", () => {
  for (const { c } of cases) assert.equal(c.review.status, "unreviewed");
});

test("proceed_to_concept_design only when every checked category passes", () => {
  for (const { c } of cases) {
    if (c.expected.final_status !== "proceed_to_concept_design") continue;
    for (const cat of c.expected.coverage.checked) assert.equal(c.expected.findings[cat]?.status, "pass", `${c.id} ${cat}`);
  }
});
