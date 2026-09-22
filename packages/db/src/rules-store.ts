import type postgres from "postgres";
import { ZoningRule, type RuleCitation, type SourceStatus } from "@parcelpilot/contracts";

// Loads approved, in-force rules for a parcel's districts as engine-ready ZoningRule[] (jurisdiction-shared
// tables; service connection). `document_id` on each citation is the source sha256; `citation_id` is the row id
// so calculations can pin exactly what was cited.
export type SourceState = { status: SourceStatus; effective_start: string | null; effective_end: string | null };

type RuleRow = { id: string; family_id: string; version: number; jurisdiction_id: string; district_code: string; category: string; kind: string; params: unknown; conditions: unknown; criticality: string; effective_start: string; effective_end: string | null };
type CitationRow = { zoning_rule_id: string; citation_id: string; sha256: string; page_number: number; printed_page: number | null; section: string | null; anchor: string | null; excerpt: string };

export async function loadApprovedRules(sql: postgres.Sql, input: { jurisdictionId: string; districts: string[]; date: string }): Promise<ZoningRule[]> {
  if (input.districts.length === 0) return [];
  // Rows are append-only, so a re-approval is a new version that supersedes the old one (MOO-819): the engine gets
  // the highest approved, in-force version of each family, never two versions of the same rule.
  const rows = await sql<RuleRow[]>`
    select distinct on (family_id) id, family_id, version, jurisdiction_id, district_code, category, kind, params, conditions, criticality,
           effective_start::text as effective_start, effective_end::text as effective_end
    from zoning_rules
    where jurisdiction_id = ${input.jurisdictionId} and district_code = any(${input.districts}) and status = 'approved'
      and effective_start <= ${input.date}::date and (effective_end is null or effective_end > ${input.date}::date)
    order by family_id, version desc`;
  if (rows.length === 0) return [];
  const cites = await sql<CitationRow[]>`
    select rc.zoning_rule_id, c.id as citation_id, d.sha256, c.page_number, c.printed_page, c.section, c.anchor, c.excerpt
    from rule_citations rc join citations c on c.id = rc.citation_id join source_documents d on d.id = c.source_document_id
    where rc.zoning_rule_id = any(${rows.map((r) => r.id)})
    order by c.page_number, c.section`;
  const byRule = new Map<string, RuleCitation[]>();
  for (const c of cites) {
    const cite: RuleCitation = { citation_id: c.citation_id, document_id: c.sha256, page: c.page_number, section: c.section ?? "", excerpt: c.excerpt, ...(c.printed_page ? { printed_page: c.printed_page } : {}), ...(c.anchor ? { table: c.anchor } : {}) };
    byRule.set(c.zoning_rule_id, [...(byRule.get(c.zoning_rule_id) ?? []), cite]);
  }
  const ordered = [...rows].sort((a, b) => a.district_code.localeCompare(b.district_code) || a.category.localeCompare(b.category) || a.family_id.localeCompare(b.family_id));
  return ordered.map((r) => {
    const conditions = Array.isArray(r.conditions) ? (r.conditions as Array<{ citation: RuleCitation }>) : [];
    // A condition's citation is stored inside the jsonb; the rule's own citations exclude those rows.
    const conditionKeys = new Set(conditions.map((c) => `${c.citation.document_id}:${c.citation.page}:${c.citation.section}`));
    const citations = (byRule.get(r.id) ?? []).filter((c) => !conditionKeys.has(`${c.document_id}:${c.page}:${c.section}`));
    return ZoningRule.parse({ id: r.id, family_id: r.family_id, version: r.version, jurisdiction_id: r.jurisdiction_id, district_code: r.district_code, category: r.category, kind: r.kind, params: r.params, conditions, criticality: r.criticality, citations, effective_start: r.effective_start, effective_end: r.effective_end, status: "approved" });
  });
}

// Status of every source document a rule set cites, keyed by sha256, for the citation gate.
export async function sourceStates(sql: postgres.Sql, shas: string[]): Promise<Record<string, SourceState>> {
  if (shas.length === 0) return {};
  const rows = await sql<Array<{ sha256: string } & SourceState>>`
    select sha256, status, effective_start::text as effective_start, effective_end::text as effective_end from source_documents where sha256 = any(${shas})`;
  return Object.fromEntries(rows.map((r) => [r.sha256, { status: r.status, effective_start: r.effective_start, effective_end: r.effective_end }]));
}

// Every distinct layer snapshot the stored intersections for a parcel snapshot came from (pinned on a run).
export async function layerSnapshotIdsFor(sql: postgres.Sql, parcelSnapshotId: string): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`select distinct gis_layer_snapshot_id as id from gis_intersections where parcel_snapshot_id = ${parcelSnapshotId} order by 1`;
  return rows.map((r) => r.id);
}
