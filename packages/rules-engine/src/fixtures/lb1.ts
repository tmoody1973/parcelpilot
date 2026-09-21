import type { RuleCitation, ZoningRule } from "@parcelpilot/contracts";

// Test fixture only. Values match the gold-case drafts (G01–G05). MOO-813 replaces this with the
// reviewer-signed seed; pages 2, 3 and 16 come from G01's citations, page 4 is unverified.
const DOC = "CH295-sub6.pdf";
const useTable: RuleCitation = { document_id: DOC, page: 2, section: "295-603-1", table: "Table 295-603-1" };
const designTable: RuleCitation = { document_id: DOC, page: 16, section: "295-605-2", table: "Table 295-605-2" };
const base = { family_id: "", version: 1, jurisdiction_id: "milwaukee-wi", district_code: "LB1", effective_start: "2025-07-15", effective_end: null, status: "approved" as const, conditions: [] };

export const LB1_RULES: ZoningRule[] = [
  {
    ...base, id: "lb1-use-v1", family_id: "lb1-use", category: "use", kind: "allowed_use", criticality: "critical",
    params: { uses: { multifamily: "Y", mixed_use: "Y", commercial: "Y", retail: "L", heavy_industrial: "N" } },
    conditions: [{
      id: "street_classification", description: "Street-level dwelling units are limited by street classification (295-603-2-a-2).",
      when: { fact: "scenario.ground_floor_use", op: "==", value: "residential" }, evaluable: false, effect: { status: "verify" },
      citation: { document_id: DOC, page: 4, section: "295-603-2-a-2" },
    }],
    citations: [useTable, { ...useTable, page: 3 }],
  },
  { ...base, id: "lb1-height-max-v1", family_id: "lb1-height-max", category: "height", kind: "max_height_ft", criticality: "critical", params: { max_ft: 45 }, citations: [designTable] },
  { ...base, id: "lb1-density-v1", family_id: "lb1-density", category: "density", kind: "min_lot_area_per_unit", criticality: "high", params: { sqft_per_unit: 1200 }, citations: [designTable] },
  { ...base, id: "lb1-front-min-v1", family_id: "lb1-front-min", category: "setback_front", kind: "min_setback_ft", criticality: "high", params: { min_ft: 0 }, citations: [designTable] },
  { ...base, id: "lb1-front-max-v1", family_id: "lb1-front-max", category: "setback_front", kind: "max_setback_ft", criticality: "high", params: { max_ft: 70 }, citations: [designTable] },
  { ...base, id: "lb1-side-min-v1", family_id: "lb1-side-min", category: "setback_side", kind: "min_setback_ft", criticality: "high", params: { min_ft: 0 }, citations: [designTable] },
  { ...base, id: "lb1-rear-min-v1", family_id: "lb1-rear-min", category: "setback_rear", kind: "min_setback_ft", criticality: "high", params: { min_ft: 0 }, citations: [designTable] },
];

export const V1_CATEGORIES = ["use", "height", "setback_front", "setback_side", "setback_rear", "density"] as const;
