import type { FinalStatus, JevRoute } from "@parcelpilot/contracts";

// Shadow-mode metrics over the gold set (MOO-840, MOO-844; 05 §9, decision 016). One row per gold case. The CLI report,
// the reviewer page and the CI gate all use this, so they can never disagree about a number. JEV and the structured-output
// baseline (comparator 2) are measured by the same code against the same rules-only route and expert label.

export type Comparator = "jev" | "baseline";

export type ShadowRow = {
  case_id: string;
  rules_route: JevRoute; // what the rules table decided (the run's route)
  expert_route: JevRoute; expert_status: FinalStatus; // the gold label
  jev_status: "ok" | "failed" | null; jev_route: JevRoute | null; jev_confidence: number | null; jev_error?: string | null;
  jev_latency_ms: number | null; jev_cost_usd: number | null;
  baseline_status: "ok" | "failed" | null; baseline_route: JevRoute | null; baseline_confidence: number | null; baseline_error?: string | null;
  baseline_latency_ms: number | null; baseline_cost_usd: number | null;
  brief_outcome: "validated" | "fallback" | null; brief_cost_usd: number | null;
};

const PROCEED: JevRoute = "proceed_to_concept_design";

// The one metric that blocks merges: JEV says "proceed" where the rules table or the expert says anything else.
// Same rule as the decision_comparisons view (migration 0019). The baseline is measured by the same rule.
export const unsafePermissive = (r: ShadowRow, c: Comparator) => r[`${c}_route`] === PROCEED && (r.rules_route !== PROCEED || r.expert_route !== PROCEED);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function comparatorMetrics(rows: ShadowRow[], c: Comparator) {
  const route = (r: ShadowRow) => r[`${c}_route`];
  const ok = rows.filter((r) => r[`${c}_status`] === "ok");
  const share = (xs: ShadowRow[], f: (r: ShadowRow) => boolean) => (xs.length ? xs.filter(f).length / xs.length : null);
  // High-risk: the expert did not say proceed. Recall: the comparator did not say proceed either (answered cases only).
  const highRisk = ok.filter((r) => r.expert_status !== "proceed_to_concept_design");
  const latencies = rows.flatMap((r) => r[`${c}_latency_ms`] ?? []).sort((a, b) => a - b);
  return {
    ok: ok.length,
    failed: rows.filter((r) => r[`${c}_status`] === "failed").length,
    agree_rules_only: share(ok, (r) => route(r) === r.rules_route),
    agree_expert: share(ok, (r) => route(r) === r.expert_route),
    high_risk_cases: highRisk.length,
    high_risk_recall: share(highRisk, (r) => route(r) !== PROCEED),
    unsafe_permissive: rows.filter((r) => unsafePermissive(r, c)).length,
    p95_latency_ms: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)]! : null,
    cost_per_case_usd: mean(rows.flatMap((r) => r[`${c}_cost_usd`] ?? [])),
  };
}
export type ComparatorMetrics = ReturnType<typeof comparatorMetrics>;

export function shadowMetrics(rows: ShadowRow[]) {
  return {
    cases: rows.length,
    jev: comparatorMetrics(rows, "jev"),
    baseline: comparatorMetrics(rows, "baseline"),
    brief_cost_per_case_usd: mean(rows.flatMap((r) => r.brief_cost_usd ?? [])),
    briefs_validated: rows.filter((r) => r.brief_outcome === "validated").length,
  };
}
export type ShadowMetrics = ReturnType<typeof shadowMetrics>;
