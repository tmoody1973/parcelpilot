import { desc, eq } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField, withTenant } from "../../../../../lib/http.ts";
import { parseScenarioInputs, toColumns } from "../../../../../lib/scenario-input.ts";
import { scenarioDto } from "../../../../../lib/projects-dto.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ projectId: string }> };

export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { projectId } = await params;
  const rows = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    return tx.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(desc(scenarios.updatedAt));
  });
  if (rows === null) return fail("not_found", "project not found", 404);
  return ok(rows.map(scenarioDto));
});

// Creates a draft scenario inside a project the caller owns. Inputs are validated against contracts.ScenarioInputs.
export const POST = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { projectId } = await params;
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  if (!name) return fail("invalid_input", "name is required", 400);
  const parsed = parseScenarioInputs((body as { inputs?: unknown })?.inputs, "create");
  if (!parsed.ok) return parsed.response;
  const scenario = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const [created] = await tx.insert(scenarios).values({ orgId: ctx.orgId, projectId, name, createdBy: ctx.userId, ...toColumns(parsed.inputs) }).returning();
    return created;
  });
  if (!scenario) return fail("not_found", "project not found", 404);
  return ok(scenarioDto(scenario), { status: 201 });
});
