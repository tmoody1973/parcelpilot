import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FINAL_STATUS_PERMISSIVENESS, GoldCase, type Criticality, type Finding, type FindingStatus, type PolicyInput, type RuleCategory } from "@parcelpilot/contracts";
import { checkCitations } from "./citation-gate.ts";
import { finalStatus, firedOverrides } from "./policy.ts";

const rank = (s: string) => FINAL_STATUS_PERMISSIVENESS.indexOf(s as never);
const CATS: RuleCategory[] = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"];
const finding = (category: RuleCategory, status: FindingStatus, criticality: Criticality): Finding =>
  ({ category, status, criticality, calculation_ids: [], citations: [], missing_inputs: [], confidence: status === "pass" || status === "fail" ? "high" : "low" });
const evidenceOk = { citation_validator_passed: true, active_code_version: true, conflicting_sources: false, stale_facts: false, problems: [] };
const parcelClean = { overlays: [], special_districts: [], planned_development: [], floodplain: [], gis_ambiguity: false, stacked_condo_candidates: [] };
const allPass = (): Finding[] => CATS.slice(0, 6).map((c) => finding(c, "pass", c === "use" || c === "height" ? "critical" : "high"));
const state = (over: Partial<PolicyInput> = {}): PolicyInput => ({ findings: allPass(), coverage: { checked: CATS.slice(0, 6), manual_review: [], unknown: [] }, evidence: evidenceOk, parcel: parcelClean, decision_mode: "rules_only", ...over });

test("all pass, nothing fired → proceed_to_concept_design, low risk, no reasons", () => {
  const r = finalStatus(state());
  assert.deepEqual([r.final_status, r.route, r.risk, r.reasons], ["proceed_to_concept_design", "proceed_to_concept_design", "low", []]);
});

test("an unknown medium category (no rule yet) does not block proceed; an unknown critical one forces verify (O5)", () => {
  const ok = finalStatus(state({ findings: [...allPass(), finding("parking", "unknown", "medium")] }));
  assert.equal(ok.final_status, "proceed_to_concept_design");
  const bad = finalStatus(state({ findings: [...allPass().filter((f) => f.category !== "use"), finding("use", "unknown", "critical")] }));
  assert.deepEqual([bad.final_status, bad.route, bad.reasons], ["verify_before_committing", "engage_zoning_professional", ["O5:unknown_critical_category"]]);
});

test("each override alone yields exactly its floor and its route", () => {
  const cases: Array<[string, PolicyInput, string, string]> = [
    ["O1", state({ evidence: { ...evidenceOk, citation_validator_passed: false } }), "insufficient_evidence", "insufficient_evidence"],
    ["O2 critical", state({ findings: [...allPass().filter((f) => f.category !== "height"), finding("height", "insufficient_evidence", "critical")] }), "insufficient_evidence", "collect_missing_information"],
    ["O2 medium", state({ findings: [...allPass(), finding("parking", "insufficient_evidence", "medium")] }), "verify_before_committing", "collect_missing_information"],
    ["O3", state({ findings: [...allPass().filter((f) => f.category !== "height"), finding("height", "fail", "critical")] }), "revise_scenario", "revise_scenario"],
    ["O3 low fail", state({ findings: [...allPass(), finding("parking", "fail", "low")] }), "verify_before_committing", "engage_zoning_professional"],
    ["O4 overlay", state({ parcel: { ...parcelClean, overlays: ["SPROZ"] } }), "verify_before_committing", "contact_city"],
    ["O4 ambiguity", state({ parcel: { ...parcelClean, gis_ambiguity: true } }), "verify_before_committing", "contact_city"],
    ["O4 verify", state({ findings: [...allPass().filter((f) => f.category !== "use"), finding("use", "verify", "critical")] }), "verify_before_committing", "engage_zoning_professional"],
    ["O4 conflicting", state({ evidence: { ...evidenceOk, conflicting_sources: true } }), "verify_before_committing", "engage_zoning_professional"],
    ["pre-run block", state({ findings: [], coverage: { checked: [], manual_review: [], unknown: CATS }, pre_run_block: "stacked_condo_selection" }), "insufficient_evidence", "collect_missing_information"],
  ];
  for (const [name, input, status, route] of cases) {
    const r = finalStatus(input);
    assert.equal(r.final_status, status, `${name} status`);
    assert.equal(r.route, route, `${name} route`);
  }
});

test("a low-criticality fail with everything else passing is not proceed", () => {
  const r = finalStatus(state({ findings: [...allPass(), finding("parking", "fail", "low")] }));
  assert.notEqual(r.final_status, "proceed_to_concept_design");
});

test("the decision layer stub never relaxes the floor", () => {
  const input = state({ findings: [...allPass().filter((f) => f.category !== "height"), finding("height", "fail", "critical")] });
  const withDecision = finalStatus(input, { version: "jev_decision.v1", route: "proceed_to_concept_design", risk: "low", confidence: 0.99, manual_review_required: 0 });
  assert.equal(withDecision.final_status, "revise_scenario");
});

function lcg(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
test("property: final_status is never more permissive than the strictest single override (1,000 states)", () => {
  const rnd = lcg(812);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const STATUSES: FindingStatus[] = ["pass", "fail", "unknown", "verify", "insufficient_evidence"];
  const CRITS: Criticality[] = ["critical", "high", "medium", "low"];
  for (let i = 0; i < 1000; i++) {
    const findings = CATS.filter(() => rnd() < 0.8).map((c) => finding(c, pick(STATUSES), pick(CRITS)));
    const input = state({
      findings,
      evidence: { ...evidenceOk, citation_validator_passed: rnd() > 0.1, active_code_version: rnd() > 0.05, conflicting_sources: rnd() < 0.1 },
      parcel: { ...parcelClean, overlays: rnd() < 0.15 ? ["X"] : [], floodplain: rnd() < 0.1 ? ["AE"] : [], gis_ambiguity: rnd() < 0.1 },
    });
    const r = finalStatus(input);
    const strictest = firedOverrides(input).reduce((m, f) => Math.max(m, rank(f.floor)), 0);
    assert.ok(rank(r.final_status) >= strictest, `state ${i}: ${r.final_status} below floor ${FINAL_STATUS_PERMISSIVENESS[strictest]}`);
    if (r.final_status === "proceed_to_concept_design") {
      assert.equal(r.reasons.length, 0);
      assert.ok(findings.length > 0 && findings.every((f) => f.status === "pass" || (f.status === "unknown" && f.criticality !== "critical" && f.criticality !== "high")));
    }
    assert.deepEqual(finalStatus(structuredClone(input)), r, "idempotent");
  }
});

test("citation gate: settled findings need a page-level citation to an active source and an approved rule", () => {
  const cite = { document_id: "doc1", page: 16, section: "295-605-2" };
  const f: Finding = { ...finding("height", "pass", "critical"), rule_id: "r1", rule_version: 1, citations: [cite] };
  const base = { findings: [f], sources: { doc1: { status: "active" as const, effective_start: "2025-07-15", effective_end: null } }, rules: { r1: { status: "approved" } }, analysis_date: "2026-09-21" };
  assert.equal(checkCitations(base).citation_validator_passed, true);
  assert.deepEqual(checkCitations({ ...base, findings: [{ ...f, citations: [] }] }).problems, ["citation_missing:height"]);
  assert.deepEqual(checkCitations({ ...base, rules: { r1: { status: "unreviewed" } } }).problems, ["rule_not_approved:r1"]);
  const superseded = checkCitations({ ...base, sources: { doc1: { status: "superseded", effective_start: null, effective_end: null } } });
  assert.deepEqual([superseded.citation_validator_passed, superseded.active_code_version, superseded.problems], [false, false, ["source_inactive:doc1"]]);
  const r = finalStatus(state({ findings: [f], evidence: superseded }));
  assert.deepEqual([r.final_status, r.route, r.reasons], ["insufficient_evidence", "insufficient_evidence", ["O1:citation_validator_failed"]]);
});

test("every gold case: final_status, route, reasons, flags, triggers reproduce from expected findings + parcel + evidence", () => {
  const dir = join(import.meta.dirname, "..", "..", "contracts", "gold");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const g = GoldCase.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    const findings = Object.entries(g.expected.findings).map(([c, f]) => finding(c as RuleCategory, f!.status, f!.criticality));
    const input: PolicyInput = {
      findings, coverage: g.expected.coverage,
      evidence: { ...evidenceOk, ...g.expected.evidence },
      parcel: { overlays: g.parcel.overlays, special_districts: g.parcel.special_districts, planned_development: [], floodplain: g.parcel.floodplain, gis_ambiguity: g.parcel.gis_ambiguity, stacked_condo_candidates: g.parcel.stacked_condo_candidates },
      decision_mode: "rules_only",
      ...(g.expected.pre_run_block ? { pre_run_block: g.expected.pre_run_block } : {}),
    };
    const r = finalStatus(input);
    assert.equal(r.final_status, g.expected.final_status, `${g.id} final_status`);
    assert.equal(r.route, g.expected.route, `${g.id} route`);
    assert.deepEqual(r.reasons, g.expected.reasons, `${g.id} reasons`);
    assert.deepEqual(r.policy_flags, g.expected.policy_flags, `${g.id} policy_flags`);
    assert.deepEqual(r.triggers, g.expected.triggers, `${g.id} triggers`);
  }
});

test("property: in shadow mode no JEV answer changes the result (1,000 states × random decisions)", () => {
  const rnd = lcg(836);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const STATUSES: FindingStatus[] = ["pass", "fail", "unknown", "verify", "insufficient_evidence"];
  const CRITS: Criticality[] = ["critical", "high", "medium", "low"];
  const ROUTES = ["proceed_to_concept_design", "revise_scenario", "contact_city", "engage_zoning_professional", "collect_missing_information", "insufficient_evidence"] as const;
  for (let i = 0; i < 1000; i++) {
    const input = state({
      findings: CATS.filter(() => rnd() < 0.8).map((c) => finding(c, pick(STATUSES), pick(CRITS))),
      evidence: { ...evidenceOk, citation_validator_passed: rnd() > 0.1, conflicting_sources: rnd() < 0.1 },
      parcel: { ...parcelClean, overlays: rnd() < 0.15 ? ["X"] : [], gis_ambiguity: rnd() < 0.1 },
    });
    // every tenth decision is the most permissive one JEV could give
    const decision = i % 10 === 0
      ? { version: "jev_decision.v1" as const, route: "proceed_to_concept_design" as const, risk: "low" as const, confidence: 0.99, manual_review_required: 0 }
      : { version: "jev_decision.v1" as const, route: pick(ROUTES), risk: pick(["low", "medium", "high"] as const), confidence: rnd(), manual_review_required: rnd() };
    const rulesOnly = finalStatus({ ...input, decision_mode: "rules_only" });
    assert.deepEqual(finalStatus({ ...input, decision_mode: "shadow" }, decision), rulesOnly, `state ${i}: shadow result differs from rules_only`);
    assert.deepEqual(finalStatus({ ...input, decision_mode: "rules_only" }, decision), rulesOnly, `state ${i}: a decision passed in rules_only mode changed the result`);
  }
});
