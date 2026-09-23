import { MemoInput, type Finding } from "@parcelpilot/contracts";
import { renderBriefSections, type MemoBrief } from "./brief-sections.ts";
import { ALL_CATEGORIES, CATEGORY, DISCLAIMER, FINDING, INPUT, LIMITATIONS, MEMO_VERSION, RISK, ROUTE, STATUS, reason, trigger } from "./copy.ts";

// Templated memo renderer (memo.v1): a locked run in, one standalone HTML document out. Deterministic:
// the same input renders byte-for-byte the same page (golden-file test). No model, no I/O, no clock.

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (n: number) => n.toLocaleString("en-US");
const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
const value = (v: { value: number | string; unit?: string | undefined } | undefined, op = "") => (v ? `${op ? esc(op) + " " : ""}${typeof v.value === "number" ? num(v.value) : esc(v.value)}${v.unit ? " " + esc(v.unit) : ""}` : "—");

function cite(f: Finding, sources: MemoInput["sources"]): string {
  if (f.citations.length === 0) return "—";
  return f.citations.map((c) => {
    const src = sources[c.document_id];
    const page = c.printed_page ?? c.page;
    return `${esc(src?.title ?? "Source " + c.document_id.slice(0, 12))}, ${esc(c.table ?? c.section)}, p. ${page}`;
  }).join("; ");
}

// With a validated brief (MOO-839) the memo adds the brief's summary, reasoned next actions, finding explanations,
// questions and cited sources; everything code-generated stays. With none, it is the template, byte for byte, plus an
// optional neutral note when the caller wants to say so.
const BRIEF_CSS = `
  sup .cite { text-decoration: none; font-size: 7.5pt; padding: 0 1px; }
  .sources li { margin: 6px 0; } blockquote.excerpt { margin: 4px 0 0 0; padding: 4px 8px; border-left: 3px solid var(--line); color: var(--muted); font-size: 9.5pt; white-space: pre-wrap; }`;

export function renderMemo(raw: MemoInput, opts: { brief?: MemoBrief | null; templateNote?: boolean } = {}): string {
  const m = MemoInput.parse(raw);
  const brief = opts.brief ? renderBriefSections(opts.brief) : null;
  const status = m.decision.final_status ? STATUS[m.decision.final_status] : null;
  const unknown = ALL_CATEGORIES.filter((c) => m.coverage.unknown.includes(c));
  const manual = ALL_CATEGORIES.filter((c) => m.coverage.manual_review.includes(c));
  const missing = [...new Set(m.findings.flatMap((f) => f.missing_inputs))];
  const abstain = m.decision.final_status === "insufficient_evidence";
  const actions = abstain ? ["collect_missing_information", "contact_city"] : [m.decision.route];
  const inputs = Object.entries(m.scenario.inputs).filter(([, v]) => v !== undefined && v !== null);
  const districts = [...m.parcel.overlays.map((c) => `overlay ${c}`), ...m.parcel.special_districts.map((c) => `special district ${c}`), ...m.parcel.planned_development.map((c) => `planned development ${c}`), ...m.parcel.floodplain.map((c) => `floodplain ${c}`)];
  const shas = Object.keys(m.sources).sort();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preliminary zoning screen — ${esc(m.parcel.address)}</title>
<style>
  @page { size: Letter; margin: 0.75in; }
  :root { --ink: #0f172a; --muted: #64748b; --line: #cbd5e1; --warn: #b45309; --warn-bg: #fffbeb; }
  html { color: var(--ink); font: 11pt/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  body { margin: 0 auto; max-width: 7.5in; padding: 24px 16px; }
  h1 { font-size: 16pt; margin: 0 0 2px; } h2 { font-size: 11.5pt; margin: 18px 0 6px; border-bottom: 1px solid var(--line); padding-bottom: 3px; }
  .disclaimer { border: 1px solid var(--warn); background: var(--warn-bg); color: var(--warn); padding: 8px 10px; font-weight: 600; margin: 10px 0 14px; }
  .muted { color: var(--muted); } .small { font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; } th, td { text-align: left; vertical-align: top; padding: 4px 6px; border-bottom: 1px solid var(--line); } th { color: var(--muted); font-weight: 600; }
  .status { font-size: 14pt; font-weight: 700; } ul { margin: 4px 0; padding-left: 18px; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9pt; }
  @media print { body { padding: 0; } a { color: inherit; text-decoration: none; } }${brief ? BRIEF_CSS : ""}
</style>
</head>
<body>
<header>
  <h1>Preliminary zoning screen</h1>
  <div class="muted">${esc(m.parcel.address)} · TAXKEY ${esc(m.parcel.taxkey)} · project “${esc(m.project.name)}” · scenario “${esc(m.scenario.name)}”</div>
  <div class="disclaimer">${DISCLAIMER}</div>
${opts.templateNote ? `  <div class="small muted">Summary generated from template.</div>\n` : ""}</header>

<h2>Status</h2>
<div class="status">${status ? esc(status.label) : "Not scored"}${m.decision.risk ? ` <span class="muted small">(${RISK[m.decision.risk]} risk)</span>` : ""}</div>
${status ? `<p>${esc(status.meaning)}</p>` : ""}
${m.decision.reasons.length ? `<ul>${m.decision.reasons.map((r) => `<li>${esc(reason(r))}</li>`).join("")}</ul>` : ""}
<p class="small muted">Checked ${m.coverage.checked.length} of ${ALL_CATEGORIES.length} categories against reviewed rules. ${esc(LIMITATIONS)}</p>
${brief ? `${brief.summary}\n` : ""}
<h2>Next action</h2>
${brief?.actions || `<ul>${actions.map((a) => `<li>${esc(ROUTE[a] ?? a)}</li>`).join("")}</ul>`}
${missing.length ? `<p><strong>Missing inputs:</strong> ${missing.map((x) => esc(x.replaceAll("_", " "))).join(", ")}.</p>` : ""}

<h2>Parcel facts</h2>
<table>
<tr><th>Address</th><td>${esc(m.parcel.address)}</td></tr>
<tr><th>TAXKEY</th><td>${esc(m.parcel.taxkey)}</td></tr>
<tr><th>Base zoning district</th><td>${m.parcel.base_zoning.map(esc).join(", ") || "—"}${m.parcel.gis_ambiguity ? " (more than one district covers this parcel)" : ""}</td></tr>
<tr><th>Lot area</th><td>${m.parcel.lot_area_sqft === null ? "—" : num(m.parcel.lot_area_sqft) + " sq ft"}${m.parcel.lot_area_suspect ? " (flagged as implausible in the record)" : ""}</td></tr>
<tr><th>Overlays and districts</th><td>${districts.map(esc).join("; ") || "none intersect this parcel"}</td></tr>
<tr><th>Parcel record retrieved</th><td>${date(m.parcel.retrieved_at)} (City of Milwaukee parcel layer)</td></tr>
</table>

<h2>Scenario</h2>
<table>${inputs.map(([k, v]) => `<tr><th>${esc(INPUT[k] ?? k)}</th><td>${typeof v === "number" ? num(v) : esc(v)}</td></tr>`).join("")}</table>

<h2>Findings</h2>
<table>
<thead><tr><th>Category</th><th>Result</th><th>Proposed</th><th>Allowed</th><th>Priority</th><th>Source</th></tr></thead>
<tbody>
${m.findings.map((f) => `<tr><td>${esc(CATEGORY[f.category] ?? f.category)}</td><td>${esc(FINDING[f.status] ?? f.status)}</td><td>${value(f.proposed)}</td><td>${value(f.allowed, f.allowed?.operator)}</td><td>${esc(f.criticality)}</td><td>${cite(f, m.sources)}${f.reason ? `<div class="small muted">${esc(reason(f.reason))}</div>` : ""}</td></tr>`).join("\n")}
</tbody>
</table>

${brief?.body ? `${brief.body}\n\n` : ""}<h2>Not covered by this screen</h2>
<p>${unknown.length ? `Not checked at all (no reviewed rule yet): ${unknown.map((c) => esc(CATEGORY[c])).join(", ")}.` : "Every category in scope has a reviewed rule."}${manual.length ? ` Needs manual review: ${manual.map((c) => esc(CATEGORY[c])).join(", ")}.` : ""}</p>

<h2>Routing triggers</h2>
${m.decision.triggers.length ? `<ul>${m.decision.triggers.map((t) => `<li>${esc(trigger(t))} (City GIS layer snapshot pinned to this run)</li>`).join("")}</ul>` : "<p>None.</p>"}

<h2>Provenance</h2>
<table class="small">
<tr><th>Run</th><td><code>${esc(m.run.id)}</code> · created ${date(m.run.created_at)} · locked ${date(m.run.locked_at)} · analysis date ${esc(m.run.analysis_date ?? "—")} · decision mode ${esc(m.run.decision_mode)} · rules engine ${esc(m.run.rules_engine_version ?? "—")}</td></tr>
<tr><th>Inputs hash</th><td><code>${esc(m.provenance.input_hash)}</code></td></tr>
<tr><th>Parcel snapshot</th><td><code>${esc(m.parcel.snapshot_id)}</code></td></tr>
<tr><th>GIS layer snapshots</th><td>${m.provenance.gis_layer_snapshot_ids.map((id) => `<code>${esc(id)}</code>`).join(", ") || "—"}</td></tr>
<tr><th>Rule versions</th><td>${Object.entries(m.provenance.rule_version_set).sort().map(([fam, id]) => `${esc(fam)} → <code>${esc(id)}</code>`).join("<br>") || "—"}</td></tr>
<tr><th>Sources</th><td>${shas.map((sha) => `${esc(m.sources[sha]!.title)} (stamp ${esc(m.sources[sha]!.published_marker ?? "—")}, ${esc(m.sources[sha]!.status)}) <code>${sha.slice(0, 16)}…</code>`).join("<br>") || "—"}</td></tr>
${m.evidence ? `<tr><th>Evidence checks</th><td>citations ${m.evidence.citation_validator_passed ? "passed" : "FAILED"} · active code version ${m.evidence.active_code_version ? "yes" : "no"}${m.evidence.problems.length ? " · " + m.evidence.problems.map(esc).join(", ") : ""}</td></tr>` : ""}
<tr><th>Template</th><td>${MEMO_VERSION}</td></tr>
</table>

<footer class="small muted" style="margin-top:18px">${DISCLAIMER}</footer>
</body>
</html>
`;
}
