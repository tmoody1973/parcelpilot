import { z } from "zod";

// Canonical enums. Source of truth for names: docs/planning/00_conventions.md.
// Change them there first, then here, then run `pnpm contracts:emit`.

export const FinalStatus = z.enum(["proceed_to_concept_design", "revise_scenario", "verify_before_committing", "insufficient_evidence"]);
export type FinalStatus = z.infer<typeof FinalStatus>;

export const FindingStatus = z.enum(["pass", "fail", "unknown", "verify", "insufficient_evidence"]);
export type FindingStatus = z.infer<typeof FindingStatus>;

export const Criticality = z.enum(["critical", "high", "medium", "low"]);
export type Criticality = z.infer<typeof Criticality>;

export const RuleCategory = z.enum(["use", "height", "setback_front", "setback_side", "setback_rear", "density", "parking", "lot_coverage"]);
export type RuleCategory = z.infer<typeof RuleCategory>;

export const CoverageBucket = z.enum(["checked", "manual_review", "unknown"]);
export type CoverageBucket = z.infer<typeof CoverageBucket>;

export const JevRoute = z.enum(["proceed_to_concept_design", "revise_scenario", "contact_city", "engage_zoning_professional", "collect_missing_information", "insufficient_evidence"]);
export type JevRoute = z.infer<typeof JevRoute>;

// A JEV Score with three ordered levels, bucketed by code. "insufficient evidence" is a FinalStatus, not a risk level.
export const JevRisk = z.enum(["low", "medium", "high"]);
export type JevRisk = z.infer<typeof JevRisk>;

export const SourceStatus = z.enum(["pending_review", "active", "superseded", "withdrawn"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const ReviewStatus = z.enum(["unreviewed", "in_review", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const RunStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const DecisionMode = z.enum(["rules_only", "structured_output_baseline", "jev", "shadow"]);
export type DecisionMode = z.infer<typeof DecisionMode>;
export const DEFAULT_DECISION_MODE: DecisionMode = "rules_only";

export const OrgRole = z.enum(["owner", "admin", "member", "reviewer"]);
export type OrgRole = z.infer<typeof OrgRole>;

// Ordering used by the final-status policy: index 0 is most permissive. Policy may only move rightward.
export const FINAL_STATUS_PERMISSIVENESS: readonly FinalStatus[] = ["proceed_to_concept_design", "revise_scenario", "verify_before_committing", "insufficient_evidence"];

export const ENUMS = { FinalStatus, FindingStatus, Criticality, RuleCategory, CoverageBucket, JevRoute, JevRisk, SourceStatus, ReviewStatus, RunStatus, DecisionMode, OrgRole } as const;
export type EnumName = keyof typeof ENUMS;
