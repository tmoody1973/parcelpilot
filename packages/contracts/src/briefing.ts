import { z } from "zod";
import { ActionId } from "./decisioning.ts";
import { FinalStatus, FindingStatus, JevRisk, JevRoute, RuleCategory } from "./enums.ts";

// The briefing step (MOO-837; 05 §5, §6.1). The model explains a locked decision; it never makes one. It sees exactly
// one frozen input, the contract, and its only textual view of the corpus is the verbatim excerpts in the run's
// evidence bundle. The output is structured so the validators (05 §7) can check every sentence.

const Sha = z.string().regex(/^[0-9a-f]{64}$/);

export const BriefingContract = z.object({
  version: z.literal("briefing_contract.v1"),
  run_id: z.string().min(1),
  final_decision: z.object({ status: FinalStatus, risk: JevRisk.nullable(), route: JevRoute, status_is_locked: z.literal(true) }),
  parcel_facts: z.object({
    taxkey: z.string(), address: z.string().nullable(), lot_area_sqft: z.number().nullable(),
    base_zoning: z.string().nullable(), overlays: z.array(z.string()), facts_retrieved_at: z.string().nullable(),
  }),
  scenario: z.record(z.string(), z.union([z.string(), z.number(), z.null()])), // the user's confirmed inputs, copied
  verified_findings: z.array(z.object({
    finding_id: z.string(), category: RuleCategory, status: FindingStatus,
    proposed: z.string().nullable(), allowed: z.string().nullable(), // display strings built by code, e.g. "46 ft", "≤ 45 ft"
    calculation_id: z.string().nullable(), source_ids: z.array(z.string()),
  })),
  manual_review_triggers: z.array(z.object({ trigger_id: z.string(), kind: z.string(), code: z.string(), source_ids: z.array(z.string()) })),
  unknown_or_unsupported_categories: z.array(RuleCategory),
  missing_inputs: z.array(z.string()),
  jev_decision: z.object({
    selected_values: z.object({ overall_risk: z.enum(["low", "medium", "high"]), recommended_route: JevRoute }),
    confidence: z.number().min(0).max(1),
    may_not_override_policy: z.literal(true),
  }).nullable(),
  policy_reasons: z.array(z.string()),
  evidence_bundle: z.array(z.object({
    source_id: z.string(), official_url: z.string().nullable(), document_title: z.string(), section: z.string(), page: z.number().int().positive(),
    verbatim_excerpt: z.string(), status: z.literal("active"),
  })),
  allowed_next_actions: z.array(ActionId),
  required_disclaimer: z.string(),
  banned_phrases: z.array(z.string()),
});
export type BriefingContract = z.infer<typeof BriefingContract>;

// 05 §6.1. Sentence `kind` tells the validators which rule applies: fact/code/finding need source ids, advice needs an
// action or trigger, framing needs none but is still checked for banned words.
export const CitedSentence = z.object({
  text: z.string().max(400),
  kind: z.enum(["fact", "code", "finding", "advice", "framing"]),
  source_ids: z.array(z.string()),
  numbers: z.array(z.object({ value: z.string(), calculation_id: z.string() })).optional(),
});
export type CitedSentence = z.infer<typeof CitedSentence>;
const CitedParagraph = z.array(CitedSentence);

export const BriefingOutput = z.object({
  contract_hash: Sha,
  status_echo: FinalStatus,
  executive_summary: CitedParagraph,
  status_explanation: CitedParagraph,
  verified_findings: z.array(z.object({ finding_id: z.string(), sentences: z.array(CitedSentence) })),
  open_questions: z.array(CitedSentence),
  suggested_actions: z.array(z.object({ action_id: z.string(), rationale: CitedSentence })),
  questions_for_experts: z.array(z.object({ recipient: z.enum(["city", "architect", "zoning_professional", "lender_or_partner"]), question: CitedSentence })),
  disclaimer: z.string(),
});
export type BriefingOutput = z.infer<typeof BriefingOutput>;

export const BRIEFING_SCHEMAS = { BriefingContract, BriefingOutput } as const;
