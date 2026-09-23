import { test } from "node:test";
import assert from "node:assert/strict";
import { DECISION_POLICY_V1, type BriefingOutput, type CitedSentence, type EvidenceBundle, type EvidenceItem, type Finding } from "@parcelpilot/contracts";
import { briefingContractHash, buildBriefingContract, type BriefingRunRecord } from "../briefing-contract.ts";
import { validateBrief, type BriefValidation } from "./brief.ts";

// A realistic LB1 contract: use passes, height fails 46 vs 45, parking has no rule.
const SHA = "d".repeat(64);
const item = (n: number, category: string, section: string, reason: string, text: string): EvidenceItem => ({
  source_id: `fam-${n}@1`, chunk_id: `c${n}`, official_url: null, document_title: "Subchapter 6", document_sha256: SHA, section, page: 16, printed_page: 14,
  anchors: [{ page: 16 }], verbatim_excerpt: text, status: "active", category: category as never, subquestion: "q", required_context_type: null,
  selection_reason: reason, rank: n, footnote_markers: [], token_count: 10,
});
const bundle: EvidenceBundle = {
  version: "evidence_bundle.v1", run_id: "r", retrieval_run_ids: ["x"], analysis_date: "2026-09-22", embedding_version_id: null, token_budget: 6000, tokens_used: 20,
  items: [item(1, "height", "295-605-2", "signed-off rule row", "Table 295-605-2. Height, maximum (ft.). LB1: 45."), item(2, "use", "295-603-1", "signed-off rule row", "Table 295-603-1. Multi-family dwelling: Y.")],
  required_context: {}, flags: { active_version_confirmed: true, overlay_detected: false, coverage_gaps: [], dropped_for_budget: 0, refused_inactive: 0 },
};
const f = (category: Finding["category"], status: Finding["status"], extra: Partial<Finding> = {}): Finding =>
  ({ category, status, criticality: "critical", calculation_ids: [], citations: [], missing_inputs: [], confidence: "high", ...extra });
const record = (status: BriefingRunRecord["run"]["final_status"] = "revise_scenario"): BriefingRunRecord => ({
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
const contract = buildBriefingContract(record(), DECISION_POLICY_V1);
const hash = briefingContractHash(contract);
const S = (text: string, kind: CitedSentence["kind"], source_ids: string[] = []): CitedSentence => ({ text, kind, source_ids });
const valid = (): BriefingOutput => ({
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
const run = (v: BriefValidation, name: string) => v.runs.find((r) => r.validator === name)!;

test("a valid brief passes all eleven with nothing removed", () => {
  const v = validateBrief(contract, hash, valid());
  assert.equal(v.outcome, "validated");
  assert.deepEqual(v.runs.map((r) => r.validator), ["schema", "contract_hash", "status_lock", "citation_membership", "uncited_claim", "numeric_alignment", "action_allowlist", "banned_phrases", "finding_coverage", "abstention", "unknown_as_pass"]);
  assert.ok(v.runs.every((r) => r.result === "pass" && r.effect === "none" && r.removed_sentence_ids.length === 0), JSON.stringify(v.runs.filter((r) => r.result !== "pass")));
  assert.deepEqual(v.brief, valid());
});

test("schema: an unparseable brief fails and every other validator is skipped", () => {
  const v = validateBrief(contract, hash, { ...valid(), status_echo: "approved" });
  assert.deepEqual([v.outcome, run(v, "schema").effect, v.runs.filter((r) => r.result === "skipped").length], ["fallback", "brief_failed", 10]);
});

test("contract_hash and status_lock: a brief for another contract or another status is refused", () => {
  assert.equal(run(validateBrief(contract, hash, { ...valid(), contract_hash: "e".repeat(64) }), "contract_hash").effect, "brief_failed");
  const v = validateBrief(contract, hash, { ...valid(), status_echo: "proceed_to_concept_design" });
  assert.deepEqual([v.outcome, run(v, "status_lock").effect], ["fallback", "brief_failed"]);
});

test("citation_membership: one bad citation removes that sentence; more than 10% of sentences fails the brief", () => {
  const one = valid();
  one.open_questions = [S("Which parking rule applies?", "advice", ["fam-99@1"]), S("Who confirms the height datum?", "advice")]; // 1 of 10 sentences: exactly 10%, not over
  const v1 = validateBrief(contract, hash, one);
  assert.deepEqual([run(v1, "citation_membership").effect, run(v1, "citation_membership").removed_sentence_ids, v1.outcome], ["sentence_removed", ["open_questions[0]"], "validated"]);
  const many = valid();
  many.open_questions = [S("a", "advice", ["fam-99@1"]), S("b", "advice", ["fam-98@1"])];
  assert.equal(validateBrief(contract, hash, many).outcome, "fallback", "2 of 10 sentences is over 10%");
  const cased = valid();
  cased.status_explanation = [S("The height finding failed.", "finding", ["FAM-1@1"])];
  assert.equal(run(validateBrief(contract, hash, cased), "citation_membership").result, "pass", "ids compare case-insensitively");
});

test("uncited_claim: an uncited fact is removed; an uncited finding fails the brief", () => {
  const fact = valid();
  fact.open_questions = [S("The lot is on a corner.", "fact")];
  assert.deepEqual([run(validateBrief(contract, hash, fact), "uncited_claim").effect, validateBrief(contract, hash, fact).outcome], ["sentence_removed", "validated"]);
  const finding = valid();
  finding.status_explanation = [S("The height finding failed.", "finding")];
  assert.equal(validateBrief(contract, hash, finding).outcome, "fallback");
});

test("numeric_alignment: a computed number is removed, or fails the brief inside a finding; sections and counts are fine", () => {
  const extra = valid();
  extra.open_questions = [S("The building is 1 ft over and would need 28,800 sq ft of lot.", "advice")];
  const v = validateBrief(contract, hash, extra);
  assert.deepEqual([run(v, "numeric_alignment").effect, run(v, "numeric_alignment").detail["numbers"], v.outcome], ["sentence_removed", ["1", "28800"], "validated"]);
  const inFinding = valid();
  inFinding.verified_findings[1] = { finding_id: "f2", sentences: [S("46 ft is 1 ft over the limit.", "finding", ["fam-1@1"])] };
  assert.equal(validateBrief(contract, hash, inFinding).outcome, "fallback");
  const ok = valid();
  ok.status_explanation = [S("Table 295-605-2 caps height at 45 ft; 2 of the 3 findings are reviewed, on a 7,000 sq ft lot for 24 units.", "finding", ["fam-1@1"])];
  assert.equal(run(validateBrief(contract, hash, ok), "numeric_alignment").result, "pass");
  const declared = valid();
  declared.verified_findings[1] = { finding_id: "f2", sentences: [{ ...S("The proposed height is 46 ft.", "finding", ["fam-1@1"]), numbers: [{ value: "47 ft", calculation_id: "c-height" }] }] };
  assert.equal(validateBrief(contract, hash, declared).outcome, "fallback", "a declared number must match its calculation's display string");
});

test("action_allowlist: an unlisted action is removed; none left while not proceeding fails the brief", () => {
  const one = valid();
  one.suggested_actions = [...one.suggested_actions, { action_id: "hire_a_lawyer", rationale: S("Get legal advice.", "advice") }];
  const v = validateBrief(contract, hash, one);
  assert.deepEqual([run(v, "action_allowlist").effect, v.brief?.suggested_actions.map((a) => a.action_id)], ["action_removed", ["revise_scenario"]]);
  const none = valid();
  none.suggested_actions = [{ action_id: "hire_a_lawyer", rationale: S("Get legal advice.", "advice") }];
  assert.equal(validateBrief(contract, hash, none).outcome, "fallback");
});

test("banned_phrases: removed from the body; in the executive summary the brief fails", () => {
  const body = valid();
  body.open_questions = [S("Is the use permitted by right?", "advice")];
  const v = validateBrief(contract, hash, body);
  assert.deepEqual([run(v, "banned_phrases").effect, v.outcome], ["sentence_removed", "validated"]);
  const summary = valid();
  summary.executive_summary = [S("This project is fully compliant.", "framing")];
  assert.equal(validateBrief(contract, hash, summary).outcome, "fallback");
});

test("finding_coverage: an unknown finding id or an uncovered fail fails the brief", () => {
  const stranger = valid();
  stranger.verified_findings = [...stranger.verified_findings, { finding_id: "f9", sentences: [] }];
  assert.equal(run(validateBrief(contract, hash, stranger), "finding_coverage").effect, "brief_failed");
  const missing = valid();
  missing.verified_findings = missing.verified_findings.filter((v) => v.finding_id !== "f2");
  assert.deepEqual(run(validateBrief(contract, hash, missing), "finding_coverage").detail["uncovered_fails"], ["f2"]);
});

test("abstention: on insufficient evidence, any finding sentence or other action fails the brief", () => {
  const ie = buildBriefingContract(record("insufficient_evidence"), DECISION_POLICY_V1);
  const ieHash = briefingContractHash(ie);
  const good: BriefingOutput = { ...valid(), contract_hash: ieHash, status_echo: "insufficient_evidence",
    status_explanation: [S("The screen gives no preliminary result.", "framing")],
    verified_findings: [{ finding_id: "f2", sentences: [S("The height result is withheld.", "framing")] }],
    suggested_actions: [{ action_id: "collect_missing_information", rationale: S("Provide the missing inputs.", "advice") }] };
  assert.equal(validateBrief(ie, ieHash, good).outcome, "validated");
  const opinion = { ...good, status_explanation: [S("The use passed.", "finding", ["fam-2@1"])] };
  assert.equal(run(validateBrief(ie, ieHash, opinion), "abstention").effect, "brief_failed");
  const action = { ...good, suggested_actions: [{ action_id: "revise_scenario", rationale: S("Revise.", "advice") }] };
  assert.equal(validateBrief(ie, ieHash, action).outcome, "fallback");
});

test("unknown_as_pass: an unchecked category described as a finding fails the brief", () => {
  const b = valid();
  b.status_explanation = [S("Parking passed.", "finding", ["fam-1@1"])];
  assert.equal(run(validateBrief(contract, hash, b), "unknown_as_pass").effect, "brief_failed");
});

test("a validator that throws is a hard failure, never a pass", () => {
  const broken = { ...contract, evidence_bundle: null as never };
  const v = validateBrief(broken, hash, valid());
  assert.equal(v.outcome, "fallback");
  assert.ok(v.runs.some((r) => r.effect === "brief_failed" && typeof r.detail["error"] === "string"));
});

test("numeric_alignment refinement: a number quoted from an excerpt the sentence cites is grounded; the same number uncited is not", () => {
  const quoted = valid();
  quoted.status_explanation = [S("Table 295-605-2 caps LB1 height at 45 ft.", "code", ["fam-1@1"])];
  assert.equal(run(validateBrief(contract, hash, quoted), "numeric_alignment").result, "pass");
  const wrongCite = valid();
  wrongCite.open_questions = [S("The ordinance allows 60 ft in LB2.", "code", ["fam-1@1"])]; // 60 is in no cited excerpt
  assert.deepEqual(run(validateBrief(contract, hash, wrongCite), "numeric_alignment").detail["numbers"], ["60"]);
  const refs = valid();
  refs.open_questions = [S("Parking follows s. 295-403-2 in Chapter 295, subchapter 6.", "advice")];
  assert.equal(run(validateBrief(contract, hash, refs), "numeric_alignment").result, "pass", "section and chapter references are names");
});

test("unknown_as_pass refinement: saying an unchecked category was not checked is fine; claiming it passed fails", () => {
  const notChecked = valid();
  notChecked.status_explanation = [S("Use passed, and parking was not checked; it is unknown, not passed.", "finding", ["fam-2@1"])];
  assert.equal(run(validateBrief(contract, hash, notChecked), "unknown_as_pass").result, "pass");
  const claimed = valid();
  claimed.status_explanation = [S("Height failed, but parking meets the standard.", "finding", ["fam-1@1"])];
  assert.equal(run(validateBrief(contract, hash, claimed), "unknown_as_pass").effect, "brief_failed");
});

test("review follow-ups: a fail finding emptied by earlier removals is uncovered; a pass claim in any sentence kind fails; questions do not", () => {
  const emptied = valid();
  emptied.verified_findings[1] = { finding_id: "f2", sentences: [S("The height is over the limit.", "fact")] }; // uncited fact: removed by uncited_claim
  assert.deepEqual(run(validateBrief(contract, hash, emptied), "finding_coverage").detail["uncovered_fails"], ["f2"]);
  const framed = valid();
  framed.executive_summary = [...framed.executive_summary, S("Parking meets the standard.", "framing")];
  assert.equal(run(validateBrief(contract, hash, framed), "unknown_as_pass").effect, "brief_failed");
  const asked = valid();
  asked.open_questions = [S("Does parking meet the standard for this use?", "advice")];
  assert.equal(run(validateBrief(contract, hash, asked), "unknown_as_pass").result, "pass");
});

test("unknown_as_pass: requirements and questions about an unchecked category are not claims; real claims still fail", () => {
  const notClaims = [
    S("Off-street parking in commercial districts must meet s. 295-403-2, which is not in the reviewed excerpts.", "code", ["fam-1@1"]),
    S("Parking in commercial districts must meet the requirements of s. 295-403-2 and the design standards of s. 295-403-3.", "code", ["fam-1@1"]),
    S("Do the 12 proposed parking spaces meet the requirements of s. 295-403-2? This was not checked.", "framing"),
    S("Can the 12 parking spaces fit on the lot? Check this once the parking requirements are confirmed.", "advice"),
    S("Off-street parking in commercial districts must be provided under s. 295-403-2 and meet the design standards of s. 295-403-3.", "code", ["fam-1@1"]),
  ];
  for (const sentence of notClaims) {
    const b = valid();
    b.open_questions = [sentence];
    assert.equal(run(validateBrief(contract, hash, b), "unknown_as_pass").result, "pass", sentence.text);
  }
  for (const text of ["Parking meets the standard and must still be reviewed by the city.", "Parking meets the standard.", "Height failed, but parking passed.", "The parking spaces satisfy s. 295-403-2."]) { // no number here: numeric_alignment would remove a sentence with one first
    const b = valid();
    b.open_questions = [S(text, "framing")];
    assert.equal(run(validateBrief(contract, hash, b), "unknown_as_pass").effect, "brief_failed", text);
  }
});
