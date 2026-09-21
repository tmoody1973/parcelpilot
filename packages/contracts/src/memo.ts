import { z } from "zod";
import { Coverage, Finding } from "./rules.ts";
import { PolicyResult, EvidenceFlags } from "./policy.ts";
import { ScenarioInputs } from "./scenario.ts";

// Input to the templated memo (PRD §7.5 E-01..E-04). Built only from a locked feasibility run, its parcel
// snapshot, and the source documents its citations name. Everything textual comes from these fields; the
// renderer adds headings and fixed sentences only, and the validators check the result (05 §7).

export const MemoSource = z.object({ title: z.string(), published_marker: z.string().nullable(), status: z.string(), official_url: z.string().nullable().default(null) });

export const MemoInput = z.object({
  version: z.literal("memo_input.v1"),
  run: z.object({
    id: z.string(),
    created_at: z.string(),
    locked_at: z.string().nullable(),
    analysis_date: z.string().nullable(),
    decision_mode: z.string(),
    rules_engine_version: z.string().nullable(),
  }),
  decision: PolicyResult,
  coverage: Coverage,
  evidence: EvidenceFlags.nullable(),
  findings: z.array(Finding),
  scenario: z.object({ name: z.string(), inputs: ScenarioInputs }),
  parcel: z.object({
    taxkey: z.string(),
    address: z.string(),
    lot_area_sqft: z.number().nullable(),
    lot_area_suspect: z.boolean(),
    base_zoning: z.array(z.string()),
    overlays: z.array(z.string()),
    special_districts: z.array(z.string()),
    planned_development: z.array(z.string()),
    floodplain: z.array(z.string()),
    gis_ambiguity: z.boolean(),
    retrieved_at: z.string().nullable(),
    snapshot_id: z.string(),
  }),
  provenance: z.object({
    gis_layer_snapshot_ids: z.array(z.string()),
    rule_version_set: z.record(z.string(), z.string()),
    input_hash: z.string(),
  }),
  sources: z.record(z.string(), MemoSource), // by sha256, for every document a finding or condition cites
  project: z.object({ name: z.string() }),
});
export type MemoInput = z.infer<typeof MemoInput>;

export const MEMO_SCHEMAS = { MemoInput } as const;
