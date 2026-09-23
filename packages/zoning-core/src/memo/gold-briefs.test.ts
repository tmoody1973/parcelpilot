import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase, ZoningRule } from "@parcelpilot/contracts";
import { goldDecision, goldMemoInput } from "../gold-decision.ts";
import { renderMemo } from "./render.ts";
import { validateMemo } from "./validate.ts";
import type { MemoBrief } from "./brief-sections.ts";

// MOO-839: every gold case with a saved brief, rendered with that validated brief (from the saved Opus 5.5 evaluation,
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

// Briefs exist for the cases a saved evaluation covered (G01–G15). Cases added since are recorded after the MOO-843
// freeze with `pnpm briefing:fixtures`; until then they are listed, never silently passed.
const withBrief = cases.filter((c) => briefs.has(c.id));
test("the fixture has a validated brief for every recorded gold case", () => {
  for (let i = 1; i <= 15; i++) assert.ok(briefs.has(`G${String(i).padStart(2, "0")}`), `G${i} must stay recorded`);
  for (const id of briefs.keys()) assert.ok(cases.some((c) => c.id === id), `saved brief for ${id}, which is not a gold case`);
  const missing = cases.filter((c) => !briefs.has(c.id)).map((c) => c.id);
  if (missing.length) console.log(`no saved brief yet: ${missing.join(", ")}`);
});

for (const c of withBrief) {
  test(`${c.id}: the brief memo and the template memo both pass the memo validators`, () => {
    const input = memoInput(c);
    const brief = briefs.get(c.id)!;
    const withBrief = renderMemo(input, { brief });
    assert.ok(withBrief.includes("<h2>Summary</h2>"), "brief sections rendered");
    assert.deepEqual(validateMemo(withBrief, input, brief), { passed: true, problems: [] });
    assert.deepEqual(validateMemo(renderMemo(input, { templateNote: true }), input), { passed: true, problems: [] });
  });
}

// Cases with no saved brief yet still get the template memo checked: it needs no model call.
for (const c of cases.filter((x) => !briefs.has(x.id))) {
  test(`${c.id}: the template memo passes the memo validators`, () => {
    const input = memoInput(c);
    assert.deepEqual(validateMemo(renderMemo(input, { templateNote: true }), input), { passed: true, problems: [] });
  });
}
