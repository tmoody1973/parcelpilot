import {
  DECISION_POLICY_V1, FINAL_STATUS_PERMISSIVENESS, PolicyInput, type DecisionLayerOutput, type DecisionPolicy, type FinalStatus, type JevRisk, type JevRoute, type PolicyFlags, type PolicyResult,
} from "@parcelpilot/contracts";

// The final-status policy (docs/planning/05_decisioning_design.md §3 and §4.1). A pure function:
// statuses and flags in, one FinalStatus + route + ordered reasons out. Ordered hard overrides set
// a floor; the result is never more permissive than the strictest override that fired.

const rank = (s: FinalStatus) => FINAL_STATUS_PERMISSIVENESS.indexOf(s);
const stricter = (a: FinalStatus, b: FinalStatus): FinalStatus => (rank(b) > rank(a) ? b : a);
const HIGH = new Set(["critical", "high"]);

type Fired = { code: string; floor: FinalStatus };

// Each override, evaluated independently (the property test relies on this list).
export function firedOverrides(input: PolicyInput): Fired[] {
  const { findings, evidence, parcel } = input;
  const fired: Fired[] = [];
  if (!evidence.citation_validator_passed || !evidence.active_code_version) fired.push({ code: "O1:citation_validator_failed", floor: "insufficient_evidence" });
  const missing = findings.filter((f) => f.status === "insufficient_evidence");
  if (missing.length) fired.push({ code: "O2:missing_required_input", floor: missing.some((f) => HIGH.has(f.criticality)) ? "insufficient_evidence" : "verify_before_committing" });
  if (findings.some((f) => f.status === "fail" && HIGH.has(f.criticality))) fired.push({ code: "O3:critical_or_high_fail", floor: "revise_scenario" });
  if (specialDistrict(parcel) || parcel.gis_ambiguity) fired.push({ code: "O4:special_district_or_ambiguity", floor: "verify_before_committing" });
  if (findings.some((f) => f.status === "verify")) fired.push({ code: "O4:finding_verify", floor: "verify_before_committing" });
  if (evidence.conflicting_sources) fired.push({ code: "O4:conflicting_sources", floor: "verify_before_committing" });
  if (findings.some((f) => f.status === "unknown" && HIGH.has(f.criticality))) fired.push({ code: "O5:unknown_critical_category", floor: "verify_before_committing" });
  return fired;
}

const specialDistrict = (p: PolicyInput["parcel"]) => p.overlays.length + p.special_districts.length + p.planned_development.length + p.floodplain.length > 0;

function triggersFor(p: PolicyInput["parcel"]): string[] {
  return [
    ...p.overlays.map((c) => `overlay:${c}`),
    ...p.special_districts.map((c) => `special_district:${c}`),
    ...p.planned_development.map((c) => `planned_development:${c}`),
    ...p.floodplain.map((c) => `floodplain:${c}`),
    ...(p.gis_ambiguity ? ["gis_ambiguity:multiple_base_districts"] : []),
    ...(p.stacked_condo_candidates.length > 1 ? [`stacked_condo:${p.stacked_condo_candidates.length}_candidates`] : []),
  ];
}

// Rules-only decision table (05 §4.1): the state after overrides → (risk, route). The table itself is data in the
// versioned decision policy; the first matching row wins, and the schema guarantees a fallback row per status.
function rulesOnlyRoute(status: FinalStatus, fired: Fired[], parcel: PolicyInput["parcel"], policy: DecisionPolicy = DECISION_POLICY_V1): { risk: JevRisk | null; route: JevRoute } {
  const special = specialDistrict(parcel) || parcel.gis_ambiguity;
  const row = policy.decision_table.find((r) => r.status === status
    && (!r.if_fired || fired.some((f) => f.code.startsWith(`${r.if_fired}:`)))
    && (!r.if_special || special))!;
  return { risk: row.risk, route: row.route };
}

// O6/O7 (05 §3): the decision layer may only make the floor stricter. Stubs until JEV lands (MOO-8xx):
// with no decision, the floor passes through unchanged.
function applyDecisionLayer(floor: FinalStatus, decision: DecisionLayerOutput | null): FinalStatus {
  if (decision === null) return floor; // O8: decision layer unavailable/disabled → rules-only table applies
  return floor; // ponytail: O6/O7 thresholds arrive with the JEV client; a decision can never relax the floor
}

export function finalStatus(raw: PolicyInput, decision: DecisionLayerOutput | null = null): PolicyResult {
  const input = PolicyInput.parse(raw);
  const triggers = triggersFor(input.parcel);
  const policy_flags: PolicyFlags = {
    deterministic_critical_fail: input.findings.some((f) => f.status === "fail" && f.criticality === "critical"), // the flag is critical-only; O3 fires on critical or high (gold G03, G07)
    special_district_detected: specialDistrict(input.parcel),
    missing_required_input: input.findings.some((f) => f.status === "insufficient_evidence"),
    gis_ambiguity: input.parcel.gis_ambiguity || input.parcel.stacked_condo_candidates.length > 1, // an unresolved stacked condo is a GIS ambiguity too (G13)
  };
  // A blocked run never evaluated anything: nothing to override, nothing to route but "pick a unit".
  if (input.pre_run_block) return { final_status: "insufficient_evidence", route: "collect_missing_information", risk: null, reasons: [`pre_run_block:${input.pre_run_block}`], triggers, policy_flags };

  const fired = firedOverrides(input);
  const floor = fired.reduce<FinalStatus>((acc, f) => stricter(acc, f.floor), "proceed_to_concept_design");
  // proceed only when every in-scope category passed; an unknown medium/low category (no rule yet) does
  // not block it but is surfaced in coverage. Anything else with no override → verify.
  const allPass = input.findings.length > 0 && input.findings.every((f) => f.status === "pass" || (f.status === "unknown" && !HIGH.has(f.criticality)));
  const base: FinalStatus = fired.length > 0 ? floor : allPass ? "proceed_to_concept_design" : "verify_before_committing";
  // Only `jev` mode lets a decision reach the status. In rules_only and shadow (MOO-836) JEV is logged, never consulted,
  // whatever the caller passes: the boundary lives here, not in each caller.
  const status = applyDecisionLayer(base, input.decision_mode === "jev" ? decision : null);
  const { risk, route } = rulesOnlyRoute(status, fired, input.parcel);
  // With insufficient evidence the product abstains (05 §7 `abstention`): only the evidence reasons are
  // reported; fail/verify findings are provisional until the evidence is there (gold G09, G15).
  const reasons = (status === "insufficient_evidence" ? fired.filter((f) => f.floor === "insufficient_evidence") : fired).map((f) => f.code);
  return { final_status: status, route, risk, reasons, triggers, policy_flags };
}
