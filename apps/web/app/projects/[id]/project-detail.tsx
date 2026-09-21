"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client.ts";
import type { ProjectDetail as Detail } from "../../../lib/dto.ts";
import { ParcelMap } from "../../../components/map.tsx";
import { SiteProfilePanel } from "../../../components/site-profile.tsx";
import { ScenarioCompare } from "../../../components/scenario-compare.tsx";
import { Card, CardHeader, Empty } from "../../../components/ui.tsx";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setDetail).catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load project."));
  }, [projectId]);

  if (error) return <Empty>{error}</Empty>;
  if (!detail) return <Empty>Loading…</Empty>;

  const { project, scenarios, profile } = detail;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/projects" className="text-sm text-accent no-underline">
          ← All projects
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-ink">{project.name}</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

      <Card>
        <CardHeader title="Scenarios" subtitle={`${scenarios.length} saved`} />
        <div className="px-4 py-3">
          <ScenarioCompare scenarios={scenarios} />
        </div>
      </Card>
    </div>
  );
}
