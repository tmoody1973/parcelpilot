import { EvidenceBundle, type BundleEvidence, type SourceStatus } from "@parcelpilot/contracts";
import type { ContextSlot, Hit, RetrieveResult } from "./retrieve.ts";

// The evidence-bundle assembler (MOO-833; 04 §7, 06 §M4). It packages one or more retrieval passes into the frozen
// EvidenceBundle that M5 hands to the briefing LLM and the JEV state builder. It reorders and labels evidence; it
// never decides pass/fail and never writes text of its own — every excerpt is a served chunk's own bytes.

// What a served chunk's source document contributes to a citation (title, link, status), keyed by document sha.
export type BundleDocument = { title: string; official_url: string | null; status: SourceStatus };

// One retrieval pass and the subquestion it answered. `category` is a RuleCategory or null for a district question.
export type BundleSource = {
  subquestion: string;
  category: string | null;
  districts: string[];
  overlays?: string[];
  result: RetrieveResult;
};

export type AssembleInput = {
  jurisdictionId: string;
  analysisDate: string;
  feasibilityRunId?: string | null;
  sources: BundleSource[];
  documents: Record<string, BundleDocument>; // by document sha256
};

// Hits come ranked first, context after, exactly as the run served them.
const served = (r: RetrieveResult): Hit[] => [...r.hits, ...r.context];

export function assembleBundle(input: AssembleInput): EvidenceBundle {
  const version = input.sources[0]?.result.version;
  if (!version) throw new Error("assembleBundle needs at least one retrieval result");

  const evidenceById = new Map<string, BundleEvidence>();
  const coverageGaps: string[] = [];
  let activeVersionConfirmed = true;
  let overlayDetected = false;

  const subquestions = input.sources.map((s) => {
    if (!s.result.version.is_active) activeVersionConfirmed = false;
    if ((s.overlays?.length ?? 0) > 0) overlayDetected = true;

    const evidence = served(s.result).map((h) => {
      const doc = input.documents[h.document_sha];
      if (!doc) throw new Error(`assembleBundle: no document metadata for sha ${h.document_sha} (chunk ${h.chunk_id})`);
      if (!evidenceById.has(h.chunk_id)) {
        evidenceById.set(h.chunk_id, {
          source_id: h.chunk_id,
          official_url: doc.official_url,
          document_title: doc.title,
          section: h.section,
          page: h.page_start,
          verbatim_excerpt: h.text,
          status: doc.status,
        });
      }
      return { source_id: h.chunk_id, rank: h.rank, context_type: h.context_type };
    });

    const found = s.result.context_found;
    const scope = s.category ?? s.districts[0] ?? "district";
    for (const slot of Object.keys(found) as ContextSlot[]) if (found[slot] === false) coverageGaps.push(`${scope}:${slot}`);

    return { subquestion: s.subquestion, category: s.category, districts: s.districts, run_id: s.result.run_id, evidence, required_context_found: found };
  });

  return EvidenceBundle.parse({
    version: "evidence_bundle.v1",
    feasibility_run_id: input.feasibilityRunId ?? null,
    jurisdiction_id: input.jurisdictionId,
    analysis_date: input.analysisDate,
    embedding_version: { id: version.id, provider: version.provider, model_name: version.model_name, dimension: version.dimension },
    evidence: [...evidenceById.values()],
    subquestions,
    jev_flags: { active_version_confirmed: activeVersionConfirmed, overlay_detected: overlayDetected, required_context_complete: coverageGaps.length === 0, coverage_gap_list: coverageGaps },
  });
}
