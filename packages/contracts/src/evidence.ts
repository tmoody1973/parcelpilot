import { z } from "zod";
import { RuleCategory, SourceStatus } from "./enums.ts";

// The evidence bundle a retrieval pass produces (MOO-833; 04 §7, 06 §M4). It is the M4 handoff into M5: the
// verbatim excerpts feed the frozen briefing contract's evidence_bundle (05 §5), and the structured flags feed
// the JEV state builder (04 §7.1). The bundle orders and packages evidence; it never decides pass/fail.

// The context slots the retriever fills around a primary passage (04 §6.2 step 5, §6.3). Every slot the retriever
// looked for is recorded, so the bundle can say what is missing instead of looking complete.
export const RequiredContextSlot = z.enum([
  "parent_section",
  "adjacent",
  "cross_reference",
  "exception",
  "district_general_provision",
  "overlay",
  "definition",
  "superseding_amendment",
]);
export type RequiredContextSlot = z.infer<typeof RequiredContextSlot>;

// One verbatim excerpt handed to the briefing LLM. Field-for-field the shape of a 05 §5 evidence_bundle entry, so
// M5 drops it straight into the frozen contract. Text comes only from the cited chunk; nothing is paraphrased.
export const BundleEvidence = z.object({
  source_id: z.string(), // the code_chunk id the citation points at
  official_url: z.string().nullable(),
  document_title: z.string(),
  section: z.string(),
  page: z.number().int().positive(),
  verbatim_excerpt: z.string(),
  status: SourceStatus, // the source document's status; a served chunk is always "active"
});
export type BundleEvidence = z.infer<typeof BundleEvidence>;

// One retrieval run's ordered evidence for a single subquestion, plus which required-context slots it filled.
export const BundleSubquestion = z.object({
  subquestion: z.string(),
  category: RuleCategory.nullable(), // null for district-applicability or procedure questions
  districts: z.array(z.string()),
  run_id: z.string().nullable(), // the retrieval_runs row; null for offline evaluation
  evidence: z.array(z.object({
    source_id: z.string(),
    rank: z.number().int().positive(),
    context_type: RequiredContextSlot.nullable(), // null for a primary hit
  })),
  required_context_found: z.record(z.string(), z.boolean()), // by slot, only the slots the retriever looked for
  missing_context: z.array(RequiredContextSlot), // slots looked for but not found
});
export type BundleSubquestion = z.infer<typeof BundleSubquestion>;

// Structured metadata for the JEV state builder (04 §7.1). Flags only, never excerpt text.
export const BundleJevFlags = z.object({
  active_version_confirmed: z.boolean(),
  overlay_detected: z.boolean(),
  required_context_complete: z.boolean(),
  coverage_gap_list: z.array(z.string()), // "<category|district>:<slot>" for each missing slot
});
export type BundleJevFlags = z.infer<typeof BundleJevFlags>;

export const EvidenceBundle = z.object({
  version: z.literal("evidence_bundle.v1"),
  feasibility_run_id: z.string().nullable(),
  jurisdiction_id: z.string(),
  analysis_date: z.string(),
  embedding_version: z.object({
    id: z.string(),
    provider: z.string(),
    model_name: z.string(),
    dimension: z.number().int().positive(),
  }),
  evidence: z.array(BundleEvidence), // flat, deduplicated by source_id — the 05 §5 evidence_bundle list
  subquestions: z.array(BundleSubquestion),
  jev_flags: BundleJevFlags,
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

// Object schemas emitted as JSON Schema next to the enums (pnpm contracts:emit).
export const BUNDLE_SCHEMAS = { EvidenceBundle } as const;
