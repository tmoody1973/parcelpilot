import "server-only";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditEvents, briefRun, calculations, decisionPolicyVersionId, feasibilityRuns, recordJevRun, layerSnapshotIdsFor, loadApprovedRules, projects, scenarios, sourceStates, withOrg, computeIntersections } from "@parcelpilot/db";
import { DECISION_POLICY_V1, ScenarioInputs, type EvidenceBundle, type PolicyFlags, type Coverage, type EvidenceFlags, type Finding, type ParcelFacts as EngineFacts, type PolicyResult } from "@parcelpilot/contracts";
import { evaluate, RULES_ENGINE_VERSION } from "@parcelpilot/rules-engine";
import { askJev, BRIEFING_PROMPT_VERSION, buildPreparedState, checkCitations, DEFAULT_BRIEFING_EFFORT, DEFAULT_BRIEFING_MODEL, finalStatus, resolveDecisionMode, servableDecisionMode, type PreparedStateInput } from "@parcelpilot/zoning-core";
import { attachEvidence, evidenceTokenBudget } from "@parcelpilot/retrieval";
import { appDb, appSql, serviceSql } from "./db.ts";
import type { FeasibilityRun } from "./dto.ts";
import type { OrgContext } from "./tenant.ts";

// "Run this scenario" (03 §4.6, 05 §1–3). In order: copy the scenario, pin the parcel snapshot and the layer
// snapshots, load the reviewed rules in force today, evaluate (engine), gate the citations, apply the policy,
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
  const mode = servableDecisionMode(await resolveDecisionMode()); // rules_only or shadow; a jev/baseline config fails the request

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
    decision_mode: mode, // in shadow, JEV is asked after the run is locked and the policy never consults it
  });

  const policyVersionId = await decisionPolicyVersionId(sql, DECISION_POLICY_V1); // the table finalStatus used above
  const ruleVersionSet = Object.fromEntries(rules.map((r) => [r.family_id, r.id]));
  const inputHash = createHash("sha256").update(JSON.stringify({ inputs, parcel_snapshot_id: snap.id, layerSnapshotIds, ruleVersionSet, engine: RULES_ENGINE_VERSION })).digest("hex");
  const stored: StoredResult = { ...policy, coverage: engine.coverage, evidence, analysis_date: analysisDate, rules_engine_version: RULES_ENGINE_VERSION, parcel_retrieved_at: snap.retrieved_at };

  const { run, calcs } = await withOrg(db, ctx.orgId, async (tx) => {
    const now = new Date();
    const [run] = await tx.insert(feasibilityRuns).values({
      orgId: ctx.orgId, projectId: project.id, scenarioId: scenario.id, parcelSnapshotId: snap.id, gisLayerSnapshotIds: layerSnapshotIds,
      inputHash, scenarioInputs: inputs, ruleVersionSet, decisionMode: mode, status: "succeeded",
      finalStatus: policy.final_status, route: policy.route, policyReasons: stored, lockedAt: now, createdBy: ctx.userId, decisionPolicyVersionId: policyVersionId,
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
  // The run is locked and returned now; evidence, the JEV shadow call and the brief run after the response is sent
  // (MOO-839), in that order, each logging its own failure. Nothing in them can change the run.
  const knownUses = rules.filter((r) => r.kind === "allowed_use").flatMap((r) => Object.keys((r.params as { uses?: Record<string, string> }).uses ?? {}));
  after(async () => {
    const bundle = await freezeEvidence(ctx, { runId: run.id, districts: summary.base_zoning, overlays: summary.overlays, analysisDate, scenario: inputs });
    if (mode === "shadow") {
      await shadowDecision(ctx, run.id, {
        jurisdiction: JURISDICTION, parcel: { ...summary, stacked_condo_candidates: [] }, scenario: inputs, knownUses,
        findings: engine.findings, coverage: engine.coverage, evidence, policyFlags: policy.policy_flags as PolicyFlags, bundle,
      });
    }
    if (bundle) await writeBrief(ctx, run.id);
  });
  return { kind: "run", run: runDto(run, calcs) };
}

// The brief (MOO-837/838): written, validated and repaired at most once, recorded either way. Opt-in with
// BRIEFING_ENABLED=true, since every brief is a paid model call; without it, or without evidence, the memo shows the
// template. A brief only reaches the memo if every validator passed it.
async function writeBrief(ctx: OrgContext, runId: string): Promise<void> {
  if (process.env["BRIEFING_ENABLED"] !== "true" || !process.env["ANTHROPIC_API_KEY"]) return;
  try {
    const system = readFileSync(promptPath(BRIEFING_PROMPT_VERSION), "utf8");
    const result = await appSql().begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ctx.orgId}, true)`;
      // ponytail: the transaction stays open across the model call (~50 s); split load / call / record if pool pressure shows
      return briefRun(tx, runId, { orgId: ctx.orgId, model: process.env["BRIEFING_MODEL"] || DEFAULT_BRIEFING_MODEL, system, effort: DEFAULT_BRIEFING_EFFORT });
    });
    console.info("brief recorded", { runId, outcome: result.outcome, attempts: result.attempts });
  } catch (e) {
    console.error("brief could not be written", { runId, error: e instanceof Error ? e.message : String(e) });
  }
}

// prompts/ lives at the repo root; the web server starts in apps/web (dev) or the repo root (scripts).
function promptPath(version: string): string {
  for (const up of ["", "..", "../.."]) {
    const p = join(process.cwd(), up, "prompts", `${version}.md`);
    if (existsSync(p)) return p;
  }
  throw new Error(`prompt ${version}.md not found from ${process.cwd()}`);
}

// After the run is locked: retrieve for every category in scope and freeze the bundle (MOO-835). Evidence never changes
// the status above, and a failure here never fails the run: attachEvidence records `unavailable`, and if even that write
// fails the run simply has no bundle row, which the memo treats the same way.
async function freezeEvidence(ctx: OrgContext, i: { runId: string; districts: string[]; overlays: string[]; analysisDate: string; scenario: ScenarioInputs }): Promise<EvidenceBundle | null> {
  try {
    const r = await appSql().begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ctx.orgId}, true)`;
      return attachEvidence(tx, { ...i, orgId: ctx.orgId, jurisdictionId: JURISDICTION, categories: IN_SCOPE, tokenBudget: evidenceTokenBudget() });
    });
    return r.status === "assembled" ? r.bundle : null;
  } catch (e) {
    console.error("evidence bundle could not be recorded", { runId: i.runId, error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

// Shadow mode (MOO-836; 05 §4.3): after the run is locked, ask JEV its four questions about the prepared state and log
// the answer. Nothing here can reach the run: its status and route were written above, and the row is locked. A failed
// or slow call is logged as failed; if even the log write fails, the run is still complete.
async function shadowDecision(ctx: OrgContext, runId: string, input: PreparedStateInput): Promise<void> {
  try {
    const state = buildPreparedState(input);
    const call = await askJev(state, { apiKey: process.env["TYPESAFE_API_KEY"], timeoutMs: DECISION_POLICY_V1.thresholds.jev_timeout_ms });
    await appSql().begin(async (tx) => {
      await tx`select set_config('app.org_id', ${ctx.orgId}, true)`;
      await recordJevRun(tx, { orgId: ctx.orgId, runId, decisionMode: "shadow", state, call, policy: DECISION_POLICY_V1 });
    });
  } catch (e) {
    console.error("shadow decision could not be recorded", { runId, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function getRun(ctx: OrgContext, runId: string): Promise<FeasibilityRun | null> {
  return withOrg(appDb(), ctx.orgId, async (tx) => {
    const [run] = await tx.select().from(feasibilityRuns).where(eq(feasibilityRuns.id, runId));
    if (!run) return null;
    const calcs = await tx.select().from(calculations).where(eq(calculations.feasibilityRunId, runId));
    return runDto(run, calcs);
  });
}

// Every run for a scenario (or a whole project), newest first, with its calculations.
export async function listRuns(ctx: OrgContext, by: { scenarioId: string } | { projectId: string }): Promise<FeasibilityRun[]> {
  return withOrg(appDb(), ctx.orgId, async (tx) => {
    const where = "scenarioId" in by ? eq(feasibilityRuns.scenarioId, by.scenarioId) : eq(feasibilityRuns.projectId, by.projectId);
    const runs = await tx.select().from(feasibilityRuns).where(where).orderBy(desc(feasibilityRuns.createdAt));
    if (runs.length === 0) return [];
    const calcs = await tx.select().from(calculations).where(inArray(calculations.feasibilityRunId, runs.map((r) => r.id)));
    return runs.map((r) => runDto(r, calcs.filter((c) => c.feasibilityRunId === r.id)));
  });
}

export function runDto(run: RunRow, calcs: CalcRow[]): FeasibilityRun {
  const r = (run.policyReasons ?? null) as StoredResult | null;
  const order = (c: string) => IN_SCOPE.indexOf(c as (typeof IN_SCOPE)[number]);
  const findings = calcs.map((c) => (c.calculationDetail as { finding: Finding }).finding).sort((a, b) => order(a.category) - order(b.category));
  return {
    id: run.id, scenario_id: run.scenarioId, project_id: run.projectId, status: run.status,
    final_status: run.finalStatus, route: run.route, risk: r?.risk ?? null, reasons: r?.reasons ?? [], triggers: r?.triggers ?? [], policy_flags: r?.policy_flags ?? null,
    coverage: r?.coverage ?? { checked: [], manual_review: [], unknown: [] }, evidence: r?.evidence ?? null, findings,
    scenario_inputs: run.scenarioInputs as ScenarioInputs,
    provenance: { parcel_snapshot_id: run.parcelSnapshotId, gis_layer_snapshot_ids: run.gisLayerSnapshotIds, rule_version_set: run.ruleVersionSet as Record<string, string>, input_hash: run.inputHash, analysis_date: r?.analysis_date ?? null, parcel_retrieved_at: r?.parcel_retrieved_at ?? null, rules_engine_version: r?.rules_engine_version ?? null, decision_mode: run.decisionMode },
    created_at: run.createdAt.toISOString(), locked_at: run.lockedAt?.toISOString() ?? null,
  };
}
