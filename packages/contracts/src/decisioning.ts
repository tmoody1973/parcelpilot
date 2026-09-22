import { z } from "zod";
import { FinalStatus, JevRisk, JevRoute } from "./enums.ts";

// The decision-layer policy (MOO-834; 05 §4.1, §4.6, §4.8, §5). One versioned object holds every number and table the
// decision layer and the briefing step read, so a run can name exactly which policy it ran under
// (feasibility_runs.decision_policy_version_id). The repo copy below is the authority; migration 0019 seeds the same
// object into decision_policy_versions, and a test fails if the two ever differ.

// Rules-only decision table (05 §4.1): first matching row wins. `if_fired` is an override-code prefix ("O1"),
// `if_special` means a special district, overlay, planned development, floodplain or GIS ambiguity is present.
export const DecisionTableRow = z.object({
  status: FinalStatus,
  if_fired: z.string().regex(/^O\d$/).optional(),
  if_special: z.literal(true).optional(),
  risk: JevRisk.nullable(), // null for insufficient_evidence: not a risk level
  route: JevRoute,
});
export type DecisionTableRow = z.infer<typeof DecisionTableRow>;

// Allowed next actions (05 §5 `allowed_next_actions`, §7 `action_allowlist` / `abstention`): the only action ids a
// brief may suggest. Computed from status + triggers + categories needing verification + missing inputs; for
// insufficient_evidence only the status list applies (the abstention validator refuses anything else).
export const ActionId = z.enum([
  "proceed_to_concept_design", "revise_scenario", "engage_zoning_professional", "contact_city",
  "collect_missing_information", "request_early_city_zoning_review", "confirm_parking_configuration",
]);
export type ActionId = z.infer<typeof ActionId>;

export const DecisionPolicy = z.object({
  version: z.string().regex(/^decision_policy\.v\d+$/),
  thresholds: z.object({ // 05 §4.6; initial values for shadow mode, to be replaced by measured ones (PRD §9.4)
    route_confidence_min: z.number().min(0).max(1), // below → O7: take the stricter of the top two routes
    manual_review_true_at: z.number().min(0).max(1), // noul at or above → treat as true (O6)
    summary_safe_false_below: z.number().min(0).max(1), // noul below → treat as false (O6)
    risk_medium_at: z.number().min(0).max(2), // overall_risk.score buckets; never interpolated
    risk_high_at: z.number().min(0).max(2),
    jev_timeout_ms: z.number().int().positive(), // 05 §4.8: slower than this → failed, rules_only applies
  }),
  decision_table: z.array(DecisionTableRow).min(1),
  allowed_next_actions: z.object({
    by_status: z.record(FinalStatus, z.array(ActionId).min(1)),
    by_trigger_kind: z.record(z.string(), z.array(ActionId)), // trigger prefix before ":" (overlay, floodplain, …)
    by_category_needing_verification: z.record(z.string(), z.array(ActionId)),
    when_missing_inputs: z.array(ActionId),
  }),
}).superRefine((p, ctx) => {
  if (p.thresholds.risk_medium_at >= p.thresholds.risk_high_at) ctx.addIssue({ code: "custom", path: ["thresholds"], message: "risk_medium_at must be below risk_high_at" });
  for (const s of FinalStatus.options) {
    if (!p.decision_table.some((r) => r.status === s && !r.if_fired && !r.if_special)) ctx.addIssue({ code: "custom", path: ["decision_table"], message: `no fallback row for ${s}` });
    if (!p.allowed_next_actions.by_status[s]) ctx.addIssue({ code: "custom", path: ["allowed_next_actions", "by_status"], message: `no actions for ${s}` });
  }
});
export type DecisionPolicy = z.infer<typeof DecisionPolicy>;

export const DECISION_POLICY_V1: DecisionPolicy = DecisionPolicy.parse({
  version: "decision_policy.v1",
  thresholds: { route_confidence_min: 0.7, manual_review_true_at: 0.35, summary_safe_false_below: 0.65, risk_medium_at: 0.5, risk_high_at: 1.5, jev_timeout_ms: 2000 },
  decision_table: [
    { status: "insufficient_evidence", if_fired: "O1", risk: null, route: "insufficient_evidence" },
    { status: "insufficient_evidence", risk: null, route: "collect_missing_information" },
    { status: "revise_scenario", risk: "high", route: "revise_scenario" },
    { status: "verify_before_committing", if_special: true, risk: "high", route: "contact_city" },
    { status: "verify_before_committing", if_fired: "O2", risk: "medium", route: "collect_missing_information" },
    { status: "verify_before_committing", risk: "medium", route: "engage_zoning_professional" },
    { status: "proceed_to_concept_design", risk: "low", route: "proceed_to_concept_design" },
  ],
  allowed_next_actions: {
    by_status: {
      proceed_to_concept_design: ["proceed_to_concept_design"],
      revise_scenario: ["revise_scenario", "engage_zoning_professional"],
      verify_before_committing: ["engage_zoning_professional", "request_early_city_zoning_review"],
      insufficient_evidence: ["collect_missing_information", "contact_city"],
    },
    by_trigger_kind: {
      overlay: ["contact_city"], special_district: ["contact_city"], planned_development: ["contact_city"],
      floodplain: ["contact_city"], gis_ambiguity: ["contact_city"], stacked_condo: ["collect_missing_information"],
    },
    by_category_needing_verification: { parking: ["confirm_parking_configuration"] },
    when_missing_inputs: ["collect_missing_information"],
  },
});

// Row vocabularies for the M5 log tables (migration 0019). The database enums are built from these.
export const ModelProvider = z.enum(["jev", "baseline"]); // baseline = the structured-output comparator (M6)
export const ModelCallStatus = z.enum(["ok", "failed"]);
export const BriefingOutcome = z.enum(["validated", "fallback"]);
export const ValidationResult = z.enum(["pass", "fail", "skipped"]);
export const ValidationEffect = z.enum(["none", "sentence_removed", "action_removed", "brief_failed"]); // 05 §7 "severity" column
export const ValidatorName = z.enum([
  "schema", "contract_hash", "status_lock", "citation_membership", "uncited_claim", "numeric_alignment",
  "action_allowlist", "banned_phrases", "finding_coverage", "abstention", "unknown_as_pass", "citation_support",
]);

export const DECISIONING_SCHEMAS = { DecisionPolicy, ActionId, ModelProvider, ModelCallStatus, BriefingOutcome, ValidationResult, ValidationEffect, ValidatorName } as const;
