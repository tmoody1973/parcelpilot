import type { Envelope } from "./http.ts";
import type { FeasibilityRun, GeocodeSuggestion, Project, ProjectDetail, ResolveResult, Scenario, ScenarioInputs } from "./dto.ts";
import type { ApproveResult, AuditRef, ReviewTask, SourceSummary, TaskDetail } from "./review-dto.ts";
import type { ResolveInputBody } from "./validation.ts";
import type { GoldComparison } from "@parcelpilot/db";
import type { ShadowMetrics } from "@parcelpilot/zoning-core";

// Browser-side wrapper over the route handlers. Unwraps the { ok, data, error } envelope and throws on failure.

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!body) throw new ApiClientError("bad_response", `request failed (${res.status})`, res.status);
  if (!body.ok) throw new ApiClientError(body.error.code, body.error.message, res.status);
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
  // Reviewer workbench (role-gated server-side; a 403 here means "reviewer role required").
  listReviewTasks: (q: { status?: string; type?: string; district?: string } = {}) => fetch(`/api/review/tasks?${new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][])}`).then((r) => unwrap<ReviewTask[]>(r)),
  getReviewTask: (id: string) => fetch(`/api/review/tasks/${id}`).then((r) => unwrap<TaskDetail>(r)),
  claimTask: (id: string) => postJson(`/api/review/tasks/${id}/claim`, {}).then((r) => unwrap<ReviewTask>(r)),
  approveTask: (id: string) => postJson(`/api/review/tasks/${id}/approve`, {}).then((r) => unwrap<ApproveResult>(r)),
  rejectTask: (id: string, reason: string) => postJson(`/api/review/tasks/${id}/reject`, { reason }).then((r) => unwrap<ReviewTask>(r)),
  editTask: (id: string, reason: string, patch: Record<string, unknown>) => postJson(`/api/review/tasks/${id}/edit`, { reason, patch }).then((r) => unwrap<ReviewTask>(r)),
  listSources: () => fetch("/api/review/sources").then((r) => unwrap<SourceSummary[]>(r)),
  listGoldDecisions: () => fetch("/api/review/decisions").then((r) => unwrap<{ rows: GoldComparison[]; metrics: ShadowMetrics }>(r)),
  transitionSource: (id: string, action: "activate" | "supersede" | "withdraw", body: { successor_id?: string; reason?: string }) => postJson(`/api/review/sources/${id}/${action}`, body).then((r) => unwrap<{ id: string; status: string; effective_end: string | null; audit: AuditRef }>(r)),
};
