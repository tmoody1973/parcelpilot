import { z } from "zod";
import { CoverageBucket, Criticality, FinalStatus, FindingStatus, JevRoute, ReviewStatus, RuleCategory } from "./enums.ts";
import { ScenarioInputs } from "./scenario.ts";

// A gold case is the expert's answer key for one parcel + one concept (PRD §9.2).
// Fixtures live in packages/contracts/gold/*.json and are validated by gold-case.test.ts.

const Money = z.number().nonnegative();

export const GoldParcel = z.object({
  source: z.enum(["real", "synthetic"]),
  taxkey: z.string(),
  address: z.string(),
  lot_area_sqft: Money,
  lot_area_suspect: z.boolean().default(false),
  base_zoning: z.array(z.string()).min(1),
  overlays: z.array(z.string()).default([]),
  special_districts: z.array(z.string()).default([]),
  floodplain: z.array(z.string()).default([]),
  gis_ambiguity: z.boolean().default(false),
  stacked_condo_candidates: z.array(z.string()).default([]),
  source_layer: z.string(),
  retrieved_at: z.string(),
});

export const GoldScenario = ScenarioInputs;

// Structured expected values so the gold test can exact-match the engine (MOO-817). `note` keeps the
// reviewer's prose ("24 units x 1200 = 28800 sq ft"); the engine compares numbers, not sentences.
const GoldValue = z.union([z.number(), z.string()]);
export const GoldFinding = z.object({
  status: FindingStatus,
  criticality: Criticality,
  proposed: z.object({ value: GoldValue, unit: z.string().optional() }).optional(),
  allowed: z.object({ value: GoldValue, unit: z.string().optional(), operator: z.enum(["<=", ">=", "in", "=="]) }).optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
});

export const GoldCitation = z.object({
  document: z.string(),
  sha256_prefix: z.string().min(8),
  pdf_page: z.number().int().positive(),
  printed_page: z.number().int().positive().optional(),
  section: z.string(),
  table: z.string().optional(),
  note: z.string().optional(),
});

export const GoldCase = z.object({
  id: z.string().regex(/^G\d{2}$/),
  version: z.number().int().positive(),
  title: z.string(),
  district: z.string(),
  parcel: GoldParcel,
  scenario: GoldScenario,
  expected: z.object({
    pre_run_block: z.enum(["stacked_condo_selection"]).optional(),
    findings: z.partialRecord(RuleCategory, GoldFinding), // partial: only categories in scope appear; zod 4 record() over an enum is exhaustive
    coverage: z.object({ checked: z.array(RuleCategory), manual_review: z.array(RuleCategory), unknown: z.array(RuleCategory) }),
    evidence: z.object({ citation_validator_passed: z.boolean(), active_code_version: z.boolean() }),
    policy_flags: z.object({
      deterministic_critical_fail: z.boolean(),
      special_district_detected: z.boolean(),
      missing_required_input: z.boolean(),
      gis_ambiguity: z.boolean(),
    }),
    final_status: FinalStatus,
    route: JevRoute,
    triggers: z.array(z.string()),
    reasons: z.array(z.string()),
  }),
  citations: z.array(GoldCitation),
  review: z.object({
    status: ReviewStatus,
    drafted_by: z.string(),
    drafted_at: z.string(),
    reviewer: z.string().nullable(),
    notes: z.string(),
  }),
});
export type GoldCase = z.infer<typeof GoldCase>;
export { CoverageBucket };
