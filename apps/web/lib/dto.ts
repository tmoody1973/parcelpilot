import type { GeoJsonPolygon, GeocodeCandidate, GisSummary, ParcelCandidate } from "@parcelpilot/zoning-core";

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
};

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
  use: string | null;
  units: number | null;
  height_ft: number | null;
  stories: number | null;
  parking_spaces: number | null;
  ground_floor_commercial_sqft: number | null;
  status: string;
  created_at: string;
};

export type ProjectDetail = {
  project: Project;
  scenarios: Scenario[];
  profile: SiteProfile | null;
};

export type { GeoJsonPolygon, GisSummary, ParcelCandidate };
