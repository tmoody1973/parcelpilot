import type postgres from "postgres";
import { JEV_QUESTION_SET_VERSION, type DecisionPolicy, type PreparedState } from "@parcelpilot/contracts";
import { BASELINE_PROMPT_VERSION, preparedStateHash, riskBucket, type BaselineCall, type JevCall } from "@parcelpilot/zoning-core";

// One jev_runs row per JEV or baseline call (MOO-836, MOO-844; 05 §4.8, §8), failed calls included: the fallback rate is
// measured from them. Must run in an org-scoped transaction. `used_by_policy` is always false: the table refuses it for
// a shadow-mode row and for any baseline row. A baseline row names its prompt version, which carries the four questions.
export async function recordJevRun(tx: postgres.TransactionSql, i: { orgId: string; runId: string; state: PreparedState; policy: DecisionPolicy } & (
  | { provider: "jev"; decisionMode: "shadow"; call: JevCall }
  | { provider: "baseline"; decisionMode: "structured_output_baseline"; call: BaselineCall }
)): Promise<string> {
  const ok = i.call.status === "ok" ? i.call : null;
  const answers = ok ? { ...ok.response.answers, overall_risk: { ...ok.response.answers.overall_risk, bucket: riskBucket(ok.response.answers.overall_risk.score, i.policy.thresholds) } } : null;
  const [row] = await tx<{ id: string }[]>`
    insert into jev_runs (org_id, feasibility_run_id, provider, decision_mode, input_state, input_state_hash, question_set_version, model_version,
      raw_response, answers, recommended_route, route_confidence, status, error, latency_ms, input_tokens, output_tokens, cost_estimate_usd, used_by_policy)
    values (${i.orgId}, ${i.runId}, ${i.provider}, ${i.decisionMode}, ${tx.json(i.state as never)}, ${preparedStateHash(i.state)}, ${i.provider === "jev" ? JEV_QUESTION_SET_VERSION : BASELINE_PROMPT_VERSION}, ${ok?.response.model ?? null},
      ${i.call.raw === null ? null : tx.json(i.call.raw as never)}, ${answers ? tx.json(answers as never) : null}, ${ok?.response.answers.recommended_route.choice ?? null},
      ${ok?.response.answers.recommended_route.confidence ?? null}, ${i.call.status}, ${i.call.status === "failed" ? i.call.error : null}, ${i.call.latencyMs},
      ${ok?.response.usage.input_tokens ?? null}, ${ok?.response.usage.output_tokens ?? null}, ${ok?.costUsd ?? null}, false)
    returning id`;
  return row!.id;
}
