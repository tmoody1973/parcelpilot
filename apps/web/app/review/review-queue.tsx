"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api-client.ts";
import type { ReviewTask } from "../../lib/review-dto.ts";
import { PRIORITY_COPY, TASK_STATUS_COPY, TASK_TYPE_COPY, TASK_TYPE_ORDER } from "../../lib/review-copy.ts";
import { GatePage, LoadError, isForbidden } from "../../components/review-gate.tsx";
import { Badge, Card, CardHeader, Empty, Field, Select } from "../../components/ui.tsx";

// The queue (04 §10 step 2): open tasks grouped by type with counts, filterable by type, status and district.
// The page is desktop-first but must render at 390 px without horizontal scroll, so rows wrap rather than truncate.

const STATUS_OPTIONS = [["open", "Open (waiting + in review)"], ["unreviewed", "Waiting"], ["in_review", "In review"], ["approved", "Signed off"], ["rejected", "Rejected"], ["all", "All"]] as const; // banned-ok: enum values from the database

export function ReviewQueue() {
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string>("open");
  const [type, setType] = useState<string>("");
  const [district, setDistrict] = useState<string>("");

  useEffect(() => {
    setTasks(null);
    const q = status === "open" || status === "all" ? {} : { status };
    api.listReviewTasks({ ...q, type, district }).then((rows) => setTasks(status === "open" ? rows.filter((t) => t.status === "unreviewed" || t.status === "in_review") : rows)).catch(setError);
  }, [status, type, district]);

  const districts = useMemo(() => [...new Set((tasks ?? []).map((t) => t.subject?.district).filter((d): d is string => !!d))].sort(), [tasks]);
  const groups = useMemo(() => TASK_TYPE_ORDER.map((k) => ({ type: k, tasks: (tasks ?? []).filter((t) => t.task_type === k) })).filter((g) => g.tasks.length), [tasks]);

  if (isForbidden(error)) return <GatePage />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Review queue</h1>
          <p className="text-xs text-muted">Every item here is evidence waiting on a human. Nothing becomes a rule the screen can cite until it is signed off.</p>
        </div>
        <Link href="/review/sources" className="text-sm text-accent no-underline">Source documents →</Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="queue-filters">
        <Field label="Status"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{TASK_TYPE_ORDER.map((k) => <option key={k} value={k}>{TASK_TYPE_COPY[k]!.plural}</option>)}</Select></Field>
        <Field label="District" hint="Rule candidates only"><Select value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">All districts</option>{districts.map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
      </div>

      {error ? <LoadError error={error} /> : !tasks ? <Empty>Loading…</Empty> : groups.length === 0 ? <Empty>Nothing in the queue for these filters.</Empty> : (
        <div className="flex flex-col gap-4" data-testid="queue-groups">
          {groups.map((g) => (
            <Card key={g.type}>
              <CardHeader title={<span data-testid={`group-${g.type}`}>{TASK_TYPE_COPY[g.type]!.plural} <span className="ml-1 rounded-full bg-slate-100 px-2 text-xs text-slate-700">{g.tasks.length}</span></span>} subtitle={TASK_TYPE_COPY[g.type]!.hint} />
              <ul className="divide-y divide-line">
                {g.tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/review/tasks/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 no-underline hover:bg-accent-soft" data-testid="task-row">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{t.subject?.title ?? t.entity_type}</span>
                        <span className="block text-xs text-muted">
                          {t.subject?.document ?? ""}{t.subject?.page ? ` · p. ${t.subject.printed_page ?? t.subject.page}` : ""}{t.reason ? ` · ${t.reason}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {t.subject?.district ? <Badge tone="accent">{t.subject.district}</Badge> : null}
                        {t.priority ? <Badge tone={PRIORITY_COPY[t.priority]?.tone ?? "neutral"}>{PRIORITY_COPY[t.priority]?.label ?? t.priority}</Badge> : null}
                        <Badge tone={TASK_STATUS_COPY[t.status]?.tone ?? "neutral"}>{TASK_STATUS_COPY[t.status]?.label ?? t.status}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
