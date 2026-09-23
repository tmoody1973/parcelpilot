import { RuleCategory, type CalculationRecord, type Coverage, type EvidenceFlags, type Finding, type GoldCase, type MemoInput, type ParcelFacts, type PolicyInput, type PolicyResult, type ZoningRule } from "@parcelpilot/contracts";
import { evaluate } from "@parcelpilot/rules-engine";
import { checkCitations } from "./citation-gate.ts";
import { finalStatus } from "./policy.ts";

// A gold case's signed-off decision: the same engine → citation gate → policy chain a live run uses, over the seeded
// rules. gold.test.ts proves this reproduces every case's expected status, route and reasons (it keeps its own copy of
// the recipe on purpose, so the answer key is checked independently). Used by the briefing eval and the memo scan.
export type GoldDecision = { policyInput: PolicyInput; findings: Finding[]; calculations: CalculationRecord[]; coverage: Coverage; evidence: EvidenceFlags; policy: PolicyResult };

export function goldDecision(c: GoldCase, rules: ZoningRule[], analysisDate: string): GoldDecision {
  const parcel: ParcelFacts = { lot_area_sqft: c.parcel.lot_area_sqft, lot_area_suspect: c.parcel.lot_area_suspect, base_zoning: c.parcel.base_zoning, planned_development: [], overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, attributes: {} };
  const policyParcel: PolicyInput["parcel"] = { overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, planned_development: [], floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, stacked_condo_candidates: c.parcel.stacked_condo_candidates };
  const blocked = c.expected.pre_run_block;
  const out = blocked
    ? { findings: [] as Finding[], calculations: [] as CalculationRecord[], coverage: { checked: [], manual_review: [], unknown: [...RuleCategory.options] } as Coverage }
    : evaluate({ parcel, scenario: c.scenario, rules, categories_in_scope: [...RuleCategory.options], analysis_date: analysisDate });
  const shas = [...new Set(rules.flatMap((r) => [...r.citations, ...r.conditions.map((x) => x.citation)]).map((x) => x.document_id))];
  // G15: the cited source is superseded, so the gate fails closed. Every other case: sources active.
  const sources = Object.fromEntries(shas.map((sha) => [sha, { status: c.expected.evidence.active_code_version ? "active" as const : "superseded" as const, effective_start: null, effective_end: null }]));
  const evidence = checkCitations({ findings: out.findings, sources, rules: Object.fromEntries(rules.map((r) => [r.id, { status: r.status }])), analysis_date: analysisDate });
  const policyInput: PolicyInput = { findings: out.findings, coverage: out.coverage, evidence, parcel: policyParcel, ...(blocked ? { pre_run_block: blocked } : {}), decision_mode: "rules_only" };
  const policy = finalStatus(policyInput);
  if (policy.final_status !== c.expected.final_status) throw new Error(`${c.id}: policy gave ${policy.final_status}, gold expects ${c.expected.final_status}`);
  return { policyInput, findings: out.findings, calculations: out.calculations, coverage: out.coverage, evidence, policy };
}

// The memo input for a gold case, as a locked run would hand it over (ids fixed for determinism).
export function goldMemoInput(c: GoldCase, d: GoldDecision, analysisDate: string): MemoInput {
  const docs = new Set(d.findings.flatMap((f) => f.citations.map((x) => x.document_id)));
  return {
    version: "memo_input.v1",
    run: { id: `gold-${c.id}`, created_at: "2026-09-21T20:00:00.000Z", locked_at: "2026-09-21T20:00:00.000Z", analysis_date: analysisDate, decision_mode: "rules_only", rules_engine_version: "gold" },
    decision: d.policy, coverage: d.coverage, evidence: d.evidence, findings: d.findings,
    scenario: { name: c.title, inputs: c.scenario },
    parcel: { taxkey: c.parcel.taxkey, address: c.parcel.address, lot_area_sqft: c.parcel.lot_area_sqft, lot_area_suspect: c.parcel.lot_area_suspect, base_zoning: c.parcel.base_zoning, overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, planned_development: [], floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, retrieved_at: null, snapshot_id: `gold-${c.id}` },
    provenance: { gis_layer_snapshot_ids: [], rule_version_set: {}, input_hash: "gold" },
    sources: Object.fromEntries([...docs].map((sha) => [sha, { title: "Milwaukee Code of Ordinances, Chapter 295", published_marker: null, status: "active", official_url: null }])),
    project: { name: c.parcel.address },
  };
}
