import { DECISION_POLICY_V1, type BriefingOutput, type CitedSentence, type EvidenceBundle, type EvidenceItem, type Finding } from "@parcelpilot/contracts";
import { briefingContractHash, buildBriefingContract, type BriefingRunRecord } from "../briefing-contract.ts";

// Shared by the brief-validator tests and the citation-support tests.
// A realistic LB1 contract: use passes, height fails 46 vs 45, parking has no rule.
export const SHA = "d".repeat(64);
export const item = (n: number, category: string, section: string, reason: string, text: string): EvidenceItem => ({
  source_id: `fam-${n}@1`, chunk_id: `c${n}`, official_url: null, document_title: "Subchapter 6", document_sha256: SHA, section, page: 16, printed_page: 14,
  anchors: [{ page: 16 }], verbatim_excerpt: text, status: "active", category: category as never, subquestion: "q", required_context_type: null,
  selection_reason: reason, rank: n, footnote_markers: [], token_count: 10,
});
export const bundle: EvidenceBundle = {
  version: "evidence_bundle.v1", run_id: "r", retrieval_run_ids: ["x"], analysis_date: "2026-09-22", embedding_version_id: null, token_budget: 6000, tokens_used: 20,
  items: [item(1, "height", "295-605-2", "signed-off rule row", "Table 295-605-2. Height, maximum (ft.). LB1: 45."), item(2, "use", "295-603-1", "signed-off rule row", "Table 295-603-1. Multi-family dwelling: Y.")],
  required_context: {}, flags: { active_version_confirmed: true, overlay_detected: false, coverage_gaps: [], dropped_for_budget: 0, refused_inactive: 0 },
};
export const f = (category: Finding["category"], status: Finding["status"], extra: Partial<Finding> = {}): Finding =>
  ({ category, status, criticality: "critical", calculation_ids: [], citations: [], missing_inputs: [], confidence: "high", ...extra });
export const record = (status: BriefingRunRecord["run"]["final_status"] = "revise_scenario"): BriefingRunRecord => ({
  run: { id: "run1", locked_at: "2026-09-22", final_status: status, route: status === "insufficient_evidence" ? "collect_missing_information" : "revise_scenario", risk: "high", reasons: [], triggers: [], coverage: { checked: ["use", "height"], manual_review: [], unknown: ["parking"] } },
  parcel: { taxkey: "2050114000", address: "4843 N Green Bay Av", lot_area_sqft: 7000, base_zoning: ["LB1"], retrieved_at: "2026-09-21" },
  scenario: { use: "multifamily", units: 24, height_ft: 46, ground_floor_use: "retail" },
  findings: [
    { finding: f("use", "pass", { proposed: { value: "multifamily", source: "scenario" }, allowed: { value: "Y", operator: "in" } }), calculation_id: "c-use" },
    { finding: f("height", "fail", { proposed: { value: 46, unit: "ft", source: "scenario" }, allowed: { value: 45, unit: "ft", operator: "<=" } }), calculation_id: "c-height" },
    { finding: f("parking", "unknown", { reason: "no_rule", criticality: "medium" }), calculation_id: null },
  ],
  bundle, jev: null,
});
export const contract = buildBriefingContract(record(), DECISION_POLICY_V1);
export const hash = briefingContractHash(contract);
export const S = (text: string, kind: CitedSentence["kind"], source_ids: string[] = []): CitedSentence => ({ text, kind, source_ids });
export const valid = (): BriefingOutput => ({
  contract_hash: hash, status_echo: "revise_scenario",
  executive_summary: [S("The screen status is revise scenario because the building is taller than the district allows.", "framing"), S("Revise the height before concept design.", "advice")],
  status_explanation: [S("The height finding failed; the other reviewed category passed.", "finding", ["fam-1@1"])],
  verified_findings: [
    { finding_id: "f1", sentences: [S("The multifamily use is listed Y in LB1.", "finding", ["fam-2@1"])] },
    { finding_id: "f2", sentences: [S("The proposed height of 46 ft is above the allowed ≤ 45 ft.", "finding", ["fam-1@1"])] },
    { finding_id: "f3", sentences: [S("Parking was not checked; no reviewed rule covers it.", "framing")] },
  ],
  open_questions: [S("Which parking rule applies to this scenario?", "advice")],
  suggested_actions: [{ action_id: "revise_scenario", rationale: S("Lower the building to fit the height limit.", "advice") }],
  questions_for_experts: [{ recipient: "architect", question: S("Can the program fit in a shorter building?", "advice") }],
  disclaimer: contract.required_disclaimer,
});
