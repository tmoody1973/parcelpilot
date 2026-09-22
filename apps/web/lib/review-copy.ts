import type { BadgeTone } from "../components/ui.tsx";

// Reviewer-workbench wording. The lint that keeps verdict words out of product copy also scans this folder, so
// queue statuses are labelled in reviewer terms ("signed off"), never as a zoning verdict.

export const TASK_TYPE_COPY: Record<string, { label: string; plural: string; hint: string }> = {
  rule_candidate_review: { label: "Rule candidate", plural: "Rule candidates", hint: "A rule extracted from a table row. Check the cell against the page, then sign off, edit, or reject." },
  merge_review: { label: "Table merge", plural: "Table merges", hint: "A table that spans pages. Confirm the fragments are one table and the headers carry over." },
  page_review: { label: "Page", plural: "Pages", hint: "A thin or scanned page. Confirm the text matches the image." },
  footnote_review: { label: "Footnote", plural: "Footnotes", hint: "A table footnote. Confirm which rows it modifies." },
  source_review: { label: "Source", plural: "Sources", hint: "A source document awaiting activation." },
  gis_ambiguity: { label: "GIS ambiguity", plural: "GIS ambiguities", hint: "A parcel or layer the map could not resolve." },
};
export const TASK_TYPE_ORDER = ["rule_candidate_review", "merge_review", "footnote_review", "page_review", "source_review", "gis_ambiguity"] as const;

export const TASK_STATUS_COPY: Record<string, { label: string; tone: BadgeTone }> = {
  unreviewed: { label: "Waiting", tone: "neutral" },
  in_review: { label: "In review", tone: "accent" },
  approved: { label: "Signed off", tone: "ok" }, // banned-ok: enum key from the database, never shown
  rejected: { label: "Rejected", tone: "danger" },
};

export const PRIORITY_COPY: Record<string, { label: string; tone: BadgeTone }> = {
  critical: { label: "critical", tone: "danger" }, high: { label: "high", tone: "warn" }, medium: { label: "medium", tone: "neutral" }, low: { label: "low", tone: "neutral" },
};

// 04 §3.6: the continuation signals a fragment can record, in the order the design lists them.
export const SIGNAL_COPY: Record<string, string> = {
  first_fragment: "First fragment of the family",
  adjacent_pages: "1 · Adjacent pages",
  title_repeated: "2 · Table title repeated",
  headers_equal: "3 · Column headers match",
  column_block_changed: "3 · Column block changed (new district set)",
  column_count_compatible: "4 · Column count compatible",
  no_district_header: "No district header on this page",
};

export const SOURCE_STATUS_COPY: Record<string, { label: string; tone: BadgeTone }> = {
  pending_review: { label: "Pending", tone: "neutral" },
  active: { label: "Active", tone: "ok" },
  superseded: { label: "Superseded", tone: "warn" },
  withdrawn: { label: "Withdrawn", tone: "danger" },
};

export const AUDIT_COPY: Record<string, string> = {
  "review_task.claimed": "Claimed",
  "rule.approved": "Rule signed off and recorded", // banned-ok: audit action name from the database
  "rule.first_approved": "First sign-off recorded; an owner's sign-off is still needed", // banned-ok: audit action name
  "rule.rejected": "Candidate rejected",
  "rule.edited": "Proposal edited",
  "merge.approved": "Merge signed off", // banned-ok: audit action name
  "merge.rejected": "Merge rejected",
  "page.approved": "Page marked reviewed", // banned-ok: audit action name
  "page.rejected": "Page flagged",
  "footnote.approved": "Footnote marked reviewed", // banned-ok: audit action name
  "footnote.rejected": "Footnote flagged",
  "source.activated": "Source activated",
  "source.superseded": "Source superseded",
  "source.withdrawn": "Source withdrawn",
};
export const auditCopy = (action: string): string => AUDIT_COPY[action] ?? action;
