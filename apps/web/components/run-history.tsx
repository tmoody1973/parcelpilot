import type { FeasibilityRun, Scenario } from "../lib/dto.ts";
import { STATUS_COPY } from "../lib/run-copy.ts";
import { Badge, Button } from "./ui.tsx";

// One row per saved scenario: run it, and pick which of its past runs to show. Every run is immutable, so
// history is a list of locked results, newest first.
export function RunHistory({ scenarios, runs, selectedRunId, busyScenarioId, onRun, onSelect }: {
  scenarios: Scenario[]; runs: FeasibilityRun[]; selectedRunId: string | null; busyScenarioId: string | null;
  onRun: (scenarioId: string) => void; onSelect: (runId: string) => void;
}) {
  if (scenarios.length === 0) return null;
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ul className="flex flex-col divide-y divide-line" data-testid="run-history">
      {scenarios.map((s) => {
        const mine = runs.filter((r) => r.scenario_id === s.id);
        return (
          <li key={s.id} className="flex flex-col gap-1.5 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{s.name}</span>
              <Button variant="secondary" onClick={() => onRun(s.id)} disabled={busyScenarioId === s.id} data-testid={`run-${s.id}`}>
                {busyScenarioId === s.id ? "Running…" : "Run scenario"}
              </Button>
            </div>
            {mine.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {mine.map((r) => {
                  const c = r.final_status ? STATUS_COPY[r.final_status] : null;
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => onSelect(r.id)} className={`rounded-md border px-2 py-1 text-xs ${r.id === selectedRunId ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-canvas"}`}>
                        <span className="text-muted">{fmt(r.created_at)}</span>{" "}
                        {c ? <Badge tone={c.tone}>{c.label}</Badge> : <Badge>{r.status}</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <span className="text-xs text-muted">Not run yet.</span>}
          </li>
        );
      })}
    </ul>
  );
}
