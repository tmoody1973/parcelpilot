import { desc, eq } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField, withTenant } from "../../../../lib/http.ts";
import { projectDto, scenarioDto } from "../../../../lib/projects-dto.ts";
import { profileForTaxkey } from "../../../../lib/parcel-service.ts";
import { listRuns } from "../../../../lib/run-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ projectId: string }> };

// Project detail: the project, its scenarios, and the site profile rebuilt from the parcel's latest snapshot.
// A project id from another org misses under RLS → 404, never a leak.
export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { projectId } = await params;
  const detail = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const rows = await tx.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(desc(scenarios.updatedAt));
    return { project, rows };
  });
  if (!detail) return fail("not_found", "project not found", 404);
  const profile = detail.project.parcelTaxkey ? await profileForTaxkey(detail.project.parcelTaxkey) : null;
  const runs = await listRuns(ctx, { projectId });
  return ok({ project: await projectDto(detail.project, detail.rows.length), scenarios: detail.rows.map(scenarioDto), profile, runs });
});

export const PATCH = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { projectId } = await params;
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  const parcelTaxkey = stringField(body, "parcel_taxkey") ?? stringField(body, "parcelTaxkey");
  if (!name && !parcelTaxkey) return fail("invalid_input", "nothing to update", 400);
  const [project] = await withOrg(appDb(), ctx.orgId, (tx) =>
    tx.update(projects).set({ ...(name ? { name } : {}), ...(parcelTaxkey ? { parcelTaxkey } : {}), updatedAt: new Date() }).where(eq(projects.id, projectId)).returning(),
  );
  if (!project) return fail("not_found", "project not found", 404);
  return ok(await projectDto(project, null));
});
