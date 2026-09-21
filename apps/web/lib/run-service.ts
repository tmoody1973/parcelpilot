import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auditEvents, calculations, feasibilityRuns, layerSnapshotIdsFor, loadApprovedRules, projects, scenarios, sourceStates, withOrg, computeIntersections } from "@parcelpilot/db";
import { ScenarioInputs, type Coverage, type EvidenceFlags, type Finding, type ParcelFacts as EngineFacts, type PolicyResult } from "@parcelpilot/contracts";
import { evaluate, RULES_ENGINE_VERSION } from "@parcelpilot/rules-engine";
import { checkCitations, finalStatus } from "@parcelpilot/zoning-core";
import { appDb, serviceSql } from "./db.ts";
import type { FeasibilityRun } from "./dto.ts";
import type { OrgContext } from "./tenant.ts";

// "Run this scenario" (03 §4.6, 05 §1–3). In order: copy the scenario, pin the parcel snapshot and the layer
// snapshots, load the approved rules in force today, evaluate (engine), gate the citations, apply the policy,
// then write run + calculations + audit row in one org-scoped transaction and lock. Nothing here computes a
// number or a status: the engine and the policy do; this file only moves data between them and the tables.

const JURISDICTION = "milwaukee-wi";
const IN_SCOPE = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;
const today = () => new Date().toISOString().slice(0, 10); // the only clock in the chain; the engine takes it as input

type RunRow = typeof feasibilityRuns.$inferSelect;
type CalcRow = typeof calculations.$inferSelect;
// What we keep in feasibility_runs.policy_reasons: the policy result plus the inputs a memo needs to explain it.
type StoredResult = PolicyResult & { coverage: Coverage; evidence: EvidenceFlags; analysis_date: string; rules_engine_version: string; parcel_retrieved_at: string | null };

export type RunOutcome = { kind: "run"; run: FeasibilityRun } | { kind: "not_found" } | { kind: "no_parcel"; message: string };

export async function runScenario(ctx: OrgContext, scenarioId: string): Promise<RunOutcome> {
  const db = appDb();
  const sql = serviceSql();

  const found = await withOrg(db, ctx.orgId, async (tx) => {
    const [row] = await tx.select({ scenario: scenarios, project: projects }).from(scenarios).innerJoin(projects, eq(projects.id, scenarios.projectId)).where(eq(scenarios.id, scenarioId));
    return row ?? null;
  });
  if (!found) return { kind: "not_found" };
  const { scenario, project } = found;
  if (!project.parcelTaxkey) return { kind: "no_parcel", message: "project has no parcel yet" };
  const parsed = ScenarioInputs.safeParse(scenario.draftInputs);
  if (!parsed.success) return { kind: "no_parcel", message: "scenario inputs are incomplete: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") };
  const inputs = parsed.data;

  // Parcel facts from the latest stored snapshot + stored intersections (no live City call during a run).
  const [snap] = await sql<{ id: string; lot_area_sqft: number | null; lot_area_suspect: boolean; retrieved_at: string; corner_lot: string | null }[]>`
    select id, lot_area_sqft::float8 as lot_area_sqft, lot_area_suspect, retrieved_at, attributes ->> 'CORNER_LOT' as corner_lot
    from parcel_snapshots where taxkey = ${project.parcelTaxkey} order by retrieved_at desc limit 1`;
  if (!snap) return { kind: "no_parcel", message: "no parcel snapshot for this project; resolve the parcel first" };
  const { summary } = await computeIntersections(sql, snap.id);
  const layerSnapshotIds = await layerSnapshotIdsFor(sql, snap.id);
  const facts: EngineFacts = {
    lot_area_sqft: snap.lot_area_sqft, lot_area_suspect: snap.lot_area_suspect, base_zoning: summary.base_zoning,
    planned_development: summary.planned_development, overlays: summary.overlays, special_districts: summary.special_districts, floodplain: summary.floodplain,
    gis_ambiguity: summary.gis_ambiguity, attributes: { corner_lot: snap.corner_lot },
  };

  const analysisDate = today();
  const rules = await loadApprovedRules(sql, { jurisdictionId: JURISDICTION, districts: summary.base_zoning, date: analysisDate });
  const engine = evaluate({ parcel: facts, scenario: inputs, rules, categories_in_scope: [...IN_SCOPE], analysis_date: analysisDate });

  const shas = [...new Set(rules.flatMap((r) => [...r.citations, ...r.conditions.map((c) => c.citation)]).map((c) => c.document_id))];
  const evidence = checkCitations({ findings: engine.findings, sources: await sourceStates(sql, shas), rules: Object.fromEntries(rules.map((r) => [r.id, { status: r.status }])), analysis_date: analysisDate });
  const policy = finalStatus({
    findings: engine.findings, coverage: engine.coverage, evidence,
    parcel: { overlays: summary.overlays, special_districts: summary.special_districts, planned_development: summary.planned_development, floodplain: summary.floodplain, gis_ambiguity: summary.gis_ambiguity, stacked_condo_candidates: [] },
    decision_mode: "rules_only",
  });

  const ruleVersionSet = Object.fromEntries(rules.map((r) => [r.family_id, r.id]));
  const inputHash = createHash("sha256").update(JSON.stringify({ inputs, parcel_snapshot_id: snap.id, layerSnapshotIds, ruleVersionSet, engine: RULES_ENGINE_VERSION })).digest("hex");
  const stored: StoredResult = { ...policy, coverage: engine.coverage, evidence, analysis_date: analysisDate, rules_engine_version: RULES_ENGINE_VERSION, parcel_retrieved_at: snap.retrieved_at };

  const { run, calcs } = await withOrg(db, ctx.orgId, async (tx) => {
    const now = new Date();
    const [run] = await tx.insert(feasibilityRuns).values({
      orgId: ctx.orgId, projectId: project.id, scenarioId: scenario.id, parcelSnapshotId: snap.id, gisLayerSnapshotIds: layerSnapshotIds,
      inputHash, scenarioInputs: inputs, ruleVersionSet, decisionMode: "rules_only", status: "succeeded",
      finalStatus: policy.final_status, route: policy.route, policyReasons: stored, lockedAt: now, createdBy: ctx.userId,
    }).returning();
    const calcs = await tx.insert(calculations).values(engine.findings.map((f) => ({
      orgId: ctx.orgId, feasibilityRunId: run!.id, ruleCategory: f.category, findingStatus: f.status, criticality: f.criticality,
      proposedValue: f.proposed ?? null, allowedValue: f.allowed ?? null, assumptions: [],
      calculationDetail: { finding: f, calculations: engine.calculations.filter((c) => c.category === f.category) },
      zoningRuleId: f.rule_id ?? null, citationIds: f.citations.flatMap((c) => (c.citation_id ? [c.citation_id] : [])),
      confidence: f.confidence, reviewReason: f.reason ?? null,
    }))).returning();
    await tx.update(scenarios).set({ status: "scored", updatedAt: now }).where(and(eq(scenarios.id, scenario.id), eq(scenarios.status, "draft")));
    await tx.insert(auditEvents).values({ orgId: ctx.orgId, actorUserId: ctx.userId, action: "feasibility_run.locked", entityType: "feasibility_run", entityId: run!.id, afterHash: inputHash, payload: { final_status: policy.final_status, route: policy.route, reasons: policy.reasons } });
    return { run: run!, calcs };
  });
  return { kind: "run", run: runDto(run, calcs) };
}

export async function getRun(ctx: OrgContext, runId: string): Promise<FeasibilityRun | null> {
  return withOrg(appDb(), ctx.orgId, async (tx) => {
    const [run] = await tx.select().from(feasibilityRuns).where(eq(feasibilityRuns.id, runId));
    if (!run) return null;
    const calcs = await tx.select().from(calculations).where(eq(calculations.feasibilityRunId, runId));
    return runDto(run, calcs);
  });
}

export function runDto(run: RunRow, calcs: CalcRow[]): FeasibilityRun {
  const r = (run.policyReasons ?? null) as StoredResult | null;
  const findings = calcs.map((c) => (c.calculationDetail as { finding: Finding }).finding);
  return {
    id: run.id, scenario_id: run.scenarioId, project_id: run.projectId, status: run.status,
    final_status: run.finalStatus, route: run.route, risk: r?.risk ?? null, reasons: r?.reasons ?? [], triggers: r?.triggers ?? [], policy_flags: r?.policy_flags ?? null,
    coverage: r?.coverage ?? { checked: [], manual_review: [], unknown: [] }, evidence: r?.evidence ?? null, findings,
    scenario_inputs: run.scenarioInputs as ScenarioInputs,
    provenance: { parcel_snapshot_id: run.parcelSnapshotId, gis_layer_snapshot_ids: run.gisLayerSnapshotIds, rule_version_set: run.ruleVersionSet as Record<string, string>, input_hash: run.inputHash, analysis_date: r?.analysis_date ?? null, parcel_retrieved_at: r?.parcel_retrieved_at ?? null, rules_engine_version: r?.rules_engine_version ?? null, decision_mode: run.decisionMode },
    created_at: run.createdAt.toISOString(), locked_at: run.lockedAt?.toISOString() ?? null,
  };
}
