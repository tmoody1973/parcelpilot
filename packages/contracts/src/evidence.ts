import { z } from "zod";
import { RuleCategory } from "./enums.ts";

// The evidence bundle (MOO-833; 04 §7, §7.1; 05 §5 `evidence_bundle`). Assembled from recorded retrieval_evidence rows
// after a run; what each consumer may see is fixed here, not by the consumer:
//   briefing LLM  → `items` (verbatim excerpts with page anchors), nothing else textual from the corpus
//   JEV state     → `required_context` booleans and `flags`, never excerpt text
//   source viewer → everything, including `anchors`
// Every item must be from an active source: a bundle that could carry a superseded or pending chunk fails the schema.

export const EvidenceAnchor = z.object({
  page: z.number().int().positive(),
  page_end: z.number().int().positive().optional(),
  bbox: z.array(z.number()).length(4).optional(),
  row_index_on_page: z.number().int().nonnegative().optional(),
});

export const EvidenceItem = z.object({
  source_id: z.string().min(1), // chunk family_id@version: stable across re-ingests of the same PDF
  chunk_id: z.string().min(1),
  official_url: z.string().nullable(),
  document_title: z.string().min(1),
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  section: z.string().min(1),
  page: z.number().int().positive(),
  printed_page: z.number().int().positive().nullable(),
  anchors: z.array(EvidenceAnchor).min(1),
  verbatim_excerpt: z.string().min(1), // exactly the chunk text: never rewritten or summarised
  status: z.literal("active"),
  category: RuleCategory.nullable(),
  subquestion: z.string().min(1),
  required_context_type: z.string().nullable(), // null for a ranked hit; the slot name for required context
  selection_reason: z.string().min(1),
  rank: z.number().int().positive(),
  footnote_markers: z.array(z.string()), // footnotes travel inside a table row's excerpt; the markers are listed for checks
  token_count: z.number().int().nonnegative(),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

export const ContextSlots = z.record(z.string(), z.boolean()); // slot → found
export const EvidenceBundle = z.object({
  version: z.literal("evidence_bundle.v1"),
  run_id: z.string().nullable(), // the feasibility run, once M5 wires retrieval into runs; null for offline bundles
  retrieval_run_ids: z.array(z.string()).min(1),
  analysis_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  embedding_version_id: z.string().nullable(),
  token_budget: z.number().int().positive(),
  tokens_used: z.number().int().nonnegative(),
  items: z.array(EvidenceItem),
  required_context: z.record(z.string(), ContextSlots), // category (or "district") → slot → found
  flags: z.object({
    active_version_confirmed: z.boolean(), // every candidate item was from an active, in-force source
    overlay_detected: z.boolean(),
    coverage_gaps: z.array(z.string()), // categories with no primary evidence
    dropped_for_budget: z.number().int().nonnegative(),
    refused_inactive: z.number().int().nonnegative(), // evidence rows whose source stopped being active after the run
  }),
}).superRefine((b, ctx) => {
  if (b.tokens_used > b.token_budget) ctx.addIssue({ code: "custom", path: ["tokens_used"], message: `bundle uses ${b.tokens_used} tokens over a ${b.token_budget} budget` });
});
export type EvidenceBundle = z.infer<typeof EvidenceBundle>;

export const EVIDENCE_SCHEMAS = { EvidenceBundle } as const;
