import type postgres from "postgres";
import { JEV_QUESTION_SET_VERSION, type DecisionPolicy, type PreparedState } from "@parcelpilot/contracts";
import { preparedStateHash, riskBucket, type JevCall } from "@parcelpilot/zoning-core";

// One jev_runs row per JEV call (MOO-836; 05 §4.8, §8), failed calls included: the fallback rate is measured from them.
// Must run in an org-scoped transaction. In shadow mode `used_by_policy` is false, and the table refuses anything else.
export async function recordJevRun(tx: postgres.TransactionSql, i: {
  orgId: string; runId: string; decisionMode: "shadow"; state: PreparedState; call: JevCall; policy: DecisionPolicy;
}): Promise<string> {
  const ok = i.call.status === "ok" ? i.call : null;
  const answers = ok ? { ...ok.response.answers, overall_risk: { ...ok.response.answers.overall_risk, bucket: riskBucket(ok.response.answers.overall_risk.score, i.policy.thresholds) } } : null;
  const [row] = await tx<{ id: string }[]>`
    insert into jev_runs (org_id, feasibility_run_id, provider, decision_mode, input_state, input_state_hash, question_set_version, model_version,
      raw_response, answers, recommended_route, route_confidence, status, error, latency_ms, input_tokens, output_tokens, cost_estimate_usd, used_by_policy)
    values (${i.orgId}, ${i.runId}, 'jev', ${i.decisionMode}, ${tx.json(i.state as never)}, ${preparedStateHash(i.state)}, ${JEV_QUESTION_SET_VERSION}, ${ok?.response.model ?? null},
      ${i.call.raw === null ? null : tx.json(i.call.raw as never)}, ${answers ? tx.json(answers as never) : null}, ${ok?.response.answers.recommended_route.choice ?? null},
      ${ok?.response.answers.recommended_route.confidence ?? null}, ${i.call.status}, ${i.call.status === "failed" ? i.call.error : null}, ${i.call.latencyMs},
      ${ok?.response.usage.input_tokens ?? null}, ${ok?.response.usage.output_tokens ?? null}, ${ok?.costUsd ?? null}, false)
    returning id`;
  return row!.id;
}
