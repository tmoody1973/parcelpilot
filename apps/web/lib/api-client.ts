import type { Envelope } from "./http.ts";
import type { FeasibilityRun, GeocodeSuggestion, Project, ProjectDetail, ResolveResult, Scenario, ScenarioInputs } from "./dto.ts";
import type { ResolveInputBody } from "./validation.ts";

// Browser-side wrapper over the route handlers. Unwraps the { ok, data, error } envelope and throws on failure.

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as Envelope<T>;
  if (!body.ok) throw new Error(body.error.message);
  return body.data;
}

function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export type NewScenarioInput = { name: string; inputs: ScenarioInputs };

export const api = {
  geocode: (q: string) => fetch(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => unwrap<GeocodeSuggestion[]>(r)),
  resolve: (input: ResolveInputBody) => postJson("/api/parcels/resolve", input).then((r) => unwrap<ResolveResult>(r)),
  listProjects: () => fetch("/api/projects").then((r) => unwrap<Project[]>(r)),
  createProject: (body: { name: string; parcel_taxkey: string; parcel_snapshot_id?: string | null }) => postJson("/api/projects", body).then((r) => unwrap<Project>(r)),
  getProject: (id: string) => fetch(`/api/projects/${id}`).then((r) => unwrap<ProjectDetail>(r)),
  listScenarios: (id: string) => fetch(`/api/projects/${id}/scenarios`).then((r) => unwrap<Scenario[]>(r)),
  createScenario: (id: string, body: NewScenarioInput) => postJson(`/api/projects/${id}/scenarios`, body).then((r) => unwrap<Scenario>(r)),
  runScenario: (id: string) => postJson(`/api/scenarios/${id}/run`, {}).then((r) => unwrap<FeasibilityRun>(r)),
  listRuns: (scenarioId: string) => fetch(`/api/scenarios/${scenarioId}/runs`).then((r) => unwrap<FeasibilityRun[]>(r)),
  getRun: (id: string) => fetch(`/api/runs/${id}`).then((r) => unwrap<FeasibilityRun>(r)),
};
