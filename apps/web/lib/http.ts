import { NextResponse } from "next/server";
import { OrgContextError, requireOrgContext, type OrgContext } from "./tenant.ts";

// Resolves the caller's org context or returns the matching 401/403 response. Every tenant-scoped
// handler starts here, so an unscoped caller is rejected before any query runs.
export async function resolveOrgContext(): Promise<{ ctx: OrgContext } | { error: NextResponse }> {
  try {
    return { ctx: await requireOrgContext() };
  } catch (e) {
    if (e instanceof OrgContextError) return { error: NextResponse.json({ error: e.message }, { status: e.status }) };
    throw e;
  }
}
