import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GoldCase, ZoningRule, expertLabel, inScoredSet, type DecisionLayerOutput, type JevRisk, type JevRoute, type PolicyFlags } from "@parcelpilot/contracts";
import { goldDecision, goldMemoInput } from "./gold-decision.ts";
import { buildPreparedState } from "./prepared-state.ts";
import { finalStatus } from "./policy.ts";
import { shadowMetrics, unsafePermissive, type ShadowRow } from "./shadow-metrics.ts";
import { renderMemo } from "./memo/render.ts";
import { validateMemo } from "./memo/validate.ts";
import type { MemoBrief } from "./memo/brief-sections.ts";

// MOO-840 (05 §9, 06 M5 exit 1 and 3). JEV's answers are the ones recorded by the last live `pnpm decision:gold`
// (__fixtures__/jev-gold.json), so CI needs no key. Re-record by running decision:gold locally.
const ANALYSIS_DATE = "2026-09-21";
const contracts = join(import.meta.dirname, "..", "..", "contracts");
const RULES = readdirSync(join(contracts, "rules")).filter((f) => f.endsWith(".json"))
  .flatMap((f) => (JSON.parse(readFileSync(join(contracts, "rules", f), "utf8")).rules as unknown[]).map((r) => ZoningRule.parse(r)));
const cases = readdirSync(join(contracts, "gold")).filter((f) => f.endsWith(".json")).sort()
  .map((f) => GoldCase.parse(JSON.parse(readFileSync(join(contracts, "gold", f), "utf8"))));
const knownUses = RULES.filter((r) => r.kind === "allowed_use").flatMap((r) => Object.keys((r.params as { uses?: Record<string, string> }).uses ?? {}));
type Recorded = { status: "ok" | "failed"; route: JevRoute | null; confidence: number | null; risk_bucket: JevRisk | null; error: string | null };
const jev = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "jev-gold.json"), "utf8")).cases as Record<string, Recorded>;
const briefs = new Map((JSON.parse(readFileSync(join(import.meta.dirname, "memo", "__fixtures__", "gold-briefs.json"), "utf8")).cases as { case_id: string; brief: MemoBrief }[]).map((x) => [x.case_id, x.brief]));

// Recordings exist for the cases a live `pnpm decision:gold` has run on. Cases added since (G16–G50, MOO-842) are
// recorded after the gold set is reviewed and frozen (MOO-843); until then they are listed, never silently passed.
const FIRST_RECORDED = Array.from({ length: 15 }, (_, i) => `G${String(i + 1).padStart(2, "0")}`);
// The gate needs only JEV's answer; the per-case memo check also needs the saved brief.
const recorded = cases.filter((c) => jev[c.id] && inScoredSet(c)); // rejected cases are not scored
const unrecorded = cases.filter((c) => !jev[c.id]).map((c) => c.id);
const rows: ShadowRow[] = recorded.map((c) => {
  const d = goldDecision(c, RULES, ANALYSIS_DATE);
  const r = jev[c.id];
  return {
    case_id: c.id, rules_route: d.policy.route as JevRoute, expert_route: expertLabel(c).route as JevRoute, expert_status: expertLabel(c).final_status,
    jev_status: r?.status ?? null, jev_route: r?.route ?? null, jev_confidence: r?.confidence ?? null,
    jev_latency_ms: null, jev_cost_usd: null, brief_outcome: null, brief_cost_usd: null,
  };
});

test("CI gate: JEV is never more lenient than the rules table or the expert on the gold set (unsafe-permissive = 0)", () => {
  for (const id of FIRST_RECORDED) assert.ok(jev[id] && briefs.has(id), `${id} must stay recorded`);
  for (const id of Object.keys(jev)) assert.ok(cases.some((c) => c.id === id), `recorded JEV answer for ${id}, which is not a gold case`);
  if (unrecorded.length) console.log(`not yet recorded (re-run pnpm decision:gold after the MOO-843 freeze): ${unrecorded.join(", ")}`);
  const unsafe = rows.filter(unsafePermissive).map((r) => `${r.case_id}: JEV ${r.jev_route}, rules ${r.rules_route}, expert ${r.expert_route}`);
  assert.deepEqual(unsafe, [], "unsafe-permissive cases");
  assert.equal(shadowMetrics(rows).unsafe_permissive, 0);
});

for (const c of recorded.filter((x) => briefs.has(x.id))) {
  test(`${c.id}: prepared state → shadow JEV → locked status equals rules-only → validated memo`, () => {
    const d = goldDecision(c, RULES, ANALYSIS_DATE);
    // The prepared state JEV is asked about builds from the locked run's facts (no evidence bundle in CI).
    buildPreparedState({ jurisdiction: "milwaukee-wi", parcel: { ...c.parcel, planned_development: [] }, scenario: c.scenario, knownUses,
      findings: d.findings, coverage: d.coverage, evidence: d.evidence, policyFlags: d.policy.policy_flags as PolicyFlags, bundle: null });
    // Shadow mode: JEV's recorded answer is handed to the policy, and the status must not move.
    const r = jev[c.id]!;
    const decision: DecisionLayerOutput | null = r.status === "ok" ? { version: "jev_decision.v1", route: r.route!, risk: r.risk_bucket!, confidence: r.confidence!, manual_review_required: 0 } : null;
    const shadow = finalStatus({ ...d.policyInput, decision_mode: "shadow" }, decision);
    assert.equal(shadow.final_status, d.policy.final_status, "FinalStatus equals the rules-only status");
    assert.equal(shadow.route, d.policy.route);
    const brief = briefs.get(c.id)!;
    const input = goldMemoInput(c, d, ANALYSIS_DATE);
    assert.deepEqual(validateMemo(renderMemo(input, { brief }), input, brief), { passed: true, problems: [] });
  });
}
