import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../../lib/db.ts";
import { readJsonBody, stringField, withTenant } from "../../../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

// Lists the scenarios of one project the caller owns. A project id from another org is invisible
// under RLS, so the project lookup misses and the handler returns 404 — never another org's data.
export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { projectId } = await params;
  const rows = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    return tx.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(desc(scenarios.createdAt));
  });
  if (rows === null) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ scenarios: rows });
});

// Creates a scenario inside a project the caller owns, after confirming the project is in the org.
export const POST = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { projectId } = await params;
  const name = stringField(await readJsonBody(req), "name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const scenario = await withOrg(appDb(), ctx.orgId, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const [created] = await tx
      .insert(scenarios)
      .values({ orgId: ctx.orgId, projectId, name, createdBy: ctx.userId })
      .returning();
    return created;
  });
  if (!scenario) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ scenario }, { status: 201 });
});
