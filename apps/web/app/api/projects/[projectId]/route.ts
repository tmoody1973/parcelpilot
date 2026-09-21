import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { projects, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../../lib/db.ts";
import { readJsonBody, stringField, withTenant } from "../../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ projectId: string }> };

// A project id from another org misses under RLS → 404, never a leak.
export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { projectId } = await params;
  const [project] = await withOrg(appDb(), ctx.orgId, (tx) => tx.select().from(projects).where(eq(projects.id, projectId)));
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ project });
});

export const PATCH = withTenant(async (ctx, req: Request, { params }: Params) => {
  const { projectId } = await params;
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  const parcelTaxkey = stringField(body, "parcelTaxkey");
  if (!name && !parcelTaxkey) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  const [project] = await withOrg(appDb(), ctx.orgId, (tx) =>
    tx.update(projects).set({ ...(name ? { name } : {}), ...(parcelTaxkey ? { parcelTaxkey } : {}), updatedAt: new Date() }).where(eq(projects.id, projectId)).returning(),
  );
  if (!project) return NextResponse.json({ error: "project not found" }, { status: 404 });
  return NextResponse.json({ project });
});
