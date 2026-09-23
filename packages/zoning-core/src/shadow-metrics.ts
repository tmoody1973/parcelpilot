import type { FinalStatus, JevRoute } from "@parcelpilot/contracts";

// Shadow-mode metrics over the gold set (MOO-840; 05 §9, decision 016). One row per gold case. The CLI report, the
// reviewer page and the CI gate all use this, so they can never disagree about a number.

export type ShadowRow = {
  case_id: string;
  rules_route: JevRoute; // what the rules table decided (the run's route)
  expert_route: JevRoute; expert_status: FinalStatus; // the gold label
  jev_status: "ok" | "failed" | null; jev_route: JevRoute | null; jev_confidence: number | null; jev_error?: string | null;
  jev_latency_ms: number | null; jev_cost_usd: number | null;
  brief_outcome: "validated" | "fallback" | null; brief_cost_usd: number | null;
};

const PROCEED: JevRoute = "proceed_to_concept_design";

// The one metric that blocks merges: JEV says "proceed" where the rules table or the expert says anything else.
// Same rule as the decision_comparisons view (migration 0019).
export const unsafePermissive = (r: ShadowRow) => r.jev_route === PROCEED && (r.rules_route !== PROCEED || r.expert_route !== PROCEED);

export function shadowMetrics(rows: ShadowRow[]) {
  const ok = rows.filter((r) => r.jev_status === "ok");
  const share = (xs: ShadowRow[], f: (r: ShadowRow) => boolean) => (xs.length ? xs.filter(f).length / xs.length : null);
  // High-risk: the expert did not say proceed. Recall: JEV did not say proceed either (answered cases only).
  const highRisk = ok.filter((r) => r.expert_status !== "proceed_to_concept_design");
  const latencies = rows.flatMap((r) => (r.jev_latency_ms === null ? [] : [r.jev_latency_ms])).sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    cases: rows.length,
    jev_ok: ok.length,
    jev_failed: rows.filter((r) => r.jev_status === "failed").length,
    agree_rules_only: share(ok, (r) => r.jev_route === r.rules_route),
    agree_expert: share(ok, (r) => r.jev_route === r.expert_route),
    high_risk_cases: highRisk.length,
    high_risk_recall: share(highRisk, (r) => r.jev_route !== PROCEED),
    unsafe_permissive: rows.filter(unsafePermissive).length,
    p95_jev_latency_ms: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)]! : null,
    jev_cost_per_case_usd: mean(rows.flatMap((r) => (r.jev_cost_usd === null ? [] : [r.jev_cost_usd]))),
    brief_cost_per_case_usd: mean(rows.flatMap((r) => (r.brief_cost_usd === null ? [] : [r.brief_cost_usd]))),
    briefs_validated: rows.filter((r) => r.brief_outcome === "validated").length,
  };
}
export type ShadowMetrics = ReturnType<typeof shadowMetrics>;
