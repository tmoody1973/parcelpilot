"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api-client.ts";
import type { Project } from "../../lib/dto.ts";
import { Card, Empty } from "../../components/ui.tsx";

export function ProjectsList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProjects().then(setProjects).catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load projects."));
  }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!projects) return <Empty>Loading…</Empty>;
  if (projects.length === 0) return <Empty>No projects yet. Find a parcel and save a scenario to create one.</Empty>;

  return (
    <Card>
      <ul className="divide-y divide-line" data-testid="projects-list">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 no-underline hover:bg-accent-soft">
              <span>
                <span className="font-medium text-ink">{p.name}</span>
                <span className="block text-xs text-muted">
                  {p.parcel_address ?? `TAXKEY ${p.parcel_taxkey}`} · {p.scenario_count} scenario{p.scenario_count === 1 ? "" : "s"}
                </span>
              </span>
              <span className="text-xs text-muted">{new Date(p.updated_at).toLocaleDateString()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
