import "server-only";
import { createProjectStore, type ProjectListRow, type ProjectRow, type ScenarioRow } from "@parcelpilot/db";
import { appSql } from "./db.ts";
import { profileForSnapshot, resolveSite } from "./parcel-service.ts";
import type { Project, ProjectDetail, Scenario } from "./dto.ts";

function store() {
  return createProjectStore(appSql());
}

export function toProjectDto(row: ProjectListRow | (ProjectRow & { parcel_address?: string | null; scenario_count?: number })): Project {
  return {
    id: row.id,
    parcel_taxkey: row.parcel_taxkey,
    parcel_snapshot_id: row.parcel_snapshot_id,
    parcel_address: "parcel_address" in row ? row.parcel_address ?? null : null,
    name: row.name,
    scenario_count: "scenario_count" in row ? Number(row.scenario_count ?? 0) : 0,
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
  return (await store().listProjects(orgId)).map(toProjectDto);
}

export async function getProjectDetail(orgId: string, projectId: string): Promise<ProjectDetail | null> {
  const s = store();
  const project = await s.getProject(orgId, projectId);
  if (!project) return null;
  const scenarios = await s.listScenarios(orgId, projectId);
  const profile = project.parcel_snapshot_id
    ? await profileForSnapshot(project.parcel_snapshot_id)
    : await profileByTaxkey(project.parcel_taxkey);
  return { project: toProjectDto(project), scenarios: scenarios.map(toScenarioDto), profile };
}

async function profileByTaxkey(taxkey: string) {
  const r = await resolveSite({ taxkey });
  return r.kind === "resolved" ? r.profile : null;
}

export { store as projectStore };
