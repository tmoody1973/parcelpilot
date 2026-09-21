import { and, eq } from "drizzle-orm";
import { scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField, withTenant } from "../../../../lib/http.ts";
import { parseScenarioInputs, toColumns } from "../../../../lib/scenario-input.ts";
import { scenarioDto } from "../../../../lib/projects-dto.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ scenarioId: string }> };

export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  const [scenario] = await withOrg(appDb(), ctx.orgId, (tx) => tx.select().from(scenarios).where(eq(scenarios.id, scenarioId)));
  if (!scenario) return fail("not_found", "scenario not found", 404);
  return ok(scenarioDto(scenario));
});

// Draft-only: a scored scenario (status ≠ draft, arrives with feasibility runs) is never edited in place.
export const PATCH = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  const rawInputs = (body as { inputs?: unknown })?.inputs;
  if (!name && rawInputs === undefined) return fail("invalid_input", "nothing to update", 400);
  const result = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [current] = await tx.select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.status, "draft")));
    if (!current) return null;
    let cols = {};
    if (rawInputs !== undefined) {
      const parsed = parseScenarioInputs(rawInputs, "patch");
      if (!parsed.ok) return parsed.response;
      cols = toColumns({ ...(current.draftInputs as Record<string, unknown>), ...parsed.inputs });
    }
    const [updated] = await tx.update(scenarios).set({ ...(name ? { name } : {}), ...cols, updatedAt: new Date() }).where(eq(scenarios.id, scenarioId)).returning();
    return updated ?? null;
  });
  if (result instanceof Response) return result;
  if (!result) return fail("not_found", "scenario not found", 404);
  return ok(scenarioDto(result));
});
