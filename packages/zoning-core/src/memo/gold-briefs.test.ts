import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase, ZoningRule } from "@parcelpilot/contracts";
import { goldDecision, goldMemoInput } from "../gold-decision.ts";
import { renderMemo } from "./render.ts";
import { validateMemo } from "./validate.ts";
import type { MemoBrief } from "./brief-sections.ts";

// MOO-839: all 15 gold cases, each rendered with its validated brief (from the saved Opus 5.5 evaluation,
// `pnpm briefing:fixtures`) and as the template. Every memo must pass the memo validators, which include the banned
// verdict words outside quoted ordinance excerpts. No database, no model call.
const ANALYSIS_DATE = "2026-09-21";
const contracts = join(import.meta.dirname, "..", "..", "..", "contracts");
const RULES = readdirSync(join(contracts, "rules")).filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(join(contracts, "rules", f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r)));
const cases = readdirSync(join(contracts, "gold")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => GoldCase.parse(JSON.parse(readFileSync(join(contracts, "gold", f), "utf8"))));
const briefs = new Map((JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "gold-briefs.json"), "utf8")).cases as { case_id: string; brief: MemoBrief }[]).map((x) => [x.case_id, x.brief]));

const memoInput = (c: GoldCase) => goldMemoInput(c, goldDecision(c, RULES, ANALYSIS_DATE), ANALYSIS_DATE);

test("the fixture has a validated brief for every gold case", () => {
  assert.equal(cases.length, 15);
  assert.deepEqual([...briefs.keys()].sort(), cases.map((c) => c.id));
});

for (const c of cases) {
  test(`${c.id}: the brief memo and the template memo both pass the memo validators`, () => {
    const input = memoInput(c);
    const brief = briefs.get(c.id)!;
    const withBrief = renderMemo(input, { brief });
    assert.ok(withBrief.includes("<h2>Summary</h2>"), "brief sections rendered");
    assert.deepEqual(validateMemo(withBrief, input, brief), { passed: true, problems: [] });
    assert.deepEqual(validateMemo(renderMemo(input, { templateNote: true }), input), { passed: true, problems: [] });
  });
}
