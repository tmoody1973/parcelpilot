import { createHash } from "node:crypto";
import {
  canonicalJson, PreparedState, type Coverage, type EvidenceBundle, type EvidenceFlags, type Finding, type PolicyFlags, type ScenarioInputs,
} from "@parcelpilot/contracts";

// The JEV prepared state (05 §4.4): a small projection of a locked run. Statuses, booleans, codes and category names
// only. The scenario's own words never enter: `use` passes only when it is a use the signed-off rules list, and every
// other string is reduced to a code. The schema is strict, so nothing else can slip in.

export type PreparedStateInput = {
  jurisdiction: string;
  parcel: { base_zoning: string[]; overlays: string[]; special_districts: string[]; planned_development: string[]; floodplain: string[]; gis_ambiguity: boolean; stacked_condo_candidates?: string[] };
  scenario: Pick<ScenarioInputs, "use" | "ground_floor_use" | "ground_floor_commercial_sqft">;
  knownUses: readonly string[]; // keys of the approved allowed_use rules' use lists
  findings: Finding[];
  coverage: Coverage;
  evidence: EvidenceFlags;
  policyFlags: PolicyFlags;
  bundle: EvidenceBundle | null; // null when the run's evidence is unavailable
};

// GIS and engine codes are already machine vocabulary; this only guards against a stray space or a long value.
const code = (s: string) => s.replace(/[^A-Za-z0-9_:.\-]+/g, "_").slice(0, 64) || "unknown";
const codes = (xs: readonly string[]) => [...new Set(xs.map(code))];

export function buildPreparedState(i: PreparedStateInput): PreparedState {
  const b = i.bundle;
  const slots = b ? Object.values(b.required_context) : [];
  const overlays = codes([...i.parcel.overlays, ...i.parcel.floodplain]);
  const overlayDetected = overlays.length > 0 || (b?.flags.overlay_detected ?? false);
  return PreparedState.parse({
    version: "prepared_state.v1",
    jurisdiction: code(i.jurisdiction),
    parcel: {
      base_zoning: i.parcel.base_zoning[0] ? code(i.parcel.base_zoning[0]) : null,
      additional_zoning_districts: codes(i.parcel.base_zoning.slice(1)),
      overlays,
      special_districts: codes(i.parcel.special_districts),
      planned_development: codes(i.parcel.planned_development),
      gis_ambiguities: [
        ...(i.parcel.gis_ambiguity ? ["multiple_base_districts"] : []),
        ...((i.parcel.stacked_condo_candidates?.length ?? 0) > 1 ? ["stacked_condo_unit_not_selected"] : []),
      ],
    },
    scenario: {
      use: i.knownUses.includes(i.scenario.use) ? code(i.scenario.use) : "other",
      has_ground_floor_commercial: i.scenario.ground_floor_use === "retail" || (i.scenario.ground_floor_commercial_sqft ?? 0) > 0,
      missing_fields: codes(i.findings.flatMap((f) => f.missing_inputs)),
    },
    deterministic_findings: i.findings.map((f) => ({
      category: f.category, status: f.status, criticality: f.criticality, confidence: f.confidence,
      citation_count: f.citations.length, reason: f.reason ? code(f.reason) : null,
    })),
    evidence: {
      district_verified: i.parcel.base_zoning.length === 1 && !i.parcel.gis_ambiguity,
      active_code_version: i.evidence.active_code_version,
      citation_validator_passed: i.evidence.citation_validator_passed,
      evidence_bundle_available: b !== null,
      required_sections_found: b !== null && b.flags.coverage_gaps.length === 0,
      // a checked category has a signed-off rule; its cited table row must be in the evidence
      required_table_headers_found: b !== null && i.coverage.checked.every((c) => b.required_context[c]?.["rule_row_found"] === true),
      // footnotes travel inside their table row's excerpt, so they are missing only if evidence was refused
      required_footnotes_found: b !== null && b.flags.refused_inactive === 0,
      exception_detected: slots.some((s) => s["exception"] === true),
      overlay_detected: overlayDetected,
      overlay_rule_coverage: overlayDetected ? "manual_review" : "none",
      unsupported_claims: 0, // no model text exists before the briefing step
      conflicting_sources: i.evidence.conflicting_sources,
      required_context_missing: b === null ? ["evidence_bundle"] : codes(b.flags.coverage_gaps),
      stale_facts: i.evidence.stale_facts,
    },
    coverage: { checked: i.coverage.checked, manual_review: codes(i.coverage.manual_review), unknown: i.coverage.unknown },
    policy_flags: i.policyFlags,
  });
}

export const preparedStateHash = (s: PreparedState) => createHash("sha256").update(canonicalJson(s)).digest("hex");
