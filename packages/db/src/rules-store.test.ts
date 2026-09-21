import { test } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { loadApprovedRules, sourceStates } from "./rules-store.ts";

// Against the compose DB after `pnpm seed:sources` and `pnpm rules:seed` (CI runs both).
const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
test.after(() => sql.end());

test("LB1 rules load as engine-ready ZoningRule[] with sha256 document ids and citation row ids", async () => {
  const rules = await loadApprovedRules(sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1"], date: "2026-09-21" });
  assert.equal(rules.length, 7, "seven LB1 rules (use, height, front min+max, side, rear, density)");
  for (const r of rules) {
    assert.equal(r.district_code, "LB1");
    assert.ok(r.citations.length >= 1, `${r.family_id} has a citation`);
    for (const c of r.citations) { assert.match(c.document_id, /^[0-9a-f]{64}$/); assert.ok(c.citation_id); assert.ok(c.page > 0); }
  }
  const use = rules.find((r) => r.category === "use")!;
  assert.equal(use.conditions.length, 1);
  assert.equal(use.conditions[0]?.id, "street_classification");
  assert.equal(use.citations.length, 2, "condition citation is not double-counted as a rule citation");
});

test("date and district filters: nothing before the effective date, nothing for an unseeded district", async () => {
  assert.equal((await loadApprovedRules(sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1"], date: "2025-01-01" })).length, 0);
  assert.equal((await loadApprovedRules(sql, { jurisdictionId: "milwaukee-wi", districts: ["RB1"], date: "2026-09-21" })).length, 0);
  assert.equal((await loadApprovedRules(sql, { jurisdictionId: "milwaukee-wi", districts: [], date: "2026-09-21" })).length, 0);
});

test("sources cited by signed rules are active, so the citation gate can pass", async () => {
  const rules = await loadApprovedRules(sql, { jurisdictionId: "milwaukee-wi", districts: ["LB1", "LB2"], date: "2026-09-21" });
  const shas = [...new Set(rules.flatMap((r) => [...r.citations, ...r.conditions.map((c) => c.citation)]).map((c) => c.document_id))];
  const states = await sourceStates(sql, shas);
  assert.equal(Object.keys(states).length, 2, "sub6 and sub5");
  assert.ok(Object.values(states).every((s) => s.status === "active"), JSON.stringify(states));
});
