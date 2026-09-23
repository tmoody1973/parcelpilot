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

// The output schema for one contract (MOO-838; research, 2026-09-22): structured output can then only produce this
// contract's own source ids, finding ids and allowed actions, echo its hash and status exactly, and, when the status
// is insufficient_evidence, write no `finding` sentence at all. Single-value enums stand in for exact values because
// they are supported by every structured-output provider we use. The validators still run; this only makes the most
// common violations impossible to generate. Every output this accepts also parses as BriefingOutput.
const oneOf = (values: string[]) => (values.length ? z.enum(values as [string, ...string[]]) : z.never());
export function briefingOutputSchemaFor(c: BriefingContract, contractHash: string) {
  const abstain = c.final_decision.status === "insufficient_evidence";
  const ids = c.evidence_bundle.map((e) => e.source_id);
  const sentence = z.object({
    text: z.string().max(400),
    kind: abstain ? z.enum(["fact", "code", "advice", "framing"]) : z.enum(["fact", "code", "finding", "advice", "framing"]),
    source_ids: ids.length ? z.array(oneOf(ids)) : z.array(z.string()).max(0),
    numbers: z.array(z.object({ value: z.string(), calculation_id: z.string() })).optional(),
  });
  const actions = abstain ? c.allowed_next_actions.filter((a) => a === "collect_missing_information" || a === "contact_city") : c.allowed_next_actions;
  const findingIds = c.verified_findings.map((f) => f.finding_id);
  return z.object({
    contract_hash: z.enum([contractHash]),
    status_echo: z.enum([c.final_decision.status]),
    executive_summary: z.array(sentence),
    status_explanation: z.array(sentence),
    verified_findings: findingIds.length ? z.array(z.object({ finding_id: oneOf(findingIds), sentences: z.array(sentence) })) : z.array(z.object({ finding_id: z.string(), sentences: z.array(sentence) })).max(0),
    open_questions: z.array(sentence),
    suggested_actions: z.array(z.object({ action_id: oneOf(actions), rationale: sentence })),
    questions_for_experts: z.array(z.object({ recipient: z.enum(["city", "architect", "zoning_professional", "lender_or_partner"]), question: sentence })),
    disclaimer: z.enum([c.required_disclaimer]),
  });
}
