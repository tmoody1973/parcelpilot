import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { projects, scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../../lib/db.ts";
import { resolveOrgContext } from "../../../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

// Lists the scenarios of one project the caller owns. A project id from another org is invisible
// under RLS, so the project lookup misses and the handler returns 404 — never another org's data.
export async function GET(_req: Request, { params }: Params) {
  const resolved = await resolveOrgContext();
  if ("error" in resolved) return resolved.error;
  const { projectId } = await params;

  const rows = await withOrg(appDb(), resolved.ctx.orgId, async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    return tx.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(desc(scenarios.createdAt));
  });
  if (rows === null) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ scenarios: rows });
}

// Creates a scenario inside a project the caller owns, after confirming the project is in the org.
export async function POST(req: Request, { params }: Params) {
  const resolved = await resolveOrgContext();
  if ("error" in resolved) return resolved.error;
  const { orgId, userId } = resolved.ctx;
  const { projectId } = await params;

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const result = await withOrg(appDb(), orgId, async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)));
    if (!project) return null;
    const [scenario] = await tx
      .insert(scenarios)
      .values({ orgId, projectId, name, createdBy: userId })
      .returning();
    return scenario;
  });
  if (!result) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ scenario: result }, { status: 201 });
}
