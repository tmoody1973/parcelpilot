import { desc, eq, sql as dsql } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField, withTenant } from "../../../lib/http.ts";
import { projectDto } from "../../../lib/projects-dto.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTenant(async (ctx) => {
  const rows = await withOrg(appDb(), ctx.orgId, (tx) =>
    tx.select({ p: projects, scenario_count: dsql<number>`(select count(*)::int from ${scenarios} s where s.project_id = ${projects.id})` }).from(projects).orderBy(desc(projects.updatedAt)),
  );
  return ok(await Promise.all(rows.map((r) => projectDto(r.p, r.scenario_count))));
});

export const POST = withTenant(async (ctx, req: Request) => {
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  if (!name) return fail("invalid_input", "name is required", 400);
  const parcelTaxkey = stringField(body, "parcel_taxkey") ?? stringField(body, "parcelTaxkey");
  const [project] = await withOrg(appDb(), ctx.orgId, (tx) => tx.insert(projects).values({ orgId: ctx.orgId, name, parcelTaxkey, createdBy: ctx.userId }).returning());
  return ok(await projectDto(project!, 0), { status: 201 });
});
void eq;
