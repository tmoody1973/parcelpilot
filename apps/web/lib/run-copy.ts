import type { FeasibilityRun } from "./dto.ts";
import type { BadgeTone } from "../components/ui.tsx";

// User-facing wording for statuses, routes, categories and reason codes (PRD §5.2, 00_conventions.md).
// Nothing here may read as a verdict: pnpm lint:copy scans this folder's consumers, so keep it plain.

export const STATUS_COPY: Record<NonNullable<FeasibilityRun["final_status"]>, { label: string; tone: BadgeTone; meaning: string }> = {
  proceed_to_concept_design: { label: "Proceed to concept design", tone: "ok", meaning: "No reviewed check failed and no routing trigger is active for the categories that were checked. Categories not yet covered are listed below." },
  revise_scenario: { label: "Revise scenario", tone: "danger", meaning: "A reviewed check conflicts with this concept. The proposed and allowed values below show what to change." },
  verify_before_committing: { label: "Verify before committing", tone: "warn", meaning: "Something here needs a professional or the City to confirm before you rely on it: an overlay, a district, a footnote the screen cannot evaluate, or an uncovered category." },
  insufficient_evidence: { label: "Insufficient evidence", tone: "neutral", meaning: "A required input, source, or reviewed rule is missing, so this screen makes no feasibility statement. The next action lists what to collect." },
};

export const ROUTE_COPY: Record<NonNullable<FeasibilityRun["route"]>, string> = {
  proceed_to_concept_design: "Proceed to concept design, keeping the scope caveat in the brief.",
  revise_scenario: "Revise the concept where a check failed, then run it again.",
  contact_city: "Contact the Department of City Development about the flagged district or overlay before committing.",
  engage_zoning_professional: "Engage a zoning professional to confirm the items marked verify.",
  collect_missing_information: "Collect the missing information listed below and run again.",
  insufficient_evidence: "Obtain the missing source or reviewed rule before relying on any finding.",
};

export const RISK_COPY: Record<"low" | "medium" | "high", string> = { low: "low risk", medium: "medium risk", high: "high risk" };

export const CATEGORY_COPY: Record<string, string> = {
  use: "Use", height: "Height", setback_front: "Front setback", setback_side: "Side setback", setback_rear: "Rear setback", density: "Density (lot area per unit)", parking: "Parking", lot_coverage: "Lot coverage",
};
export const ALL_CATEGORIES = ["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"] as const;

export const FINDING_COPY: Record<string, { label: string; tone: BadgeTone }> = {
  pass: { label: "pass", tone: "ok" },
  fail: { label: "fail", tone: "danger" },
  verify: { label: "verify", tone: "warn" },
  insufficient_evidence: { label: "insufficient evidence", tone: "neutral" },
  unknown: { label: "unknown", tone: "neutral" },
};

// Machine reason codes → one plain sentence. Unknown codes fall through as-is so nothing is hidden.
export function reasonCopy(code: string): string {
  const [kind, detail] = code.split(":", 2) as [string, string | undefined];
  switch (kind) {
    case "no_rule": return detail === "use_not_in_v1_rule_set" ? "This use is not in the reviewed use list yet." : "No reviewed rule covers this category yet.";
    case "missing_input": return `Input missing: ${INPUT_COPY[detail ?? ""] ?? detail}.`;
    case "condition_unevaluable": return `A code footnote applies (${detail?.replaceAll("_", " ")}) that this screen cannot evaluate from the parcel record.`;
    case "multiple_districts": return "The parcel sits in more than one base district; the City must confirm which governs.";
    case "use_label": return detail === "L" ? "Listed as a limited use: specific standards apply." : "Listed as a special use: a board permit is required.";
    case "fact_suspect": return "The recorded lot area looks implausible; confirm it before relying on density.";
    case "O1": return "A cited source is not the active version, so findings cannot be relied on.";
    case "O2": return "A required scenario input is missing.";
    case "O3": return "A critical or high-priority check failed.";
    case "O4": return detail === "special_district_or_ambiguity" ? "An overlay, special district, plan area, floodplain, or district ambiguity affects this parcel." : detail === "conflicting_sources" ? "Two active sources disagree on a rule." : "At least one category needs verification.";
    case "O5": return "A critical category has no reviewed rule yet.";
    case "pre_run_block": return "Choose one unit before running: several tax keys share this point.";
    default: return code;
  }
}

export const INPUT_COPY: Record<string, string> = {
  height_ft: "building height (ft)", units: "number of units", setback_front_ft: "front setback (ft)", setback_side_ft: "side setback (ft)", setback_rear_ft: "rear setback (ft)", lot_area_sqft: "lot area (from the parcel record)", stories: "stories", footprint_sqft: "footprint (sq ft)", parking_spaces: "parking spaces",
};

export function triggerCopy(trigger: string): { label: string; detail: string } {
  const [kind, code] = trigger.split(":", 2) as [string, string | undefined];
  const map: Record<string, string> = { overlay: "Overlay zone", special_district: "Special district", planned_development: "Planned development", floodplain: "FEMA floodplain", gis_ambiguity: "Base district ambiguity", stacked_condo: "Stacked condominium" };
  return { label: map[kind] ?? kind, detail: (code ?? "").replaceAll("_", " ") };
}

export function fmtValue(v: { value: number | string; unit?: string | undefined } | undefined): string {
  if (!v) return "—";
  const n = typeof v.value === "number" ? v.value.toLocaleString() : v.value;
  return v.unit ? `${n} ${v.unit}` : n;
}
