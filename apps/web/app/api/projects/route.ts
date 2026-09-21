import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { projects, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../lib/db.ts";
import { readJsonBody, stringField, withTenant } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists the caller's projects. RLS on the app connection restricts the rows to the caller's org.
export const GET = withTenant(async (ctx) => {
  const rows = await withOrg(appDb(), ctx.orgId, (tx) =>
    tx.select().from(projects).orderBy(desc(projects.createdAt)),
  );
  return NextResponse.json({ projects: rows });
});

// Creates a project for the caller's org. `org_id` is set from the resolved context, and the RLS
// WITH CHECK clause rejects any attempt to write it into another org.
export const POST = withTenant(async (ctx, req: Request) => {
  const body = await readJsonBody(req);
  const name = stringField(body, "name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const parcelTaxkey = stringField(body, "parcelTaxkey");

  const [project] = await withOrg(appDb(), ctx.orgId, (tx) =>
    tx.insert(projects).values({ orgId: ctx.orgId, name, parcelTaxkey, createdBy: ctx.userId }).returning(),
  );
  return NextResponse.json({ project }, { status: 201 });
});
