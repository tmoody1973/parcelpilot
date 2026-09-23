import { RuleCategory, type Coverage, type EvidenceFlags, type Finding, type GoldCase, type ParcelFacts, type PolicyInput, type PolicyResult, type ZoningRule } from "@parcelpilot/contracts";
import { evaluate } from "@parcelpilot/rules-engine";
import { checkCitations } from "./citation-gate.ts";
import { finalStatus } from "./policy.ts";

// A gold case's signed-off decision: the same engine → citation gate → policy chain a live run uses, over the seeded
// rules. gold.test.ts proves this reproduces every case's expected status, route and reasons (it keeps its own copy of
// the recipe on purpose, so the answer key is checked independently). Used by the briefing eval and the memo scan.
export type GoldDecision = { findings: Finding[]; coverage: Coverage; evidence: EvidenceFlags; policy: PolicyResult };

export function goldDecision(c: GoldCase, rules: ZoningRule[], analysisDate: string): GoldDecision {
  const parcel: ParcelFacts = { lot_area_sqft: c.parcel.lot_area_sqft, lot_area_suspect: c.parcel.lot_area_suspect, base_zoning: c.parcel.base_zoning, planned_development: [], overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, attributes: {} };
  const policyParcel: PolicyInput["parcel"] = { overlays: c.parcel.overlays, special_districts: c.parcel.special_districts, planned_development: [], floodplain: c.parcel.floodplain, gis_ambiguity: c.parcel.gis_ambiguity, stacked_condo_candidates: c.parcel.stacked_condo_candidates };
  const blocked = c.expected.pre_run_block;
  const out = blocked
    ? { findings: [] as Finding[], coverage: { checked: [], manual_review: [], unknown: [...RuleCategory.options] } as Coverage }
    : evaluate({ parcel, scenario: c.scenario, rules, categories_in_scope: [...RuleCategory.options], analysis_date: analysisDate });
  const shas = [...new Set(rules.flatMap((r) => [...r.citations, ...r.conditions.map((x) => x.citation)]).map((x) => x.document_id))];
  // G15: the cited source is superseded, so the gate fails closed. Every other case: sources active.
  const sources = Object.fromEntries(shas.map((sha) => [sha, { status: c.expected.evidence.active_code_version ? "active" as const : "superseded" as const, effective_start: null, effective_end: null }]));
  const evidence = checkCitations({ findings: out.findings, sources, rules: Object.fromEntries(rules.map((r) => [r.id, { status: r.status }])), analysis_date: analysisDate });
  const policy = finalStatus({ findings: out.findings, coverage: out.coverage, evidence, parcel: policyParcel, ...(blocked ? { pre_run_block: blocked } : {}), decision_mode: "rules_only" });
  if (policy.final_status !== c.expected.final_status) throw new Error(`${c.id}: policy gave ${policy.final_status}, gold expects ${c.expected.final_status}`);
  return { findings: out.findings, coverage: out.coverage, evidence, policy };
}
