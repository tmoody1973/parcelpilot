"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client.ts";
import type { SourceSummary } from "../../../lib/review-dto.ts";
import { SOURCE_STATUS_COPY, auditCopy } from "../../../lib/review-copy.ts";
import { GatePage, LoadError, isForbidden } from "../../../components/review-gate.tsx";
import { Badge, Button, Card, CardHeader, Empty, Input, Select } from "../../../components/ui.tsx";

// Source documents and their lifecycle (pending → active → superseded | withdrawn). Superseding needs the
// successor; every transition takes a reason that lands in the audit row. Chunks are never edited: the served
// view filters on the document's status.

export function SourcesList() {
  const [rows, setRows] = useState<SourceSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reason, setReason] = useState("");
  const [successor, setSuccessor] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.listSources().then(setRows).catch(setError), []);
  useEffect(() => { void load(); }, [load]);

  if (isForbidden(error)) return <GatePage />;
  if (error) return <LoadError error={error} />;
  if (!rows) return <Empty>Loading…</Empty>;

  async function act(id: string, action: "activate" | "supersede" | "withdraw") {
    setMessage(null);
    if (!reason.trim()) { setMessage("State the reason first."); return; }
    if (action === "supersede" && !successor[id]) { setMessage("Pick the successor document first."); return; }
    setBusy(true);
    try {
      const r = await api.transitionSource(id, action, { reason: reason.trim(), ...(action === "supersede" ? { successor_id: successor[id] } : {}) });
      setMessage(`${auditCopy(r.audit.action)} · audit ${r.audit.id}`);
      setReason("");
      await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Action failed."); } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/review" className="text-xs text-accent no-underline">← Review queue</Link>
        <h1 className="mt-1 text-lg font-semibold text-ink">Source documents</h1>
        <p className="text-xs text-muted">A superseded or withdrawn document is never served as current; its chunks drop out of the active view without being edited.</p>
      </div>
      <Card>
        <CardHeader title="Reason for the next action" subtitle="Required for activate, supersede and withdraw; kept in the audit trail." />
        <div className="flex flex-col gap-2 px-4 py-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 2026 amendment published; this version is out of date" data-testid="source-reason" />
          {message ? <p className="text-xs text-muted" data-testid="source-message">{message}</p> : null}
        </div>
      </Card>
      <Card>
        <ul className="divide-y divide-line" data-testid="sources-list">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-3" data-testid="source-row">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{d.title}</span>
                  <span className="block text-xs text-muted">{d.source_type} · stamp {d.published_marker ?? "none"} · in force {d.effective_start ?? "?"}{d.effective_end ? ` → ${d.effective_end}` : ""} · {d.page_count ?? "?"} pages · sha {d.sha256.slice(0, 12)}</span>
                </span>
                <Badge tone={SOURCE_STATUS_COPY[d.status]?.tone ?? "neutral"}>{SOURCE_STATUS_COPY[d.status]?.label ?? d.status}</Badge>
              </div>
              {d.status === "pending_review" || d.status === "active" ? (
                <div className="flex flex-wrap items-center gap-2">
                  {d.status === "pending_review" ? <Button variant="secondary" disabled={busy} onClick={() => void act(d.id, "activate")}>Activate</Button> : null}
                  <Select className="w-auto" value={successor[d.id] ?? ""} onChange={(e) => setSuccessor({ ...successor, [d.id]: e.target.value })}>
                    <option value="">Successor…</option>
                    {rows.filter((o) => o.id !== d.id).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                  </Select>
                  <Button variant="secondary" disabled={busy} onClick={() => void act(d.id, "supersede")}>Supersede</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void act(d.id, "withdraw")}>Withdraw</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
