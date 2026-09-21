// Pure summary of parcel/layer overlaps → the `parcel` block of PreparedDecisionState (05 §4.4). No I/O.

export type GisLayerKind = "base_zoning" | "planned_development" | "overlay" | "special_district" | "floodplain";
export type IntersectionRow = { layer_key: string; kind: GisLayerKind; code: string | null; overlap_ratio: number; overlap_area_sqft: number; attributes?: Record<string, unknown> };

export const BASE_ZONING_MIN_RATIO = 0.02; // PRD/02 §4: two base districts each > 2% → ambiguity
export const OTHER_MIN_RATIO = 0.001; // ponytail: edge-touching neighbours produce ~0 area; anything under 0.1% is noise, raise if real overlays get missed

export type GisSummary = {
  base_zoning: string[]; // codes with ratio > 2%, largest first
  base_zoning_ratios: Record<string, number>;
  gis_ambiguity: boolean;
  planned_development: string[];
  overlays: string[];
  special_districts: string[];
  floodplain: string[];
  coverage_ratio: number; // share of the parcel covered by any base-zoning polygon
};

function codesFor(rows: IntersectionRow[], kind: GisLayerKind, min: number): string[] {
  const best = new Map<string, number>();
  for (const r of rows) if (r.kind === kind && r.overlap_ratio > min) {
    const code = r.code ?? r.layer_key;
    best.set(code, Math.max(best.get(code) ?? 0, r.overlap_ratio));
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export function summarizeIntersections(rows: IntersectionRow[]): GisSummary {
  const base = new Map<string, number>();
  let covered = 0;
  for (const r of rows) if (r.kind === "base_zoning") {
    covered += r.overlap_ratio;
    if (r.overlap_ratio > BASE_ZONING_MIN_RATIO) { const c = r.code ?? r.layer_key; base.set(c, Math.max(base.get(c) ?? 0, r.overlap_ratio)); }
  }
  const baseSorted = [...base.entries()].sort((a, b) => b[1] - a[1]);
  return {
    base_zoning: baseSorted.map(([c]) => c),
    base_zoning_ratios: Object.fromEntries(baseSorted.map(([c, r]) => [c, Number(r.toFixed(4))])),
    gis_ambiguity: baseSorted.length > 1,
    planned_development: codesFor(rows, "planned_development", OTHER_MIN_RATIO),
    overlays: codesFor(rows, "overlay", OTHER_MIN_RATIO),
    special_districts: codesFor(rows, "special_district", OTHER_MIN_RATIO),
    floodplain: codesFor(rows, "floodplain", OTHER_MIN_RATIO),
    coverage_ratio: Number(Math.min(1, covered).toFixed(4)),
  };
}
