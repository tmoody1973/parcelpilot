import "server-only";
import { createProjectStore, type ProjectRow, type ScenarioRow } from "@parcelpilot/db";
import { appSql } from "./db.ts";
import { profileForSnapshot, resolveSite } from "./parcel-service.ts";
import type { Project, ProjectDetail, Scenario } from "./dto.ts";

let cached: ReturnType<typeof createProjectStore> | undefined;
function store() {
  return (cached ??= createProjectStore(appSql()));
}

export function toProjectDto(row: ProjectRow, extra?: { parcel_address: string | null; scenario_count: number }): Project {
  return {
    id: row.id,
    parcel_taxkey: row.parcel_taxkey,
    parcel_snapshot_id: row.parcel_snapshot_id,
    parcel_address: extra?.parcel_address ?? null,
    name: row.name,
    scenario_count: extra?.scenario_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function toScenarioDto(row: ScenarioRow): Scenario {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    use: row.use,
    units: row.units,
    height_ft: row.height_ft,
    stories: row.stories,
    parking_spaces: row.parking_spaces,
    ground_floor_commercial_sqft: row.ground_floor_commercial_sqft,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function listProjects(orgId: string): Promise<Project[]> {
  return (await store().listProjects(orgId)).map((r) => toProjectDto(r, { parcel_address: r.parcel_address, scenario_count: r.scenario_count }));
}

export async function getProjectDetail(orgId: string, projectId: string): Promise<ProjectDetail | null> {
  const s = store();
  const project = await s.getProject(orgId, projectId);
  if (!project) return null;
  // The scenario list and the parcel profile are independent — fetch them together.
  const [scenarios, profile] = await Promise.all([
    s.listScenarios(orgId, projectId),
    project.parcel_snapshot_id ? profileForSnapshot(project.parcel_snapshot_id) : profileByTaxkey(project.parcel_taxkey),
  ]);
  return { project: toProjectDto(project), scenarios: scenarios.map(toScenarioDto), profile };
}

async function profileByTaxkey(taxkey: string) {
  const r = await resolveSite({ taxkey });
  return r.kind === "resolved" ? r.profile : null;
}

export { store as projectStore };
