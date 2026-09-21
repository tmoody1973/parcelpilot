import { CitationGateInput, type EvidenceFlags } from "@parcelpilot/contracts";

// Deterministic evidence gate (docs/planning/05_decisioning_design.md §2), run before any model.
// Pure: the caller loads source and rule statuses; this only checks them. Any failure forces
// citation_validator_passed = false, which the policy turns into insufficient_evidence (O1).
export function checkCitations(raw: CitationGateInput): EvidenceFlags {
  const { findings, sources, rules, analysis_date } = CitationGateInput.parse(raw);
  const problems: string[] = [];
  let activeVersion = true;
  for (const f of findings) {
    const settled = f.status === "pass" || f.status === "fail";
    if (settled && !f.citations.some((c) => c.page > 0)) problems.push(`citation_missing:${f.category}`);
    if (settled && f.rule_id && rules[f.rule_id]?.status !== "approved") problems.push(`rule_not_approved:${f.rule_id}`);
    for (const c of f.citations) {
      const src = sources[c.document_id];
      if (!src) { problems.push(`source_unknown:${c.document_id}`); activeVersion = false; continue; }
      const inForce = src.status === "active" && (src.effective_start === null || src.effective_start <= analysis_date) && (src.effective_end === null || src.effective_end > analysis_date);
      if (!inForce) { problems.push(`source_inactive:${c.document_id}`); activeVersion = false; }
    }
  }
  const unique = [...new Set(problems)];
  return { citation_validator_passed: unique.length === 0, active_code_version: activeVersion, conflicting_sources: false, stale_facts: false, problems: unique };
}
