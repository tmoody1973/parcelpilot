import { projectStore, toScenarioDto } from "../../../../../lib/projects.ts";
import { resolveOrgContext } from "../../../../../lib/org.ts";
import { fail, guard, ok } from "../../../../../lib/http.ts";
import { newScenarioSchema } from "../../../../../lib/validation.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return guard(async () => {
    const { id } = await params;
    const { orgId } = resolveOrgContext(req);
    return ok((await projectStore().listScenarios(orgId, id)).map(toScenarioDto));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return guard(async () => {
    const { id } = await params;
    const { orgId, userId } = resolveOrgContext(req);
    const parsed = newScenarioSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail("invalid_input", "scenario name is required", 422);
    const d = parsed.data;
    const row = await projectStore().createScenario(orgId, id, {
      name: d.name,
      use: d.use ?? null,
      units: d.units ?? null,
      heightFt: d.height_ft ?? null,
      stories: d.stories ?? null,
      parkingSpaces: d.parking_spaces ?? null,
      groundFloorCommercialSqft: d.ground_floor_commercial_sqft ?? null,
      draftInputs: d.draft_inputs ?? {},
      createdBy: userId,
    });
    if (!row) return fail("not_found", "project not found", 404);
    return ok(toScenarioDto(row));
  });
}
