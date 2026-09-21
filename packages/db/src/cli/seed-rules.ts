// Seeds packages/contracts/rules/*.json into zoning_rules + citations + rule_citations (MOO-813).
// Idempotent: a rule is keyed by (family_id, version); a citation by (document, page, section, excerpt).
// Rows are append-only, so a changed value must be a new version in the JSON, never an edit.
// Usage: pnpm rules:seed   (env: DATABASE_SERVICE_URL or DATABASE_URL; REVIEWER_EMAIL)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { ZoningRule, type RuleCitation, type ZoningRule as Rule } from "@parcelpilot/contracts";

const URL = process.env["DATABASE_SERVICE_URL"] ?? process.env["DATABASE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot";
const REVIEWER_EMAIL = process.env["REVIEWER_EMAIL"] ?? "tarik@radiomilwaukee.org"; // interim reviewer = product owner (MOO-795)
const RULES_DIR = join(import.meta.dirname, "..", "..", "..", "contracts", "rules");
const RuleList = ZoningRule.array(); // built on contracts' zod, not a second copy
type Doc = { sha256: string; title: string; source_type: string; published_marker: string; page_count: number; local_path: string };

const sql = postgres(URL, { max: 1 });
try {
  const files = readdirSync(RULES_DIR).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(RULES_DIR, f), "utf8")) as { documents?: Doc[]; rules: unknown[] });
  const rules: Rule[] = files.flatMap((f) => RuleList.parse(f.rules));
  // The cited documents, registered if `pnpm seed:sources` has not run here (CI has no PDFs or MinIO).
  // Keyed by sha256 like the Python seed, so whichever runs second is a no-op.
  for (const d of files.flatMap((f) => f.documents ?? [])) {
    await sql`insert into source_documents (jurisdiction_id, source_type, title, sha256, local_path, retrieved_at, retrieval_method, published_marker, page_count, status, review_status)
      values ('milwaukee-wi', ${d.source_type}, ${d.title}, ${d.sha256}, ${d.local_path}, now(), 'manual_upload', ${d.published_marker}, ${d.page_count}, 'active', 'approved') on conflict (sha256) do nothing`;
  }

  const [reviewer] = await sql`insert into users (email, full_name) values (${REVIEWER_EMAIL}, 'Interim reviewer')
    on conflict (email) do update set updated_at = now() returning id`;
  const reviewerId = reviewer!["id"] as string;

  const docIds = new Map<string, string>();
  for (const sha of new Set(rules.flatMap((r) => [...r.citations, ...r.conditions.map((c) => c.citation)]).map((c) => c.document_id))) {
    const [doc] = await sql`select id from source_documents where sha256 = ${sha}`;
    if (!doc) throw new Error(`source document ${sha.slice(0, 12)}… not in source_documents; run pnpm seed:sources first`);
    docIds.set(sha, doc["id"] as string);
  }

  const citationId = async (c: RuleCitation): Promise<string> => {
    const docId = docIds.get(c.document_id)!;
    const excerpt = c.excerpt ?? "";
    const [found] = await sql`select id from citations where source_document_id = ${docId} and page_number = ${c.page} and section is not distinct from ${c.section} and excerpt = ${excerpt}`;
    if (found) return found["id"] as string;
    const [row] = await sql`insert into citations (source_document_id, page_number, printed_page, section, anchor, excerpt)
      values (${docId}, ${c.page}, ${c.printed_page ?? null}, ${c.section}, ${c.table ?? null}, ${excerpt}) returning id`;
    return row!["id"] as string;
  };

  let inserted = 0, existing = 0, links = 0;
  for (const r of rules) {
    const [found] = await sql`select id from zoning_rules where family_id = ${r.family_id} and version = ${r.version}`;
    let ruleId: string;
    if (found) { ruleId = found["id"] as string; existing++; } else {
      const [row] = await sql`insert into zoning_rules (family_id, version, jurisdiction_id, district_code, category, kind, params, conditions, criticality, status, approved_by, approved_at, effective_start, effective_end)
        values (${r.family_id}, ${r.version}, ${r.jurisdiction_id}, ${r.district_code}, ${r.category}, ${r.kind}, ${sql.json(r.params as never)}, ${sql.json(r.conditions as never)}, ${r.criticality}, 'approved', ${reviewerId}, now(), ${r.effective_start}, ${r.effective_end}) returning id`;
      ruleId = row!["id"] as string; inserted++;
    }
    for (const c of [...r.citations, ...r.conditions.map((x) => x.citation)]) {
      const cid = await citationId(c);
      const res = await sql`insert into rule_citations (zoning_rule_id, citation_id) values (${ruleId}, ${cid}) on conflict do nothing`;
      links += res.count;
    }
  }
  // The reviewer signed rules that cite these pages, so the cited documents are the reviewed, active
  // versions the citation gate requires (05 §2). Only pending rows change; superseded ones never flip back.
  const activated = await sql`update source_documents set status = 'active', review_status = 'approved' where id = any(${[...docIds.values()]}) and status = 'pending_review'`;
  const [counts] = await sql`select (select count(*) from zoning_rules)::int as rules, (select count(*) from citations)::int as citations, (select count(*) from rule_citations)::int as links`;
  console.log(`rules: inserted=${inserted} existing=${existing}; new links=${links}; sources activated=${activated.count}; totals ${JSON.stringify(counts)}`);
} finally {
  await sql.end();
}
