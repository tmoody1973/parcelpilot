import { BriefingContract, BriefingOutput, type CitedSentence } from "@parcelpilot/contracts";
import { CATEGORY } from "./copy.ts";

// The validated brief's sections of the memo (MOO-839). Only a brief that passed every 05 §7 validator reaches here;
// the template's code-generated sections (status, findings table, parcel facts, provenance) are kept as they are.
// Each cited sentence carries numbered markers that link to "Sources cited", where the excerpt is quoted verbatim.

export type EvidenceLink = {
  source_id: string; document_title: string; section: string; page: number; printed_page: number | null;
  official_url: string | null; verbatim_excerpt: string;
};
export type MemoBrief = {
  output: BriefingOutput;
  evidence: EvidenceLink[]; // the frozen bundle's items; only these ids are linkable
  findingCategories: Record<string, string>; // finding_id → rule category, from the contract
};

// A stored brief is re-parsed before it is shown: a row that no longer matches the schema renders the template.
// Printed pages are not in the contract; the caller fills them in where it can.
export function memoBrief(output: unknown, contract: unknown): MemoBrief | null {
  const o = BriefingOutput.safeParse(output);
  const c = BriefingContract.safeParse(contract);
  if (!o.success || !c.success) return null;
  return {
    output: o.data,
    evidence: c.data.evidence_bundle.map((e) => ({ source_id: e.source_id, document_title: e.document_title, section: e.section, page: e.page, printed_page: null, official_url: e.official_url, verbatim_excerpt: e.verbatim_excerpt })),
    findingCategories: Object.fromEntries(c.data.verified_findings.map((v) => [v.finding_id, v.category])),
  };
}

const ACTION: Record<string, string> = {
  proceed_to_concept_design: "Proceed to concept design",
  revise_scenario: "Revise the scenario",
  engage_zoning_professional: "Engage a zoning professional",
  contact_city: "Contact the City",
  collect_missing_information: "Collect the missing information",
  request_early_city_zoning_review: "Request an early zoning review from the City",
  confirm_parking_configuration: "Confirm the parking configuration",
};
const RECIPIENT: Record<string, string> = { city: "City of Milwaukee", architect: "Architect", zoning_professional: "Zoning professional", lender_or_partner: "Lender or partner" };

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderBriefSections(b: MemoBrief): { summary: string; actions: string; body: string } {
  const byId = new Map(b.evidence.map((e) => [e.source_id.toLowerCase(), e]));
  const order: EvidenceLink[] = []; // numbered in order of first citation
  const marker = (ids: string[]) => ids.map((id) => {
    const e = byId.get(id.toLowerCase());
    if (!e) return ""; // not in the frozen bundle: never linked (the validators would already have removed it)
    let n = order.indexOf(e) + 1;
    if (n === 0) { order.push(e); n = order.length; }
    return `<sup><a href="#src-${n}" class="cite">${n}</a></sup>`;
  }).join("");
  const sentence = (s: CitedSentence) => `${esc(s.text)}${marker(s.source_ids)}`;
  const para = (xs: CitedSentence[]) => (xs.length ? `<p>${xs.map(sentence).join(" ")}</p>` : "");

  const o = b.output;
  const summary = `<h2>Summary</h2>\n${para(o.executive_summary)}\n${para(o.status_explanation)}`;
  const actions = o.suggested_actions.length
    ? `<ul>${o.suggested_actions.map((a) => `<li><strong>${esc(ACTION[a.action_id] ?? a.action_id.replaceAll("_", " "))}.</strong> ${sentence(a.rationale)}</li>`).join("")}</ul>`
    : "";
  const findings = o.verified_findings.filter((v) => v.sentences.length).map((v) => `<p><strong>${esc(CATEGORY[b.findingCategories[v.finding_id] ?? ""] ?? "Finding")}.</strong> ${v.sentences.map(sentence).join(" ")}</p>`).join("\n");
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>` : "");
  const questions = list(o.open_questions.map(sentence));
  const experts = list(o.questions_for_experts.map((q) => `<strong>${esc(RECIPIENT[q.recipient] ?? q.recipient)}:</strong> ${sentence(q.question)}`));
  const sources = order.map((e, i) => {
    const page = e.printed_page ?? e.page;
    const link = e.official_url ? ` · <a href="${esc(`${e.official_url}#page=${e.page}`)}" target="_blank" rel="noopener">open page ${e.page} of the PDF</a>` : e.printed_page ? ` (page ${e.page} of the PDF)` : "";
    return `<li id="src-${i + 1}">${esc(e.document_title)}, ${esc(e.section)}, p. ${page}${link}<blockquote class="excerpt">${esc(e.verbatim_excerpt)}</blockquote></li>`;
  }).join("\n");
  const body = [
    findings ? `<h2>What the findings mean</h2>\n${findings}` : "",
    questions ? `<h2>Open questions</h2>\n${questions}` : "",
    experts ? `<h2>Questions to ask</h2>\n${experts}` : "",
    sources ? `<h2>Sources cited</h2>\n<ol class="sources">${sources}</ol>` : "",
  ].filter(Boolean).join("\n\n");
  return { summary, actions, body };
}
