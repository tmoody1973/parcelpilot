import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { projects, withOrg } from "@parcelpilot/db";
import { appDb } from "../../../lib/db.ts";
import { resolveOrgContext } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists the caller's projects. RLS on the app connection restricts the rows to the caller's org.
export async function GET() {
  const resolved = await resolveOrgContext();
  if ("error" in resolved) return resolved.error;
  const rows = await withOrg(appDb(), resolved.ctx.orgId, (tx) =>
    tx.select().from(projects).orderBy(desc(projects.createdAt)),
  );
  return NextResponse.json({ projects: rows });
}

// Creates a project for the caller's org. `org_id` is set from the resolved context, and the RLS
// WITH CHECK clause rejects any attempt to write it into another org.
export async function POST(req: Request) {
  const resolved = await resolveOrgContext();
  if ("error" in resolved) return resolved.error;
  const { orgId, userId } = resolved.ctx;

  const body = (await req.json().catch(() => null)) as { name?: unknown; parcelTaxkey?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const parcelTaxkey = typeof body?.parcelTaxkey === "string" ? body.parcelTaxkey : null;

  const [project] = await withOrg(appDb(), orgId, (tx) =>
    tx.insert(projects).values({ orgId, name, parcelTaxkey, createdBy: userId }).returning(),
  );
  return NextResponse.json({ project }, { status: 201 });
}
