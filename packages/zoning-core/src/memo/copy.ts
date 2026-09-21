// Every fixed sentence in the templated memo (memo.v1). pnpm lint:copy scans this folder: nothing here may
// read as a zoning verdict. Findings, numbers and citations come from the run; this file only frames them.

export const MEMO_VERSION = "memo.v1";
export const DISCLAIMER = "Preliminary zoning screen — not an official zoning determination.";
export const LIMITATIONS = "This screen checks a scenario against a small set of reviewed rules for the parcel's base district. It does not replace a zoning verification letter, a plan review, or advice from a zoning professional. Categories listed as not covered were not checked at all.";

export const STATUS: Record<string, { label: string; meaning: string }> = {
  proceed_to_concept_design: { label: "Proceed to concept design", meaning: "No reviewed check failed and no routing trigger is active for the categories that were checked." },
  revise_scenario: { label: "Revise scenario", meaning: "A reviewed check conflicts with this concept. The proposed and allowed values show what to change." },
  verify_before_committing: { label: "Verify before committing", meaning: "An overlay, district, footnote, uncovered category or missing input needs a professional or the City to confirm before you rely on this." },
  insufficient_evidence: { label: "Insufficient evidence", meaning: "A required input, source, or reviewed rule is missing, so this screen makes no feasibility statement." },
};

export const ROUTE: Record<string, string> = {
  proceed_to_concept_design: "Proceed to concept design, keeping these limitations in the brief.",
  revise_scenario: "Revise the concept where a check failed, then run it again.",
  contact_city: "Contact the Department of City Development about the flagged district or overlay before committing.",
  engage_zoning_professional: "Engage a zoning professional to confirm the items marked verify.",
  collect_missing_information: "Collect the missing information and run again.",
  insufficient_evidence: "Obtain the missing source or reviewed rule before relying on any finding.",
};

export const RISK: Record<string, string> = { low: "low", medium: "medium", high: "high" };

export const CATEGORY: Record<string, string> = {
  use: "Use", height: "Height", setback_front: "Front setback", setback_side: "Side setback", setback_rear: "Rear setback", density: "Density (lot area per unit)", parking: "Parking", lot_coverage: "Lot coverage",
};
export const ALL_CATEGORIES = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;

export const FINDING: Record<string, string> = { pass: "pass", fail: "fail", verify: "verify", insufficient_evidence: "insufficient evidence", unknown: "unknown" };

export const INPUT: Record<string, string> = {
  use: "Primary use", units: "Units", stories: "Stories", height_ft: "Height (ft)", footprint_sqft: "Footprint (sq ft)", setback_front_ft: "Front setback (ft)", setback_side_ft: "Side setback (ft)", setback_rear_ft: "Rear setback (ft)", parking_spaces: "Parking spaces", ground_floor_use: "Ground-floor use", ground_floor_commercial_sqft: "Ground-floor commercial (sq ft)",
};

export function reason(code: string): string {
  const [kind, detail] = code.split(":", 2) as [string, string | undefined];
  switch (kind) {
    case "no_rule": return detail === "use_not_in_v1_rule_set" ? "This use is not in the reviewed use list yet." : "No reviewed rule covers this category yet.";
    case "missing_input": return `Input missing: ${detail?.replaceAll("_", " ") ?? ""}.`;
    case "condition_unevaluable": return `A code footnote applies (${detail?.replaceAll("_", " ") ?? ""}) that this screen cannot evaluate from the parcel record.`;
    case "multiple_districts": return "The parcel sits in more than one base district; the City must confirm which governs.";
    case "use_label": return detail === "L" ? "Listed as a limited use: specific standards apply." : "Listed as a special use: a board permit is required.";
    case "fact_suspect": return "The recorded lot area looks implausible; confirm it before relying on density.";
    case "O1": return "A cited source is not the active version.";
    case "O2": return "A required scenario input is missing.";
    case "O3": return "A critical or high-priority check failed.";
    case "O4": return detail === "special_district_or_ambiguity" ? "An overlay, special district, plan area, floodplain, or district ambiguity affects this parcel." : detail === "conflicting_sources" ? "Two active sources disagree on a rule." : "At least one category needs verification.";
    case "O5": return "A critical category has no reviewed rule yet.";
    case "pre_run_block": return "Several tax keys share this point; one unit must be chosen before a screen can run.";
    default: return code;
  }
}

export function trigger(t: string): string {
  const [kind, code] = t.split(":", 2) as [string, string | undefined];
  const label: Record<string, string> = { overlay: "Overlay zone", special_district: "Special district", planned_development: "Planned development", floodplain: "FEMA floodplain", gis_ambiguity: "Base district ambiguity", stacked_condo: "Stacked condominium" };
  return `${label[kind] ?? kind}: ${(code ?? "").replaceAll("_", " ")}`;
}
