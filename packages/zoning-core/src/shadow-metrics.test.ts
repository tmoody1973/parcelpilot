import { test } from "node:test";
import assert from "node:assert/strict";
import { shadowMetrics, unsafePermissive, type ShadowRow } from "./shadow-metrics.ts";

const row = (o: Partial<ShadowRow>): ShadowRow => ({
  case_id: "G01", rules_route: "revise_scenario", expert_route: "revise_scenario", expert_status: "revise_scenario",
  jev_status: "ok", jev_route: "revise_scenario", jev_confidence: 0.8, jev_latency_ms: 200, jev_cost_usd: 0.0001,
  baseline_status: null, baseline_route: null, baseline_confidence: null, baseline_latency_ms: null, baseline_cost_usd: null,
  brief_outcome: null, brief_cost_usd: null, ...o,
});

test("JEV and the baseline are measured by the same rules, each on its own answers", () => {
  const rows = [
    row({ case_id: "G01", baseline_status: "ok", baseline_route: "proceed_to_concept_design", baseline_confidence: 0.9, baseline_cost_usd: 0.002 }),
    row({ case_id: "G02", rules_route: "contact_city", expert_route: "contact_city", expert_status: "verify_before_committing", jev_route: "contact_city", baseline_status: "ok", baseline_route: "contact_city", baseline_cost_usd: 0.004 }),
    row({ case_id: "G03", baseline_status: "failed", baseline_error: "batch expired" }),
  ];
  assert.deepEqual(rows.map((r) => [unsafePermissive(r, "jev"), unsafePermissive(r, "baseline")]), [[false, true], [false, false], [false, false]]);
  const m = shadowMetrics(rows);
  assert.deepEqual([m.jev.ok, m.jev.failed, m.jev.unsafe_permissive, m.jev.agree_expert], [3, 0, 0, 1]);
  assert.deepEqual([m.baseline.ok, m.baseline.failed, m.baseline.unsafe_permissive, m.baseline.agree_expert, m.baseline.high_risk_cases, m.baseline.high_risk_recall], [2, 1, 1, 0.5, 2, 0.5]);
  assert.ok(Math.abs(m.baseline.cost_per_case_usd! - 0.003) < 1e-12);
});
