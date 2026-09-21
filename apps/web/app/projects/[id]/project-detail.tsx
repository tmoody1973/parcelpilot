"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client.ts";
import type { ProjectDetail as Detail } from "../../../lib/dto.ts";
import { ParcelMap } from "../../../components/map.tsx";
import { SiteProfilePanel } from "../../../components/site-profile.tsx";
import { ScenarioCompare } from "../../../components/scenario-compare.tsx";
import { RunPanel } from "../../../components/run-panel.tsx";
import { RunHistory } from "../../../components/run-history.tsx";
import { Card, CardHeader, Empty } from "../../../components/ui.tsx";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then((d) => { setDetail(d); setSelectedRunId(d.runs[0]?.id ?? null); }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load project."));
  }, [projectId]);

  async function runScenario(scenarioId: string) {
    setRunningId(scenarioId);
    try {
      const run = await api.runScenario(scenarioId);
      setDetail((d) => (d ? { ...d, runs: [run, ...d.runs], scenarios: d.scenarios.map((s) => (s.id === scenarioId ? { ...s, status: "scored" } : s)) } : d));
      setSelectedRunId(run.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not run the scenario.");
    } finally {
      setRunningId(null);
    }
  }

  if (error) return <Empty>{error}</Empty>;
  if (!detail) return <Empty>Loading…</Empty>;

  const { project, scenarios, profile, runs } = detail;
  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/projects" className="text-sm text-accent no-underline">
          ← All projects
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-ink">{project.name}</h1>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {profile ? (
          <>
            <Card className="h-[360px] overflow-hidden p-0">
              <ParcelMap geometry={profile.geometry} onPick={() => {}} />
            </Card>
            <SiteProfilePanel profile={profile} />
          </>
        ) : (
          <Empty>The parcel profile could not be loaded for this project.</Empty>
        )}
      </div>

      {selectedRun ? <RunPanel run={selectedRun} /> : null}

      <Card>
        <CardHeader title="Scenarios" subtitle={`${scenarios.length} saved · ${runs.length} run${runs.length === 1 ? "" : "s"}`} />
        <div className="px-4 py-3">
          <RunHistory scenarios={scenarios} runs={runs} selectedRunId={selectedRunId} busyScenarioId={runningId} onRun={runScenario} onSelect={setSelectedRunId} />
          <div className="mt-3">
            <ScenarioCompare scenarios={scenarios} runs={runs} />
          </div>
        </div>
      </Card>
    </div>
  );
}
