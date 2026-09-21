import type { GeoJsonPolygon, GeocodeCandidate, GisSummary, ParcelCandidate } from "@parcelpilot/zoning-core";
import type { Coverage, EvidenceFlags, Finding, PolicyResult, ScenarioInputs } from "@parcelpilot/contracts";

// Wire shapes shared between the route handlers and the client. Types only, so client bundles stay clean.

export type ParcelPoint = { lon: number; lat: number };

export type SiteProfile = {
  taxkey: string;
  address: string;
  zoning: string | null;
  lot_area_sqft: number | null;
  lot_area_suspect: boolean;
  corner_lot: string | null;
  nr_units: number | null;
  parcel_type: number | null;
  gis_datetime: string | null;
  geometry: GeoJsonPolygon;
  snapshot_id: string;
  snapshot_reused: boolean;
  retrieved_at: string | null;
  gis: GisSummary;
  gis_features: GisFeature[]; // intersecting layer geometries (clipped near the parcel) for the map
};

export type GisFeature = { layer_key: string; kind: string; code: string | null; overlap_ratio: number; geometry: unknown };

export type ResolveResult =
  | { kind: "resolved"; profile: SiteProfile }
  | { kind: "ambiguous"; candidates: ParcelCandidate[]; point: ParcelPoint }
  | { kind: "not_found"; reason: "no_geocode_match" | "no_parcel_at_point" | "unknown_taxkey" };

export type GeocodeSuggestion = GeocodeCandidate;

export type Project = {
  id: string;
  parcel_taxkey: string;
  parcel_snapshot_id: string | null;
  parcel_address: string | null;
  name: string;
  scenario_count: number;
  created_at: string;
  updated_at: string;
};

export type Scenario = {
  id: string;
  project_id: string;
  name: string;
  status: string;
  inputs: ScenarioInputs; // the validated structured fields (contracts.ScenarioInputs), stored as draft_inputs
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = {
  project: Project;
  scenarios: Scenario[];
  profile: SiteProfile | null;
};

// One locked feasibility run (docs/planning/03_data_model.md §4.6). Everything a memo or panel needs, nothing live.
export type FeasibilityRun = {
  id: string;
  scenario_id: string;
  project_id: string;
  status: string;
  final_status: PolicyResult["final_status"] | null;
  route: PolicyResult["route"] | null;
  risk: PolicyResult["risk"];
  reasons: string[];
  triggers: string[];
  policy_flags: PolicyResult["policy_flags"] | null;
  coverage: Coverage;
  evidence: EvidenceFlags | null;
  findings: Finding[];
  scenario_inputs: ScenarioInputs;
  provenance: { parcel_snapshot_id: string; gis_layer_snapshot_ids: string[]; rule_version_set: Record<string, string>; input_hash: string; analysis_date: string | null; parcel_retrieved_at: string | null; rules_engine_version: string | null; decision_mode: string };
  created_at: string;
  locked_at: string | null;
};

export type { GeoJsonPolygon, GisSummary, ParcelCandidate, ScenarioInputs };
