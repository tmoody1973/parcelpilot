import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import type { MemoInput } from "@parcelpilot/contracts";
import { renderMemo, validateMemo } from "@parcelpilot/zoning-core";
import { appDb, serviceSql } from "./db.ts";
import { getRun } from "./run-service.ts";
import type { OrgContext } from "./tenant.ts";

// Builds the memo input from a locked run (tenant tables under RLS) plus the parcel snapshot and source
// documents it cites (jurisdiction-shared), renders the template, and runs the validators. The memo is a
// pure function of immutable rows, so it is rendered on demand; `contract_hash` identifies the exact input.
export type MemoResult = { html: string; contract_hash: string; validation: { passed: boolean; problems: string[] } };

export async function renderRunMemo(ctx: OrgContext, runId: string): Promise<MemoResult | null> {
  const run = await getRun(ctx, runId);
  if (!run || !run.locked_at) return null;
  const sql = serviceSql();

  const names = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [row] = await tx.select({ scenario: scenarios.name, project: projects.name }).from(scenarios).innerJoin(projects, eq(projects.id, scenarios.projectId)).where(eq(scenarios.id, run.scenario_id));
    return row ?? { scenario: "Scenario", project: "Project" };
  });
  const [snap] = await sql<{ taxkey: string; address: string; lot_area_sqft: number | null; lot_area_suspect: boolean; retrieved_at: string }[]>`
    select taxkey, address, lot_area_sqft::float8 as lot_area_sqft, lot_area_suspect, retrieved_at from parcel_snapshots where id = ${run.provenance.parcel_snapshot_id}`;
  if (!snap) return null;
  const shas = [...new Set(run.findings.flatMap((f) => f.citations.map((c) => c.document_id)))];
  const docs = shas.length ? await sql<{ sha256: string; title: string; published_marker: string | null; status: string; official_url: string | null }[]>`select sha256, title, published_marker, status, official_url from source_documents where sha256 = any(${shas})` : [];

  // Spatial codes for the memo come from the run's triggers (pinned), not a fresh intersection.
  const codes = (kind: string) => run.triggers.filter((t) => t.startsWith(kind + ":")).map((t) => t.slice(kind.length + 1));
  const input: MemoInput = {
    version: "memo_input.v1",
    run: { id: run.id, created_at: run.created_at, locked_at: run.locked_at, analysis_date: run.provenance.analysis_date, decision_mode: run.provenance.decision_mode, rules_engine_version: run.provenance.rules_engine_version },
    decision: { final_status: run.final_status!, route: run.route!, risk: run.risk, reasons: run.reasons, triggers: run.triggers, policy_flags: run.policy_flags ?? { deterministic_critical_fail: false, special_district_detected: false, missing_required_input: false, gis_ambiguity: false } },
    coverage: run.coverage, evidence: run.evidence, findings: run.findings,
    scenario: { name: names.scenario, inputs: run.scenario_inputs },
    parcel: {
      taxkey: snap.taxkey, address: snap.address, lot_area_sqft: snap.lot_area_sqft, lot_area_suspect: snap.lot_area_suspect,
      base_zoning: baseZoningFrom(run), overlays: codes("overlay"), special_districts: codes("special_district"), planned_development: codes("planned_development"), floodplain: codes("floodplain"),
      gis_ambiguity: run.policy_flags?.gis_ambiguity ?? false, retrieved_at: run.provenance.parcel_retrieved_at ?? snap.retrieved_at, snapshot_id: run.provenance.parcel_snapshot_id,
    },
    provenance: { gis_layer_snapshot_ids: run.provenance.gis_layer_snapshot_ids, rule_version_set: run.provenance.rule_version_set, input_hash: run.provenance.input_hash },
    sources: Object.fromEntries(docs.map((d) => [d.sha256, { title: d.title, published_marker: d.published_marker, status: d.status, official_url: d.official_url }])),
    project: { name: names.project },
  };
  const html = renderMemo(input);
  const contract_hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return { html, contract_hash, validation: validateMemo(html, input) };
}

// The district the rules were loaded for is recorded in rule_version_set family slugs (e.g. "lb1-height-max").
function baseZoningFrom(run: { provenance: { rule_version_set: Record<string, string> } }): string[] {
  return [...new Set(Object.keys(run.provenance.rule_version_set).map((fam) => fam.split("-")[0]!.toUpperCase()))].sort();
}
