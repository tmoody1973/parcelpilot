import { RULE_PARAMS, type FindingStatus, type RuleCategory, type ZoningRule } from "@parcelpilot/contracts";
import type { FactContext } from "./facts.ts";

type Value = number | string;
type Operator = "<=" | ">=" | "in" | "==";
export type CheckResult = {
  status: FindingStatus;
  proposed?: { value: Value; unit?: string; source: "scenario" | "parcel" };
  allowed?: { value: Value; unit?: string; operator: Operator };
  inputs: Record<string, number | string | boolean | null>;
  detail: string;
  reason?: string;
  missing_inputs: string[];
};

const SETBACK_FIELD: Partial<Record<RuleCategory, "setback_front_ft" | "setback_side_ft" | "setback_rear_ft">> = {
  setback_front: "setback_front_ft", setback_side: "setback_side_ft", setback_rear: "setback_rear_ft",
};

function missing(field: string, inputs: CheckResult["inputs"]): CheckResult {
  return { status: "insufficient_evidence", inputs, detail: `${field} not provided`, reason: `missing_input:${field}`, missing_inputs: [field] };
}

function compare(proposed: number, allowed: number, op: "<=" | ">=", unit: string, source: "scenario" | "parcel", inputs: CheckResult["inputs"], label: string): CheckResult {
  const ok = op === "<=" ? proposed <= allowed : proposed >= allowed;
  return {
    status: ok ? "pass" : "fail",
    proposed: { value: proposed, unit, source },
    allowed: { value: allowed, unit, operator: op },
    inputs,
    detail: `${label}: ${proposed} ${op} ${allowed} ${unit} → ${ok ? "pass" : "fail"}`,
    missing_inputs: [],
  };
}

// One numeric or list comparison per kind. `params` has already had reviewed conditions applied.
export function checkRule(rule: ZoningRule, params: Record<string, unknown>, ctx: FactContext): CheckResult {
  const { scenario, parcel } = ctx;
  switch (rule.kind) {
    case "allowed_use": {
      const { uses } = RULE_PARAMS.allowed_use.parse(params);
      const label = uses[scenario.use];
      const inputs = { use: scenario.use, label: label ?? null };
      if (label === undefined) return { status: "unknown", inputs, detail: `use "${scenario.use}" is not in the reviewed use list`, reason: "no_rule:use_not_in_v1_rule_set", missing_inputs: [] };
      const base = { proposed: { value: scenario.use, source: "scenario" as const }, allowed: { value: label, operator: "in" as const }, inputs, missing_inputs: [] };
      if (label === "N") return { ...base, status: "fail", detail: `use "${scenario.use}" is listed N in ${rule.district_code}` };
      if (label === "Y") return { ...base, status: "pass", detail: `use "${scenario.use}" is listed Y in ${rule.district_code}` };
      return { ...base, status: "verify", detail: `use "${scenario.use}" is listed ${label} in ${rule.district_code}; standards or a board permit apply`, reason: `use_label:${label}` };
    }
    case "max_height_ft": {
      const { max_ft } = RULE_PARAMS.max_height_ft.parse(params);
      const inputs = { height_ft: scenario.height_ft ?? null, max_ft };
      if (scenario.height_ft === undefined) return missing("height_ft", inputs);
      return compare(scenario.height_ft, max_ft, "<=", "ft", "scenario", inputs, "height");
    }
    case "min_height_ft": {
      const { min_ft } = RULE_PARAMS.min_height_ft.parse(params);
      const inputs = { height_ft: scenario.height_ft ?? null, min_ft };
      if (scenario.height_ft === undefined) return missing("height_ft", inputs);
      return compare(scenario.height_ft, min_ft, ">=", "ft", "scenario", inputs, "height");
    }
    case "min_setback_ft":
    case "max_setback_ft": {
      const field = SETBACK_FIELD[rule.category];
      if (!field) throw new Error(`setback kind under ${rule.category}`); // unreachable: ZoningRule refine forbids it
      const v = scenario[field];
      const isMin = rule.kind === "min_setback_ft";
      const limit = isMin ? RULE_PARAMS.min_setback_ft.parse(params).min_ft : RULE_PARAMS.max_setback_ft.parse(params).max_ft;
      const inputs = { [field]: v ?? null, [isMin ? "min_ft" : "max_ft"]: limit };
      if (v === undefined) return missing(field, inputs);
      return compare(v, limit, isMin ? ">=" : "<=", "ft", "scenario", inputs, rule.category);
    }
    case "min_lot_area_per_unit": {
      const { sqft_per_unit } = RULE_PARAMS.min_lot_area_per_unit.parse(params);
      const inputs = { units: scenario.units ?? null, lot_area_sqft: parcel.lot_area_sqft, lot_area_suspect: parcel.lot_area_suspect, sqft_per_unit };
      if (scenario.units === undefined) return missing("units", inputs);
      if (parcel.lot_area_sqft === null) return missing("lot_area_sqft", inputs);
      if (parcel.lot_area_suspect) return { status: "verify", inputs, detail: "lot area is flagged suspect in the parcel record", reason: "fact_suspect:lot_area_sqft", missing_inputs: [] };
      const required = scenario.units * sqft_per_unit;
      const r = compare(required, parcel.lot_area_sqft, "<=", "sq ft", "scenario", inputs, "density");
      return { ...r, detail: `density: ${scenario.units} units × ${sqft_per_unit} sq ft/unit = ${required} sq ft; lot ${parcel.lot_area_sqft} sq ft; ${required} <= ${parcel.lot_area_sqft} → ${r.status}` };
    }
  }
}
