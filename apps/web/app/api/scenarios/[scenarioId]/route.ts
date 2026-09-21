import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { scenarios, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../lib/db.ts";
import { readJsonBody, stringField, withTenant } from "../../../../lib/http.ts";
import { parseScenarioInputs, toColumns } from "../../../../lib/scenario-input.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ scenarioId: string }> };

export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  const [scenario] = await withOrg(appDb(), ctx.orgId, (tx) => tx.select().from(scenarios).where(eq(scenarios.id, scenarioId)));
  if (!scenario) return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  return NextResponse.json({ scenario });
});

// Draft-only: a scored scenario (status ≠ draft, arrives with feasibility runs) is never edited in place.
export const PATCH = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  const rawInputs = (body as { inputs?: unknown })?.inputs;
  if (!name && rawInputs === undefined) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  const scenario = await withOrg(appDb(), ctx.orgId, async (tx) => {
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
  if (scenario instanceof Response) return scenario;
  if (!scenario) return NextResponse.json({ error: "scenario not found" }, { status: 404 });
  return NextResponse.json({ scenario });
});
