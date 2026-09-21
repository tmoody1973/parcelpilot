"use client";

import { useState } from "react";
import Link from "next/link";
import { api, type NewScenarioInput } from "../lib/api-client.ts";
import type { Project, ResolveResult, Scenario } from "../lib/dto.ts";
import type { ResolveInputBody } from "../lib/validation.ts";
import { ParcelMap } from "../components/map.tsx";
import { SearchBar } from "../components/search-bar.tsx";
import { SiteProfilePanel } from "../components/site-profile.tsx";
import { CandidatePicker } from "../components/candidate-picker.tsx";
import { ScenarioForm } from "../components/scenario-form.tsx";
import { ScenarioCompare } from "../components/scenario-compare.tsx";
import { Button, Card, CardHeader, Empty } from "../components/ui.tsx";

const NOT_FOUND_COPY: Record<string, string> = {
  no_geocode_match: "No Milwaukee address matched that search. Check the spelling or try the map.",
  no_parcel_at_point: "No parcel sits under that point. Click inside a parcel outline.",
  unknown_taxkey: "No parcel has that TAXKEY. Confirm the 10-digit number.",
};

export function Workspace() {
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [saving, setSaving] = useState(false);

  const profile = result?.kind === "resolved" ? result.profile : null;

  async function doResolve(input: ResolveInputBody) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.resolve(input);
      setResult(res);
      // A newly resolved parcel starts a fresh project context.
      if (res.kind === "resolved") {
        setProject(null);
        setScenarios([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong resolving the parcel.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveScenario(input: NewScenarioInput) {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      let current = project;
      if (!current) {
        current = await api.createProject({
          name: profile.address || `Parcel ${profile.taxkey}`,
          parcel_taxkey: profile.taxkey,
          parcel_snapshot_id: profile.snapshot_id,
        });
        setProject(current);
      }
      const scenario = await api.createScenario(current.id, input);
      setScenarios((prev) => [...prev, scenario]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the scenario.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid gap-4 p-4 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Find a parcel" subtitle="Search by address or TAXKEY, or click the map." />
          <div className="px-4 py-3">
            <SearchBar onResolve={doResolve} busy={busy} />
          </div>
        </Card>
        <Card className="h-[540px] overflow-hidden p-0">
          <ParcelMap geometry={profile?.geometry ?? null} features={profile?.gis_features ?? []} onPick={(point) => doResolve({ point })} />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        {error ? (
          <div role="alert" className="rounded-md border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
            {error}
          </div>
        ) : null}

        {result?.kind === "ambiguous" ? (
          <CandidatePicker candidates={result.candidates} onSelect={(taxkey) => doResolve({ taxkey })} />
        ) : null}

        {result?.kind === "not_found" ? (
          <Empty>{NOT_FOUND_COPY[result.reason] ?? "No parcel found."}</Empty>
        ) : null}

        {profile ? (
          <>
            <SiteProfilePanel profile={profile} />
            <Card>
              <CardHeader
                title="New scenario"
                subtitle="Draft a development concept. Saving stores it as a draft — no scoring yet."
              />
              <ScenarioForm onSubmit={saveScenario} busy={saving} />
            </Card>
            <Card>
              <CardHeader
                title="Scenarios"
                subtitle={project ? `Saved to project “${project.name}”` : "Save a scenario to create a project."}
                action={project ? (
                  <Link href={`/projects/${project.id}`} className="text-sm text-accent no-underline">
                    Open project →
                  </Link>
                ) : undefined}
              />
              <div className="px-4 py-3">
                <ScenarioCompare scenarios={scenarios} />
              </div>
            </Card>
          </>
        ) : result ? null : (
          <Empty>Find a parcel to see its site profile and start a scenario.</Empty>
        )}

        <div>
          <Link href="/projects">
            <Button variant="secondary">View saved projects</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
