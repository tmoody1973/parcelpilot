import type postgres from "postgres";

// Tenant-scoped store for projects and scenarios (docs/planning/03_data_model.md §4.2).
// Every call runs inside a transaction that sets app.org_id, so Row Level Security scopes
// the rows to one org. Pass the app connection (DATABASE_APP_URL); the service connection
// bypasses RLS and must not be used here.

export const DEMO_ORG_ID = "00000000-0000-0000-0000-0000000000d1";
export const DEMO_USER_ID = "00000000-0000-0000-0000-0000000000d2";

export type ProjectRow = {
  id: string;
  org_id: string;
  parcel_taxkey: string;
  parcel_snapshot_id: string | null;
  name: string;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectListRow = ProjectRow & { parcel_address: string | null; scenario_count: number };

export type ScenarioRow = {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  use: string | null;
  units: number | null;
  height_ft: number | null;
  stories: number | null;
  parking_spaces: number | null;
  ground_floor_commercial_sqft: number | null;
  draft_inputs: Record<string, unknown>;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NewProject = { parcelTaxkey: string; parcelSnapshotId?: string | null; name: string; createdBy?: string | null };
export type NewScenario = {
  name: string;
  use?: string | null;
  units?: number | null;
  heightFt?: number | null;
  stories?: number | null;
  parkingSpaces?: number | null;
  groundFloorCommercialSqft?: number | null;
  draftInputs?: Record<string, unknown>;
  createdBy?: string | null;
};

const SCENARIO_COLS = "id, org_id, project_id, name, use, units, height_ft::float8 as height_ft, stories, parking_spaces, ground_floor_commercial_sqft::float8 as ground_floor_commercial_sqft, draft_inputs, status, created_by, created_at, updated_at";

// Runs `fn` inside a transaction with app.org_id set for RLS (mirrors withOrg in client.ts but for a raw postgres.Sql).
function withOrgTx<T>(sql: postgres.Sql, orgId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export function createProjectStore(sql: postgres.Sql) {
  return {
    async createProject(orgId: string, input: NewProject): Promise<ProjectRow> {
      return withOrgTx(sql, orgId, async (tx) => {
        const [row] = await tx<ProjectRow[]>`
          insert into projects (org_id, parcel_taxkey, parcel_snapshot_id, name, created_by)
          values (${orgId}, ${input.parcelTaxkey}, ${input.parcelSnapshotId ?? null}, ${input.name}, ${input.createdBy ?? null})
          returning *`;
        return row!;
      });
    },

    async listProjects(orgId: string): Promise<ProjectListRow[]> {
      return withOrgTx(sql, orgId, (tx) => tx<ProjectListRow[]>`
        select p.*, ps.address as parcel_address, count(s.id)::int as scenario_count
        from projects p
        left join parcel_snapshots ps on ps.id = p.parcel_snapshot_id
        left join scenarios s on s.project_id = p.id
        where p.archived_at is null
        group by p.id, ps.address
        order by p.updated_at desc`);
    },

    async getProject(orgId: string, id: string): Promise<ProjectRow | null> {
      return withOrgTx(sql, orgId, async (tx) => {
        const rows = await tx<ProjectRow[]>`select * from projects where id = ${id}`;
        return rows[0] ?? null;
      });
    },

    async createScenario(orgId: string, projectId: string, input: NewScenario): Promise<ScenarioRow | null> {
      return withOrgTx(sql, orgId, async (tx) => {
        // RLS on the WITH CHECK guarantees the project belongs to this org; confirm it exists first for a clean 404.
        const owner = await tx<{ id: string }[]>`select id from projects where id = ${projectId}`;
        if (owner.length === 0) return null;
        const [row] = await tx<ScenarioRow[]>`
          insert into scenarios (org_id, project_id, name, use, units, height_ft, stories, parking_spaces, ground_floor_commercial_sqft, draft_inputs, created_by)
          values (${orgId}, ${projectId}, ${input.name}, ${input.use ?? null}, ${input.units ?? null}, ${input.heightFt ?? null},
                  ${input.stories ?? null}, ${input.parkingSpaces ?? null}, ${input.groundFloorCommercialSqft ?? null},
                  ${tx.json((input.draftInputs ?? {}) as never)}, ${input.createdBy ?? null})
          returning ${tx.unsafe(SCENARIO_COLS)}`;
        await tx`update projects set updated_at = now() where id = ${projectId}`;
        return row!;
      });
    },

    async listScenarios(orgId: string, projectId: string): Promise<ScenarioRow[]> {
      return withOrgTx(sql, orgId, (tx) => tx<ScenarioRow[]>`
        select ${tx.unsafe(SCENARIO_COLS)} from scenarios where project_id = ${projectId} order by created_at asc`);
    },

    async getScenario(orgId: string, id: string): Promise<ScenarioRow | null> {
      return withOrgTx(sql, orgId, async (tx) => {
        const rows = await tx<ScenarioRow[]>`select ${tx.unsafe(SCENARIO_COLS)} from scenarios where id = ${id}`;
        return rows[0] ?? null;
      });
    },
  };
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
