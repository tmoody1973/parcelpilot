import "server-only";
import type { projects, scenarios } from "@parcelpilot/db";
import { serviceSql } from "./db.ts";
import type { Project, Scenario } from "./dto.ts";

type ProjectRow = typeof projects.$inferSelect;
type ScenarioRow = typeof scenarios.$inferSelect;

// Wire shapes are snake_case (docs/planning contracts); database rows are drizzle camelCase. Map here, once.
export async function projectDto(row: ProjectRow, scenarioCount: number | null): Promise<Project> {
  let address: string | null = null;
  if (row.parcelTaxkey) {
    const r = await serviceSql()<{ address: string }[]>`select address from parcel_snapshots where taxkey = ${row.parcelTaxkey} order by retrieved_at desc limit 1`;
    address = r[0]?.address ?? null;
  }
  return { id: row.id, parcel_taxkey: row.parcelTaxkey ?? "", parcel_snapshot_id: null, parcel_address: address, name: row.name, scenario_count: scenarioCount ?? 0, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() };
}

export function scenarioDto(row: ScenarioRow): Scenario {
  return { id: row.id, project_id: row.projectId, name: row.name, status: row.status, inputs: row.draftInputs as Scenario["inputs"], created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() };
}
