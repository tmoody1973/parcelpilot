import type postgres from "postgres";
import { RuleCategory, type BriefingContract, type Coverage, type EvidenceBundle, type Finding, type JevRisk, type JevRoute, type ScenarioInputs } from "@parcelpilot/contracts";
import { BRIEFING_PROMPT_VERSION, BRIEFING_SCHEMA_VERSION, type BriefingCall, type BriefingRunRecord } from "@parcelpilot/zoning-core";

// Briefing I/O (MOO-837). Both functions run in an org-scoped transaction, so RLS decides what a caller can read.
type Q = postgres.TransactionSql;

// Everything a brief may be built from, read back from the stored, locked run: no recomputation.
export async function loadBriefingRecord(tx: Q, runId: string): Promise<BriefingRunRecord | null> {
  const [run] = await tx<{ id: string; locked_at: string | null; final_status: BriefingRunRecord["run"]["final_status"]; route: JevRoute; policy_reasons: { risk: JevRisk | null; reasons: string[]; triggers: string[]; coverage: Coverage }; scenario_inputs: ScenarioInputs; parcel_snapshot_id: string }[]>`
    select id, locked_at::text, final_status, route, policy_reasons, scenario_inputs, parcel_snapshot_id from feasibility_runs where id = ${runId}`;
  if (!run) return null;
  const [parcel] = await tx<{ taxkey: string; address: string | null; lot_area_sqft: number | null; retrieved_at: string | null }[]>`
    select taxkey, address, lot_area_sqft::float8 as lot_area_sqft, retrieved_at::text from parcel_snapshots where id = ${run.parcel_snapshot_id}`;
  // The run's own districts, as retrieval filtered on them when the run locked.
  const [districts] = await tx<{ d: string[] | null }[]>`select filters->'districts' as d from retrieval_runs where feasibility_run_id = ${runId} order by created_at limit 1`;
  const calcs = await tx<{ id: string; finding: Finding }[]>`select id, calculation_detail->'finding' as finding from calculations where feasibility_run_id = ${runId}`;
  const [bundle] = await tx<{ bundle: EvidenceBundle }[]>`select bundle from run_evidence_bundles where feasibility_run_id = ${runId} and status = 'assembled'`;
  const [jev] = await tx<{ route: JevRoute; confidence: number; bucket: "low" | "medium" | "high" }[]>`
    select recommended_route as route, route_confidence::float8 as confidence, answers->'overall_risk'->>'bucket' as bucket
    from jev_runs where feasibility_run_id = ${runId} and provider = 'jev' and status = 'ok' order by created_at desc limit 1`;
  const order = (c: string) => RuleCategory.options.indexOf(c as RuleCategory);
  return {
    run: { id: run.id, locked_at: run.locked_at, final_status: run.final_status, route: run.route, risk: run.policy_reasons.risk, reasons: run.policy_reasons.reasons, triggers: run.policy_reasons.triggers, coverage: run.policy_reasons.coverage },
    parcel: { taxkey: parcel?.taxkey ?? "", address: parcel?.address ?? null, lot_area_sqft: parcel?.lot_area_sqft ?? null, base_zoning: districts?.d ?? [], retrieved_at: parcel?.retrieved_at ?? null },
    scenario: run.scenario_inputs,
    findings: [...calcs].sort((a, b) => order(a.finding.category) - order(b.finding.category)).map((c) => ({ finding: c.finding, calculation_id: c.id })),
    bundle: bundle?.bundle ?? null,
    jev: jev ? { overall_risk: jev.bucket, recommended_route: jev.route, confidence: jev.confidence } : null,
  };
}

// One briefing_runs row per call. Until the validators exist (MOO-838) no brief is `validated`: a schema-valid answer is
// stored with its raw output but recorded as `fallback`, so the templated brief is what users see.
export async function recordBriefingRun(tx: Q, i: { orgId: string; runId: string; contract: BriefingContract; contractHash: string; call: BriefingCall; requestedModel: string }): Promise<string> {
  const c = i.call;
  const error = c.status === "ok" ? "not validated: the briefing validators arrive in MOO-838" : `[requested ${i.requestedModel}] ${c.error}`;
  const [row] = await tx<{ id: string }[]>`
    insert into briefing_runs (org_id, feasibility_run_id, contract, contract_hash, prompt_version, schema_version, model_version, raw_output, validated_output, outcome, error, latency_ms, input_tokens, output_tokens, cost_estimate_usd)
    values (${i.orgId}, ${i.runId}, ${tx.json(i.contract as never)}, ${i.contractHash}, ${BRIEFING_PROMPT_VERSION}, ${BRIEFING_SCHEMA_VERSION}, ${c.model}, /* verbatim from the provider; null when no response came back */
      ${c.raw}, null, 'fallback', ${error}, ${c.latencyMs}, ${c.usage?.input_tokens ?? null}, ${c.usage?.output_tokens ?? null}, ${c.costUsd})
    returning id`;
  return row!.id;
}
