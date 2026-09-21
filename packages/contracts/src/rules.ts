import { z } from "zod";
import { Criticality, FindingStatus, RuleCategory } from "./enums.ts";
import { ScenarioInputs } from "./scenario.ts";

// Rules-engine contract (docs/planning/05_decisioning_design.md §1). A rule is data: one row
// parameterizes one of a small fixed set of kinds. Numbers only ever come from `params`,
// the scenario, or the parcel; the engine compares, it never invents.

// Letters from the Table 295-603-1 legend. Data labels only; never rendered as a verdict.
export const UseLabel = z.enum(["Y", "L", "S", "N"]);
export type UseLabel = z.infer<typeof UseLabel>;

export const RuleKind = z.enum(["allowed_use", "max_height_ft", "min_height_ft", "min_setback_ft", "max_setback_ft", "min_lot_area_per_unit"]);
export type RuleKind = z.infer<typeof RuleKind>;

const Ft = z.number().nonnegative();
export const RULE_PARAMS = {
  allowed_use: z.object({ uses: z.record(z.string(), UseLabel) }),
  max_height_ft: z.object({ max_ft: Ft }),
  min_height_ft: z.object({ min_ft: Ft }),
  min_setback_ft: z.object({ min_ft: Ft }),
  max_setback_ft: z.object({ max_ft: Ft }),
  min_lot_area_per_unit: z.object({ sqft_per_unit: z.number().positive() }),
} as const satisfies Record<RuleKind, z.ZodType>;
export type RuleParams<K extends RuleKind = RuleKind> = z.infer<(typeof RULE_PARAMS)[K]>;

// Which categories a kind may sit under. A height kind on a setback row is a data error, not a finding.
export const KIND_CATEGORIES: Record<RuleKind, readonly RuleCategory[]> = {
  allowed_use: ["use"],
  max_height_ft: ["height"],
  min_height_ft: ["height"],
  min_setback_ft: ["setback_front", "setback_side", "setback_rear"],
  max_setback_ft: ["setback_front", "setback_side", "setback_rear"],
  min_lot_area_per_unit: ["density"],
};

// Reviewer defaults from 05 §1.4, used when a category has no rule to carry its own criticality.
export const DEFAULT_CRITICALITY: Record<RuleCategory, Criticality> = {
  use: "critical", height: "critical", setback_front: "high", setback_side: "high", setback_rear: "high", density: "high", parking: "medium", lot_coverage: "medium",
};

// document_id is the source document's sha256 (stable across databases); the seed maps it to a row id.
export const RuleCitation = z.object({
  citation_id: z.string().optional(),
  document_id: z.string(),
  page: z.number().int().positive(), // pdf page
  printed_page: z.number().int().positive().optional(),
  section: z.string(),
  table: z.string().optional(),
  excerpt: z.string().optional(), // verbatim cell or sentence
});
export type RuleCitation = z.infer<typeof RuleCitation>;

// A fact path the engine can read: "scenario.<field>" or "parcel.<field>" / "parcel.attributes.<key>".
export const Predicate = z.object({
  fact: z.string().regex(/^(scenario|parcel)\.[a-z_.]+$/),
  op: z.enum(["==", "!=", "in", ">", ">=", "<", "<="]),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.union([z.number(), z.string()]))]),
});
export type Predicate = z.infer<typeof Predicate>;

// A reviewed footnote (05 §1.3). `when` absent = always active. Not evaluable = forces verify.
export const RuleCondition = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  when: Predicate.optional(),
  evaluable: z.boolean(),
  effect: z.union([z.object({ param: z.string(), value: z.union([z.number(), z.string()]) }), z.object({ status: z.literal("verify") })]),
  citation: RuleCitation,
});
export type RuleCondition = z.infer<typeof RuleCondition>;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ZoningRule = z.object({
  id: z.string().min(1),
  family_id: z.string().min(1),
  version: z.number().int().positive(),
  jurisdiction_id: z.string().min(1),
  district_code: z.string().min(1),
  category: RuleCategory,
  kind: RuleKind,
  params: z.record(z.string(), z.unknown()),
  conditions: z.array(RuleCondition).default([]),
  criticality: Criticality,
  citations: z.array(RuleCitation).min(1),
  effective_start: IsoDate,
  effective_end: IsoDate.nullable().default(null),
  status: z.literal("approved"),
}).superRefine((rule, ctx) => {
  if (!KIND_CATEGORIES[rule.kind].includes(rule.category)) ctx.addIssue({ code: "custom", path: ["kind"], message: `kind ${rule.kind} cannot sit under category ${rule.category}` });
  const parsed = RULE_PARAMS[rule.kind].safeParse(rule.params);
  if (!parsed.success) ctx.addIssue({ code: "custom", path: ["params"], message: `params do not match kind ${rule.kind}: ${parsed.error.message}` });
});
export type ZoningRule = z.infer<typeof ZoningRule>;

// What the engine knows about the land (from parcel_snapshots + gis_intersections). Null = not known.
export const ParcelFacts = z.object({
  lot_area_sqft: z.number().nonnegative().nullable(),
  lot_area_suspect: z.boolean().default(false),
  base_zoning: z.array(z.string()),
  planned_development: z.array(z.string()).default([]),
  overlays: z.array(z.string()).default([]),
  special_districts: z.array(z.string()).default([]),
  floodplain: z.array(z.string()).default([]),
  gis_ambiguity: z.boolean().default(false),
  attributes: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).default({}),
});
export type ParcelFacts = z.infer<typeof ParcelFacts>;

export const ComparisonOperator = z.enum(["<=", ">=", "in", "=="]);
export const Confidence = z.enum(["high", "medium", "low"]);
const Value = z.union([z.number(), z.string()]);

export const Finding = z.object({
  category: RuleCategory,
  status: FindingStatus,
  criticality: Criticality,
  rule_id: z.string().optional(),
  rule_version: z.number().int().positive().optional(),
  proposed: z.object({ value: Value, unit: z.string().optional(), source: z.enum(["scenario", "parcel"]) }).optional(),
  allowed: z.object({ value: Value, unit: z.string().optional(), operator: ComparisonOperator }).optional(),
  calculation_ids: z.array(z.string()),
  citations: z.array(RuleCitation),
  reason: z.string().optional(), // no_rule | missing_input:<field> | condition_unevaluable:<id> | multiple_districts | use_label:<L|S> | fact_suspect:<field>
  missing_inputs: z.array(z.string()),
  confidence: Confidence,
});
export type Finding = z.infer<typeof Finding>;

export const CalculationRecord = z.object({
  id: z.string(),
  category: RuleCategory,
  rule_id: z.string(),
  rule_version: z.number().int().positive(),
  kind: RuleKind,
  inputs: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])),
  proposed: Value.nullable(),
  allowed: Value.nullable(),
  operator: ComparisonOperator.nullable(),
  status: FindingStatus,
  detail: z.string(),
  conditions_applied: z.array(z.string()),
});
export type CalculationRecord = z.infer<typeof CalculationRecord>;

export const Coverage = z.object({ checked: z.array(RuleCategory), manual_review: z.array(RuleCategory), unknown: z.array(RuleCategory) });
export type Coverage = z.infer<typeof Coverage>;

export const EvaluateInput = z.object({
  parcel: ParcelFacts,
  scenario: ScenarioInputs,
  rules: z.array(ZoningRule),
  categories_in_scope: z.array(RuleCategory).min(1),
  analysis_date: IsoDate,
});
export type EvaluateInput = z.infer<typeof EvaluateInput>;

export const EvaluateOutput = z.object({ findings: z.array(Finding), calculations: z.array(CalculationRecord), coverage: Coverage });
export type EvaluateOutput = z.infer<typeof EvaluateOutput>;

// Object schemas emitted as JSON Schema next to the enums (pnpm contracts:emit).
export const RULE_SCHEMAS = { ZoningRule, ParcelFacts, Finding, CalculationRecord, EvaluateInput, EvaluateOutput } as const;
