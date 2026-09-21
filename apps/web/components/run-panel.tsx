import type { FeasibilityRun } from "../lib/dto.ts";
import { ALL_CATEGORIES, CATEGORY_COPY, FINDING_COPY, INPUT_COPY, RISK_COPY, ROUTE_COPY, STATUS_COPY, fmtValue, reasonCopy, triggerCopy } from "../lib/run-copy.ts";
import { Badge, Card, CardHeader } from "./ui.tsx";

// The decision panel for one locked run (PRD §5.2, §7.4; ENG-06): status with the scope caveat, one row per
// category, a coverage panel that always lists all eight categories, and every trigger with its source. Nothing
// is ever blank: an uncovered category says "unknown", a missing input is named.

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

export function RunPanel({ run }: { run: FeasibilityRun }) {
  const status = run.final_status ? STATUS_COPY[run.final_status] : null;
  const checked = run.coverage.checked.length;
  const missing = [...new Set(run.findings.flatMap((f) => f.missing_inputs))];
  const abstain = run.final_status === "insufficient_evidence";
  const actions = abstain ? ["collect_missing_information", "contact_city"] as const : run.route ? [run.route] as const : [];

  return (
    <Card>
      <CardHeader title="Preliminary screen" subtitle={`Run ${fmtDate(run.created_at)} · analysis date ${run.provenance.analysis_date ?? "—"} · rules engine ${run.provenance.rules_engine_version ?? "—"}`} action={<span className="flex items-center gap-2">{status ? <Badge tone={status.tone}>{status.label}</Badge> : null}<a href={`/runs/${run.id}/memo`} target="_blank" rel="noopener" className="text-xs text-accent no-underline" data-testid="memo-link">Memo ↗</a></span>} />
      <div className="px-4 py-3 text-sm" data-testid="run-panel">
        {status ? (
          <div className="rounded-md border border-line bg-canvas px-3 py-2" data-testid="status-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-ink">{status.label}</span>
              {run.risk ? <Badge tone="neutral">{RISK_COPY[run.risk]}</Badge> : null}
            </div>
            <p className="mt-1 text-muted">{status.meaning}</p>
            <p className="mt-2 text-xs text-muted" data-testid="scope-caveat">
              Checked {checked} of {ALL_CATEGORIES.length} categories against reviewed rules. Preliminary zoning screen, not an official zoning determination.
            </p>
            {run.reasons.length ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-ink">
                {run.reasons.map((r) => <li key={r}>{reasonCopy(r)}</li>)}
              </ul>
            ) : null}
            <div className="mt-2 border-t border-line pt-2">
              <span className="text-xs font-medium text-muted">Next action</span>
              <ul className="mt-1 list-disc pl-5 text-xs text-ink" data-testid="next-actions">
                {actions.map((a) => <li key={a}>{ROUTE_COPY[a]}</li>)}
              </ul>
            </div>
          </div>
        ) : null}

        {missing.length ? (
          <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn" data-testid="missing-inputs">
            Missing inputs: {missing.map((m) => INPUT_COPY[m] ?? m).join(", ")}.
          </p>
        ) : null}

        <FindingsTable run={run} />
        <CoveragePanel run={run} />
        <TriggersList run={run} />
      </div>
    </Card>
  );
}

function FindingsTable({ run }: { run: FeasibilityRun }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" data-testid="findings-table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-1.5 pr-3 font-medium">Category</th><th className="py-1.5 pr-3 font-medium">Result</th><th className="py-1.5 pr-3 font-medium">Proposed</th><th className="py-1.5 pr-3 font-medium">Allowed</th><th className="py-1.5 pr-3 font-medium">Priority</th><th className="py-1.5 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {run.findings.map((f) => {
            const c = FINDING_COPY[f.status] ?? { label: f.status, tone: "neutral" as const };
            const cite = f.citations[0];
            return (
              <tr key={f.category} className="border-b border-line/60 align-top" data-testid={`finding-${f.category}`} data-status={f.status}>
                <td className="py-1.5 pr-3 text-ink">{CATEGORY_COPY[f.category] ?? f.category}</td>
                <td className="py-1.5 pr-3"><Badge tone={c.tone}>{c.label}</Badge></td>
                <td className="py-1.5 pr-3 text-ink">{fmtValue(f.proposed)}</td>
                <td className="py-1.5 pr-3 text-ink">{f.allowed ? `${f.allowed.operator} ${fmtValue(f.allowed)}` : "—"}</td>
                <td className="py-1.5 pr-3 text-muted">{f.criticality}</td>
                <td className="py-1.5 text-xs text-muted">
                  {cite ? <span>{cite.table ?? cite.section} · p. {cite.printed_page ?? cite.page}</span> : "—"}
                  {f.reason ? <div className="mt-0.5 text-ink">{reasonCopy(f.reason)}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CoveragePanel({ run }: { run: FeasibilityRun }) {
  const bucketOf = (c: string) => (run.coverage.checked.includes(c as never) ? "checked" : run.coverage.manual_review.includes(c as never) ? "manual_review" : "unknown");
  const groups = { checked: "Checked against reviewed rules", manual_review: "Needs manual review", unknown: "Not covered yet" } as const;
  return (
    <div className="mt-3 border-t border-line pt-2" data-testid="coverage-panel">
      <span className="text-xs font-medium text-muted">Coverage: {ALL_CATEGORIES.length} categories</span>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {(Object.keys(groups) as Array<keyof typeof groups>).map((g) => (
          <div key={g}>
            <div className="text-xs text-muted">{groups[g]}</div>
            <div className="mt-1 flex flex-wrap gap-1.5" data-testid={`coverage-${g}`}>
              {ALL_CATEGORIES.filter((c) => bucketOf(c) === g).map((c) => <Badge key={c} tone={g === "checked" ? "accent" : g === "manual_review" ? "warn" : "neutral"}>{CATEGORY_COPY[c]}</Badge>)}
              {ALL_CATEGORIES.every((c) => bucketOf(c) !== g) ? <span className="text-xs text-muted">none</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TriggersList({ run }: { run: FeasibilityRun }) {
  if (run.triggers.length === 0 && !run.policy_flags?.gis_ambiguity) return null;
  return (
    <div className="mt-3 border-t border-line pt-2" data-testid="triggers">
      <span className="text-xs font-medium text-muted">Routing triggers</span>
      <ul className="mt-1 flex flex-col gap-1 text-xs">
        {run.triggers.map((t) => {
          const { label, detail } = triggerCopy(t);
          return (
            <li key={t} className="flex flex-wrap items-center gap-2">
              <Badge tone="warn">{label}</Badge>
              <span className="text-ink">{detail}</span>
              <span className="text-muted">from the City GIS layer snapshot pinned to this run · parcel record retrieved {fmtDate(run.provenance.parcel_retrieved_at)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
