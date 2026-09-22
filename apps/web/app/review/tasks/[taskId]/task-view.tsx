"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../../lib/api-client.ts";
import type { ApproveResult, AuditRef, ReviewTask, TaskDetail } from "../../../../lib/review-dto.ts";
import { PRIORITY_COPY, TASK_STATUS_COPY, TASK_TYPE_COPY, auditCopy } from "../../../../lib/review-copy.ts";
import { GatePage, LoadError, isForbidden } from "../../../../components/review-gate.tsx";
import { PageViewer } from "../../../../components/page-viewer.tsx";
import { CandidateEditor } from "../../../../components/candidate-editor.tsx";
import { MergeView } from "../../../../components/merge-view.tsx";
import { Badge, Button, Card, CardHeader, Empty, Input } from "../../../../components/ui.tsx";

// One task on screen (04 §10 step 2): what the machine pulled, where on the page it came from, and the three
// reviewer actions. Approve needs nothing; edit and reject need a reason. The result of every action is the
// audit row the server wrote, shown verbatim so the reviewer sees what was recorded.

type Outcome = { kind: "ok"; audit: AuditRef | undefined; rule?: ApproveResult["rule"] | undefined; pending?: boolean | undefined; task: ReviewTask } | { kind: "error"; message: string };

export function TaskView({ taskId }: { taskId: string }) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(() => api.getReviewTask(taskId).then(setDetail).catch(setError), [taskId]);
  useEffect(() => { setDetail(null); setError(null); setOutcome(null); setReason(""); void load(); }, [load]); // a new task id must never show the previous task's state

  if (isForbidden(error)) return <GatePage />;
  if (error) return <LoadError error={error} />;
  if (!detail) return <Empty>Loading…</Empty>;

  const { task } = detail;
  const open = task.status === "unreviewed" || task.status === "in_review";
  const isCandidate = detail.kind === "rule_candidate_review";

  async function act(fn: () => Promise<Outcome>) {
    setBusy(true); setOutcome(null);
    try { setOutcome(await fn()); await load(); } catch (e) { setOutcome({ kind: "error", message: e instanceof Error ? e.message : "Action failed." }); } finally { setBusy(false); }
  }
  const approve = () => act(async (): Promise<Outcome> => { const r = await api.approveTask(taskId); return { kind: "ok", audit: r.task.audit, rule: r.rule, pending: r.pending_second_approval, task: r.task }; });
  const reject = () => {
    if (!reason.trim()) { setOutcome({ kind: "error", message: "A rejection needs a stated reason." }); return; }
    return act(async (): Promise<Outcome> => { const t = await api.rejectTask(taskId, reason.trim()); setReason(""); return { kind: "ok", audit: t.audit, task: t }; });
  };
  const claim = () => act(async (): Promise<Outcome> => { const t = await api.claimTask(taskId); return { kind: "ok", audit: t.audit, task: t }; });

  const typeCopy = TASK_TYPE_COPY[task.task_type];
  const approveLabel = isCandidate ? "Approve rule" : detail.kind === "merge_review" ? "Approve merge" : "Mark reviewed";
  const rejectLabel = isCandidate || detail.kind === "merge_review" ? "Reject" : "Flag";

  return (
    <div className="flex flex-col gap-4" data-testid="task-view" data-task-type={task.task_type}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/review" className="text-xs text-accent no-underline">← Review queue</Link>
          <h1 className="mt-1 text-lg font-semibold text-ink">{typeCopy?.label ?? task.task_type}: {task.subject?.title ?? task.entity_id}</h1>
          <p className="text-xs text-muted">{typeCopy?.hint}{task.reason ? ` · ${task.reason}` : ""}</p>
        </div>
        <span className="flex items-center gap-2">
          {task.priority ? <Badge tone={PRIORITY_COPY[task.priority]?.tone ?? "neutral"}>{PRIORITY_COPY[task.priority]?.label ?? task.priority}</Badge> : null}
          <Badge tone={TASK_STATUS_COPY[task.status]?.tone ?? "neutral"}>{TASK_STATUS_COPY[task.status]?.label ?? task.status}</Badge>
        </span>
      </div>

      {outcome ? (
        outcome.kind === "error"
          ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="action-error">{outcome.message}</p>
          : (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="action-success">
              <p className="font-medium">{outcome.pending ? "First sign-off recorded. An owner's sign-off is still needed before this becomes a rule." : outcome.rule ? `Recorded as rule version ${outcome.rule.version}${outcome.rule.supersedes_id ? " (supersedes the previous version)" : ""}.` : "Recorded."}</p>
              {outcome.audit ? <p className="mt-1 font-mono text-xs" data-testid="audit-line">audit {outcome.audit.action} · {auditCopy(outcome.audit.action)} · {new Date(outcome.audit.created_at).toLocaleString()} · {outcome.audit.id}</p> : null}
              {outcome.rule ? <p className="mt-1 font-mono text-xs" data-testid="rule-line">zoning_rules {outcome.rule.id} · family {outcome.rule.family_id} · v{outcome.rule.version}</p> : null}
            </div>
          )
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="task-body">
        <div className="min-w-0">
          {detail.kind === "rule_candidate_review" ? <PageViewer page={detail.page} boxes={(detail.row?.sources ?? []).filter((s) => s.page === detail.page?.page_number).map((s) => ({ bbox: s.bbox, label: detail.row?.label }))} /> : null}
          {detail.kind === "merge_review" ? <MergeView fragments={detail.fragments} columns={detail.table.columns} /> : null}
          {detail.kind === "page_review" ? <PageViewer page={detail.page} caption={`${detail.document} · PDF page ${detail.page.page_number}`} /> : null}
          {detail.kind === "footnote_review" ? <PageViewer page={detail.page} /> : null}
          {detail.kind === "other" ? <Empty>This task type has no viewer yet.</Empty> : null}
          <p className="mt-2 text-xs text-muted lg:hidden">The page viewer is easier on a desktop-sized screen.</p>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {detail.kind === "rule_candidate_review" ? <CandidateSide detail={detail} viewerRole={detail.viewer_role} open={open} busy={busy} taskId={taskId} onEdited={(t) => { setOutcome({ kind: "ok", audit: t.audit, task: t }); void load(); }} /> : null}
          {detail.kind === "merge_review" ? (
            <Card><CardHeader title="Table family" subtitle={`${detail.table.family_key} · pages ${detail.table.page_start}–${detail.table.page_end} · ${detail.table.row_count} canonical rows · merge status ${TASK_STATUS_COPY[detail.table.merge_review_status]?.label ?? detail.table.merge_review_status}`} />
              <p className="px-4 py-3 text-sm text-muted">Approving the merge lets rule candidates be drawn from this table's rows. Rejecting closes the family; a corrected extraction is a new table.</p></Card>
          ) : null}
          {detail.kind === "footnote_review" ? (
            <Card><CardHeader title={`Footnote ${detail.footnote.marker}`} subtitle={detail.table.family_key} />
              <div className="px-4 py-3 text-sm"><p className="text-ink">{detail.footnote.text}</p><p className="mt-2 text-xs text-muted">Applies to rows: {detail.footnote.applies_to_row_keys?.length ? detail.footnote.applies_to_row_keys.join(", ") : "none attached yet"}</p></div></Card>
          ) : null}
          {detail.kind === "page_review" ? <Card><CardHeader title="Page check" subtitle={task.reason ?? undefined} /><p className="px-4 py-3 text-sm text-muted">Compare the extracted text with the image. Mark reviewed if they match; flag with a reason if they do not.</p></Card> : null}

          <Card>
            <CardHeader title="Decision" subtitle={open ? (task.status === "unreviewed" ? "Claim the task to mark it in review, or act directly." : "In review.") : `This task is closed (${TASK_STATUS_COPY[task.status]?.label ?? task.status}).`} />
            <div className="flex flex-col gap-3 px-4 py-3">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Reason (required to ${rejectLabel.toLowerCase()})`} disabled={!open || busy} data-testid="reason-input" />
              <div className="flex flex-wrap gap-2">
                {task.status === "unreviewed" ? <Button variant="secondary" onClick={() => void claim()} disabled={!open || busy} data-testid="claim-button">Claim</Button> : null}
                <Button onClick={() => void approve()} disabled={!open || busy} data-testid="approve-button">{approveLabel}</Button>
                <Button variant="secondary" onClick={() => void reject()} disabled={!open || busy} data-testid="reject-button">{rejectLabel}</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function CandidateSide({ detail, viewerRole, open, busy, taskId, onEdited }: { detail: Extract<TaskDetail, { kind: "rule_candidate_review" }>; viewerRole: string; open: boolean; busy: boolean; taskId: string; onEdited: (t: ReviewTask) => void }) {
  const { candidate, row, table, footnotes, citations } = detail;
  const suggested = typeof candidate.proposed_rule["label_suggested_by"] === "string"; // slot for an LLM-suggested label (M4+); flagged visibly if ever present
  return (
    <>
      <Card>
        <CardHeader title={<span>Extracted row {suggested ? <Badge tone="warn">suggested label</Badge> : null}</span>} subtitle={row ? `${table?.family_key ?? ""} · row ${row.row_key} · extracted by ${candidate.extraction_method}` : "No table row is linked to this candidate."} />
        {row ? (
          <div className="px-4 py-3 text-sm" data-testid="extracted-row">
            <p className="font-medium text-ink">{row.label}{row.group ? <span className="ml-2 text-xs font-normal text-muted">({row.group})</span> : null}</p>
            <p className="text-xs text-muted">unit: {row.unit ?? "none"}</p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>{Object.keys(row.cells).map((d) => <th key={d} className={`px-2 py-1 text-left ${d === candidate.district_code ? "bg-accent-soft text-accent" : "text-muted"}`}>{d}</th>)}</tr></thead>
                <tbody><tr>{Object.entries(row.cells).map(([d, v]) => <td key={d} className={`px-2 py-1 font-mono ${d === candidate.district_code ? "bg-accent-soft font-semibold" : ""}`} data-testid={`cell-${d}`}>{v || "·"}{row.markers[d] ? <sup>{row.markers[d]}</sup> : null}</td>)}</tr></tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">Raw value as pulled: <code>{JSON.stringify(candidate.extracted_value)}</code></p>
          </div>
        ) : null}
        <div className="border-t border-line px-4 py-3 text-sm" data-testid="footnotes">
          <p className="text-xs font-medium text-muted">Linked footnotes</p>
          {footnotes.length ? <ul className="mt-1 flex flex-col gap-1">{footnotes.map((n, i) => <li key={i}><span className="mr-1 font-mono">{n.marker}</span>{n.text}{n.page_number ? <span className="ml-1 text-xs text-muted">(p. {n.page_number})</span> : null}</li>)}</ul> : <p className="text-xs text-muted">None attached to this row.</p>}
        </div>
        <div className="border-t border-line px-4 py-3 text-sm" data-testid="citations">
          <p className="text-xs font-medium text-muted">Citations the rule will carry</p>
          {citations.length ? <ul className="mt-1 flex flex-col gap-1 text-xs">{citations.map((c) => <li key={c.id}>{c.document} · p. {c.printed_page ?? c.page_number}{c.section ? ` · ${c.section}` : ""} · “{c.excerpt}”</li>)}</ul> : <p className="text-xs text-warn">No citation yet; approval will be refused until one is attached.</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Proposed rule" subtitle={`family ${candidate.family_id}${candidate.reviewer_notes ? ` · last note: ${candidate.reviewer_notes}` : ""}`} />
        <div className="px-4 py-3">
          <CandidateEditor key={candidate.id} proposal={candidate.proposed_rule} canLowerCriticality={viewerRole === "owner"} disabled={!open || busy} onSave={async (patch, reason) => onEdited(await api.editTask(taskId, reason, patch))} />
        </div>
      </Card>
    </>
  );
}
