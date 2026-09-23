"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GoldComparison } from "@parcelpilot/db";
import type { ShadowMetrics } from "@parcelpilot/zoning-core";
import { api } from "../../../lib/api-client.ts";
import { GatePage, LoadError, isForbidden } from "../../../components/review-gate.tsx";
import { Badge, Card, CardHeader, Empty } from "../../../components/ui.tsx";

// JEV in shadow over the gold set (MOO-840; 05 §9): where JEV agrees or disagrees with the rules table and the expert.
// JEV never changes a status in shadow mode. Rows wrap at 390 px rather than scroll sideways.

const route = (r: string | null) => (r ? r.replaceAll("_", " ") : "—");
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(100 * x)}%`);
const PROCEED = "proceed_to_concept_design";

export function DecisionsView() {
  const [data, setData] = useState<{ rows: GoldComparison[]; metrics: ShadowMetrics } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api.listGoldDecisions().then(setData).catch(setError); }, []);

  if (isForbidden(error)) return <GatePage />;
  if (error) return <LoadError error={error} />;
  if (!data) return <Empty>Loading…</Empty>;
  const m = data.metrics;
  const metrics: [string, string, boolean?][] = [
    ["Unsafe-permissive (must be 0)", String(m.unsafe_permissive), m.unsafe_permissive > 0],
    ["JEV answered", `${m.jev_ok} of ${m.cases}`],
    ["Agrees with rules-only", pct(m.agree_rules_only)],
    ["Agrees with expert", pct(m.agree_expert)],
    [`Recall on high-risk (${m.high_risk_cases})`, pct(m.high_risk_recall)],
    ["p95 JEV latency", m.p95_jev_latency_ms === null ? "n/a" : `${m.p95_jev_latency_ms} ms`],
    ["JEV cost per case", m.jev_cost_per_case_usd === null ? "n/a" : `$${m.jev_cost_per_case_usd.toFixed(5)}`],
    ["Brief cost per case", m.brief_cost_per_case_usd === null ? "n/a" : `$${m.brief_cost_per_case_usd.toFixed(3)}`],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Decisions in shadow</h1>
          <p className="text-xs text-muted">The gold set, run by <code>pnpm decision:gold</code>. JEV is asked after each run is locked and its answer is only logged; the rules table sets every status.</p>
        </div>
        <Link href="/review" className="text-sm text-accent no-underline">← Review queue</Link>
      </div>
      {data.rows.length === 0 ? <Empty>No gold runs yet. Run <code>pnpm decision:gold</code>.</Empty> : (
        <>
          <Card>
            <CardHeader title="Metrics" subtitle="05 §9. Calibration and repeat consistency come in M6." />
            <dl className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4" data-testid="decision-metrics">
              {metrics.map(([k, v, bad]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className={bad ? "text-base font-semibold text-red-700" : "text-base font-semibold text-ink"}>{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Per case" subtitle="Latest run of each gold case." />
            <ul className="divide-y divide-line" data-testid="decision-rows">
              {data.rows.map((r) => {
                const unsafe = r.jev_route === PROCEED && (r.rules_route !== PROCEED || r.expert_route !== PROCEED);
                return (
                  <li key={r.case_id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-sm">
                    <span className="w-10 font-semibold text-ink">{r.case_id}</span>
                    <span className="min-w-40"><span className="text-xs text-muted">Rules </span>{route(r.rules_route)}</span>
                    <span className="min-w-48"><span className="text-xs text-muted">JEV </span>{r.jev_status === "ok" ? `${route(r.jev_route)} (${r.jev_confidence?.toFixed(2)})` : `no answer${r.jev_error ? `: ${r.jev_error}` : ""}`}</span>
                    <span className="min-w-40"><span className="text-xs text-muted">Expert </span>{route(r.expert_route)}</span>
                    <span className="flex flex-wrap gap-1">
                      {unsafe ? <Badge tone="danger">unsafe-permissive</Badge> : null}
                      {r.jev_status === "ok" ? <Badge tone={r.jev_route === r.rules_route ? "ok" : "warn"}>{r.jev_route === r.rules_route ? "agrees with rules" : "differs from rules"}</Badge> : null}
                      {r.jev_status === "ok" ? <Badge tone={r.jev_route === r.expert_route ? "ok" : "warn"}>{r.jev_route === r.expert_route ? "agrees with expert" : "differs from expert"}</Badge> : null}
                      <Badge tone={r.brief_outcome === "validated" ? "ok" : "neutral"}>{r.brief_outcome === "validated" ? "brief validated" : r.brief_outcome === "fallback" ? "template brief" : "no brief"}</Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
