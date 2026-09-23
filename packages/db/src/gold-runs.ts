import { createHash } from "node:crypto";
import type postgres from "postgres";
import { DECISION_POLICY_V1, expertLabel, type GoldCase, type ScenarioInputs, type ZoningRule } from "@parcelpilot/contracts";
import type { GoldDecision, ShadowRow } from "@parcelpilot/zoning-core";
import { decisionPolicyVersionId } from "./decision-policy.ts";

// Gold cases as real locked runs (MOO-840, decision 016). Each case is locked from the shared gold recipe
// (goldDecision: engine → citation gate → policy) instead of runScenario, because the gold set fixes facts a live
// parcel lookup cannot reproduce (G11/G12/G14 overrides, G13 blocked before a run, G15 superseded source). Everything
// after the lock (evidence, JEV shadow, brief, memo) is the live code path.
//
// Isolation: the runs belong to one internal org, and each case's parcel is a snapshot under its own taxkey
// (GOLD-G01…), so no synthetic fact ever becomes "the latest snapshot" of a real parcel.

export const GOLD_ORG = { clerkOrgId: "parcelpilot-gold", slug: "parcelpilot-gold", name: "ParcelPilot gold set" } as const;
export const goldTaxkey = (caseId: string) => `GOLD-${caseId}`;

export async function goldOrgId(service: postgres.Sql): Promise<string> {
  const [row] = await service<{ id: string }[]>`
    insert into organizations (name, slug, clerk_org_id) values (${GOLD_ORG.name}, ${GOLD_ORG.slug}, ${GOLD_ORG.clerkOrgId})
    on conflict (slug) do update set name = excluded.name returning id`;
  return row!.id;
}

// Jurisdiction-shared rows (service connection): the case's own parcel and a snapshot of its facts.
export async function goldSnapshot(service: postgres.Sql, c: GoldCase, jurisdictionId: string): Promise<string> {
  const taxkey = goldTaxkey(c.id);
  await service`insert into parcels (taxkey, jurisdiction_id) values (${taxkey}, ${jurisdictionId}) on conflict do nothing`;
  const facts = { case: c.id, source_taxkey: c.parcel.taxkey, ...c.parcel };
  const hash = "gold-" + createHash("sha256").update(JSON.stringify(facts)).digest("hex");
  const [existing] = await service<{ id: string }[]>`select id from parcel_snapshots where taxkey = ${taxkey} and content_hash = ${hash} limit 1`;
  if (existing) return existing.id;
  const [row] = await service<{ id: string }[]>`
    insert into parcel_snapshots (taxkey, geometry, attributes, address, zoning, lot_area_sqft, lot_area_suspect, source_layer, retrieved_at, content_hash)
    values (${taxkey}, ST_Multi(ST_SetSRID(ST_GeomFromText('POLYGON((0 0,0 1,1 1,1 0,0 0))'), 4326)), ${service.json(facts as never)}, ${c.parcel.address},
      ${c.parcel.base_zoning.join(",")}, ${c.parcel.lot_area_sqft}, ${c.parcel.lot_area_suspect}, 'gold-case', now(),
      ${hash})
    returning id`;
  return row!.id;
}

// Tenant rows, in an org-scoped transaction (app role, RLS): project, scenario, the locked run with its gold label,
// and one calculation row per finding, exactly as runScenario writes them.
export async function lockGoldRun(tx: postgres.TransactionSql, i: {
  orgId: string; c: GoldCase; decision: GoldDecision; rules: ZoningRule[]; snapshotId: string; analysisDate: string; engineVersion: string;
}): Promise<string> {
  const { c, decision: d } = i;
  const [project] = await tx<{ id: string }[]>`insert into projects (org_id, parcel_taxkey, name) values (${i.orgId}, ${goldTaxkey(c.id)}, ${`Gold ${c.id}`}) returning id`;
  const inputs = c.scenario as ScenarioInputs;
  const [scenario] = await tx<{ id: string }[]>`insert into scenarios (org_id, project_id, name, draft_inputs, status) values (${i.orgId}, ${project!.id}, ${c.title}, ${tx.json(inputs as never)}, 'scored') returning id`;
  const ruleVersionSet = Object.fromEntries(i.rules.map((r) => [r.family_id, r.id]));
  const inputHash = createHash("sha256").update(JSON.stringify({ case: c.id, version: c.version, inputs, ruleVersionSet, engine: i.engineVersion })).digest("hex");
  const stored = { ...d.policy, coverage: d.coverage, evidence: d.evidence, analysis_date: i.analysisDate, rules_engine_version: i.engineVersion, parcel_retrieved_at: null };
  const policyVersionId = await decisionPolicyVersionId(tx, DECISION_POLICY_V1);
  const [run] = await tx<{ id: string }[]>`
    insert into feasibility_runs (org_id, project_id, scenario_id, parcel_snapshot_id, gis_layer_snapshot_ids, input_hash, scenario_inputs, rule_version_set,
      decision_mode, status, final_status, route, policy_reasons, locked_at, decision_policy_version_id,
      gold_case_id, gold_case_version, gold_expected_status, gold_expected_route)
    values (${i.orgId}, ${project!.id}, ${scenario!.id}, ${i.snapshotId}, '{}', ${inputHash}, ${tx.json(inputs as never)}, ${tx.json(ruleVersionSet)},
      'shadow', 'succeeded', ${d.policy.final_status}, ${d.policy.route}, ${tx.json(stored as never)}, now(), ${policyVersionId},
      ${c.id}, ${c.version}, ${expertLabel(c).final_status}, ${expertLabel(c).route}) -- the reviewer's label where they changed it
    returning id`;
  for (const f of d.findings) {
    // ponytail: gold rule ids are slugs (lb1-use-v1), not zoning_rules uuids, so zoning_rule_id stays null; the slug is in the finding
    await tx`insert into calculations (org_id, feasibility_run_id, rule_category, finding_status, criticality, proposed_value, allowed_value, assumptions,
        calculation_detail, zoning_rule_id, citation_ids, confidence, review_reason)
      values (${i.orgId}, ${run!.id}, ${f.category}, ${f.status}, ${f.criticality}, ${f.proposed ? tx.json(f.proposed as never) : null}, ${f.allowed ? tx.json(f.allowed as never) : null}, '[]',
        ${tx.json({ finding: f, calculations: d.calculations.filter((x) => x.category === f.category) } as never)}, null,
        ${f.citations.flatMap((x) => (x.citation_id ? [x.citation_id] : []))}, ${f.confidence}, ${f.reason ?? null})`;
  }
  return run!.id;
}

// The latest shadow comparison per gold case, with its JEV call and brief (the reviewer page and decision:gold).
// Runs in a transaction scoped to the gold org, so RLS still applies: nothing outside the gold org can come back.
export type GoldComparison = ShadowRow & { run_id: string; locked_at: string };
export async function goldComparisons(tx: postgres.TransactionSql, runIds?: string[]): Promise<GoldComparison[]> {
  return tx<GoldComparison[]>`
    select distinct on (c.gold_case_id)
      c.feasibility_run_id as run_id, c.created_at::text as locked_at, c.gold_case_id as case_id, c.rules_only_route as rules_route,
      c.expert_route, c.gold_expected_status as expert_status, c.jev_status, c.jev_route, c.jev_confidence::float8 as jev_confidence,
      j.error as jev_error, j.latency_ms as jev_latency_ms, j.cost_estimate_usd::float8 as jev_cost_usd,
      b.outcome as brief_outcome, b.cost as brief_cost_usd
    from decision_comparisons c
    left join jev_runs j on j.id = c.jev_run_id
    left join lateral (
      select (array_agg(outcome order by created_at desc))[1] as outcome, sum(cost_estimate_usd)::float8 as cost
      from briefing_runs where feasibility_run_id = c.feasibility_run_id) b on true
    where c.gold_case_id is not null ${runIds ? tx`and c.feasibility_run_id = any(${runIds})` : tx``}
    order by c.gold_case_id, c.created_at desc`;
}

export async function goldOrgIdIfExists(service: postgres.Sql): Promise<string | null> {
  const [row] = await service<{ id: string }[]>`select id from organizations where slug = ${GOLD_ORG.slug}`;
  return row?.id ?? null;
}
