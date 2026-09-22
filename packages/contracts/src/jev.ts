import { z } from "zod";
import { Confidence } from "./rules.ts";
import { Criticality, FindingStatus, JevRoute, RuleCategory } from "./enums.ts";

// JEV in shadow (MOO-836; 05 §4.4–§4.9). The prepared state is the only thing JEV ever sees: statuses, booleans, codes
// and short category names. No dimensional numbers, no user text, no ordinance text, no URLs. `.strict()` everywhere, so
// a field added by mistake fails the schema instead of reaching the model.

const Code = z.string().regex(/^[A-Za-z0-9_:.\-]{1,64}$/); // district, overlay and reason codes: machine vocabulary only

export const PreparedState = z.object({
  version: z.literal("prepared_state.v1"),
  jurisdiction: Code,
  parcel: z.object({
    base_zoning: Code.nullable(),
    additional_zoning_districts: z.array(Code),
    overlays: z.array(Code), // overlay zones plus floodplain zones (05 §4.4 example lists floodplain here)
    special_districts: z.array(Code),
    planned_development: z.array(Code), // named by the contact_city route criterion, so JEV must see it
    gis_ambiguities: z.array(Code),
  }).strict(),
  scenario: z.object({
    use: Code, // a use from the signed-off rules' use lists, or "other": never the user's own words
    has_ground_floor_commercial: z.boolean(),
    missing_fields: z.array(Code),
  }).strict(),
  deterministic_findings: z.array(z.object({
    category: RuleCategory, status: FindingStatus, criticality: Criticality, confidence: Confidence,
    citation_count: z.number().int().nonnegative(), reason: Code.nullable(),
  }).strict()),
  evidence: z.object({
    district_verified: z.boolean(),
    active_code_version: z.boolean(),
    citation_validator_passed: z.boolean(),
    evidence_bundle_available: z.boolean(),
    required_sections_found: z.boolean(),
    required_table_headers_found: z.boolean(),
    required_footnotes_found: z.boolean(),
    exception_detected: z.boolean(),
    overlay_detected: z.boolean(),
    overlay_rule_coverage: z.enum(["none", "manual_review"]),
    unsupported_claims: z.number().int().nonnegative(),
    conflicting_sources: z.boolean(),
    required_context_missing: z.array(Code),
    stale_facts: z.boolean(),
  }).strict(),
  coverage: z.object({ checked: z.array(RuleCategory), manual_review: z.array(Code), unknown: z.array(RuleCategory) }).strict(),
  policy_flags: z.object({
    deterministic_critical_fail: z.boolean(), special_district_detected: z.boolean(), missing_required_input: z.boolean(), gis_ambiguity: z.boolean(),
  }).strict(),
}).strict();
export type PreparedState = z.infer<typeof PreparedState>;

// The four questions (05 §4.5), verbatim. Keys are not sent to the model, so each instruction carries its full meaning.
export const JEV_QUESTION_SET_VERSION = "jev_questions.v1";
export const JEV_QUESTIONS_V1 = {
  overall_risk: {
    type: "score",
    instructions: "Using only the supplied preliminary zoning-screen state for a Milwaukee infill parcel, how much diligence risk does this state show? Weight critical deterministic findings, special conditions, coverage gaps, and evidence quality. An unknown category is never evidence of compliance.",
    criteria: [
      "Low: every in-scope category is checked and passing, evidence flags are all true, no overlay, special district, ambiguity, or missing input.",
      "Medium: no critical or high failure, but at least one unknown category, a medium/low failure, stale facts, or a detected overlay whose rule coverage is manual_review.",
      "High: a critical or high-criticality failure, a special district, GIS ambiguity, conflicting sources, exception detected, or a required footnote/section not found.",
    ],
  },
  manual_review_required: {
    type: "noul",
    instructions: "True only when the supplied state includes a special condition, material missing information, an unsupported required category, conflicting evidence, or a failed major requirement that needs qualified review before reliance.",
    criteria: { true: "Qualified human review is needed before anyone relies on this screen.", false: "The screen can be relied on as a preliminary, scoped result without further review." },
  },
  recommended_route: {
    type: "choice",
    instructions: "Choose the safest single next workflow action supported by the supplied state. When two routes both apply, prefer the one that involves an outside party or collects information over the one that proceeds.",
    criteria: {
      proceed_to_concept_design: { what: "Every in-scope category is pass, evidence flags all true, no overlay, special district, ambiguity, or missing input.", not_for: "Any unknown category, any verify, any flag set." },
      revise_scenario: { what: "A deterministic finding is fail and the concept could plausibly change (height, setback, unit count) to fit.", not_for: "Failures caused by a special district or overlay; missing inputs." },
      contact_city: { what: "A planned development, overlay, redevelopment plan, or GIS ambiguity that only the City can clarify.", not_for: "Plain dimensional failures." },
      engage_zoning_professional: { what: "Conflicting sources, an exception or footnote condition the engine could not evaluate, or a use classification question.", not_for: "A single missing user input." },
      collect_missing_information: { what: "A user-supplied scenario field is missing and would change a finding.", not_for: "Cases where the sources, not the user, are the gap." },
      insufficient_evidence: { what: "Citation validation failed or a required source/section is missing, so no preliminary screen should be shown.", not_for: "Cases where sources are fine but the concept fails." },
    },
  },
  summary_safe_to_display: {
    type: "noul",
    instructions: "True only if the supplied evidence and coverage permit a preliminary, explicitly scoped summary. Do not treat any unknown category as a verified pass.",
    criteria: { true: "A scoped preliminary summary can be shown.", false: "Show only an insufficient-evidence state." },
  },
} as const;

// Response shape (docs.typesafe.ai/api, read 2026-09-22). Anything else is a schema-invalid response → failed call.
const Prob = z.number().min(0).max(1);
export const JevResponse = z.object({
  model: z.string().min(1),
  answers: z.object({
    overall_risk: z.object({ type: z.literal("score"), score: z.number().min(0).max(2), legend: z.record(z.string(), z.string()), probabilities: z.record(z.string(), Prob), confidence: Prob }),
    manual_review_required: z.object({ type: z.literal("noul"), noul: Prob }),
    recommended_route: z.object({ type: z.literal("choice"), choice: JevRoute, probabilities: z.record(z.string(), Prob), confidence: Prob }),
    summary_safe_to_display: z.object({ type: z.literal("noul"), noul: Prob }),
  }),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});
export type JevResponse = z.infer<typeof JevResponse>;

export const JEV_SCHEMAS = { PreparedState, JevResponse } as const;
