import { listProjects, projectStore, toProjectDto } from "../../../lib/projects.ts";
import { resolveOrgContext } from "../../../lib/org.ts";
import { fail, guard, ok } from "../../../lib/http.ts";
import { newProjectSchema } from "../../../lib/validation.ts";

export async function GET(req: Request): Promise<Response> {
  return guard(async () => {
    const { orgId } = resolveOrgContext(req);
    return ok(await listProjects(orgId));
  });
}

export async function POST(req: Request): Promise<Response> {
  return guard(async () => {
    const { orgId, userId } = resolveOrgContext(req);
    const parsed = newProjectSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("invalid_input", "name and parcel_taxkey are required", 422);
    const row = await projectStore().createProject(orgId, {
      name: parsed.data.name,
      parcelTaxkey: parsed.data.parcel_taxkey,
      parcelSnapshotId: parsed.data.parcel_snapshot_id ?? null,
      createdBy: userId,
    });
    return ok(toProjectDto(row));
  });
}
