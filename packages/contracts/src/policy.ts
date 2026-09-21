import { z } from "zod";
import { DecisionMode, FinalStatus, JevRisk, JevRoute, SourceStatus } from "./enums.ts";
import { Coverage, Finding } from "./rules.ts";

// Final-status policy contract (docs/planning/05_decisioning_design.md §2–§4.1). The policy is the
// only code that sets final_status. It reads statuses and flags, never numbers or free text.

export const EvidenceFlags = z.object({
  citation_validator_passed: z.boolean(),
  active_code_version: z.boolean(),
  conflicting_sources: z.boolean().default(false),
  stale_facts: z.boolean().default(false),
  problems: z.array(z.string()).default([]), // machine-readable, from the citation gate
});
export type EvidenceFlags = z.infer<typeof EvidenceFlags>;

// The spatial facts the policy routes on. Codes only; geometry and ratios stay in the run.
export const PolicyParcel = z.object({
  overlays: z.array(z.string()).default([]),
  special_districts: z.array(z.string()).default([]),
  planned_development: z.array(z.string()).default([]),
  floodplain: z.array(z.string()).default([]),
  gis_ambiguity: z.boolean().default(false),
  stacked_condo_candidates: z.array(z.string()).default([]),
});
export type PolicyParcel = z.infer<typeof PolicyParcel>;

export const PreRunBlock = z.enum(["stacked_condo_selection"]);

// Placeholder for the JEV decision (05 §4.7) so the signature is stable before JEV lands.
export const DecisionLayerOutput = z.object({
  version: z.literal("jev_decision.v1"),
  route: JevRoute,
  risk: JevRisk,
  confidence: z.number().min(0).max(1),
  manual_review_required: z.number().min(0).max(1),
});
export type DecisionLayerOutput = z.infer<typeof DecisionLayerOutput>;

export const PolicyInput = z.object({
  findings: z.array(Finding),
  coverage: Coverage,
  evidence: EvidenceFlags,
  parcel: PolicyParcel,
  pre_run_block: PreRunBlock.optional(),
  decision_mode: DecisionMode.default("rules_only"),
});
export type PolicyInput = z.infer<typeof PolicyInput>;

export const PolicyFlags = z.object({
  deterministic_critical_fail: z.boolean(),
  special_district_detected: z.boolean(),
  missing_required_input: z.boolean(),
  gis_ambiguity: z.boolean(),
});
export type PolicyFlags = z.infer<typeof PolicyFlags>;

export const PolicyResult = z.object({
  final_status: FinalStatus,
  route: JevRoute,
  risk: JevRisk.nullable(), // null when the status is insufficient_evidence (not a risk level)
  reasons: z.array(z.string()), // ordered override codes, e.g. "O3:critical_or_high_fail"
  triggers: z.array(z.string()), // e.g. "overlay:SPROZ", "gis_ambiguity:multiple_base_districts"
  policy_flags: PolicyFlags,
});
export type PolicyResult = z.infer<typeof PolicyResult>;

// Inputs to the deterministic citation gate (05 §2): the statuses of everything a finding cites.
export const SourceState = z.object({ status: SourceStatus, effective_start: z.string().nullable().default(null), effective_end: z.string().nullable().default(null) });
export const CitationGateInput = z.object({
  findings: z.array(Finding),
  sources: z.record(z.string(), SourceState), // by document_id
  rules: z.record(z.string(), z.object({ status: z.string() })), // by rule_id
  analysis_date: z.string(),
});
export type CitationGateInput = z.infer<typeof CitationGateInput>;

export const POLICY_SCHEMAS = { PolicyInput, PolicyResult, DecisionLayerOutput, CitationGateInput } as const;
