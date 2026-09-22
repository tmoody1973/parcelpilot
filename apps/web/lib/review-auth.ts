import { eq, and } from "drizzle-orm";
import { memberships, REVIEWER_ROLES, ReviewError, type Actor } from "@parcelpilot/db";
import { OrgRole } from "@parcelpilot/contracts";
import { devAuthEnabled } from "./auth-mode.ts";
import { serviceDb } from "./db.ts";
import { fail, withTenant } from "./http.ts";
import type { OrgContext } from "./tenant.ts";

// The reviewer gate for /api/review/* (00_conventions OrgRole: reviewer may approve candidates, tables, chunks;
// owner/admin too). The role comes from the caller's membership row. In dev auth mode the `x-dev-role` header
// (or the pp-dev-role cookie) names the role, so the queue can be exercised locally and in CI without Clerk.
async function roleFor(ctx: OrgContext, req?: Request): Promise<OrgRole> {
  if (devAuthEnabled()) {
    const cookies = Object.fromEntries((req?.headers.get("cookie") ?? "").split(";").map((c) => c.trim().split("=") as [string, string]).filter(([k]) => k));
    const parsed = OrgRole.safeParse(req?.headers.get("x-dev-role") ?? cookies["pp-dev-role"]);
    if (parsed.success) return parsed.data;
  }
  const [m] = await serviceDb().select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, ctx.userId))).limit(1);
  return m?.role ?? "member";
}

export function withReviewer<A extends unknown[]>(handler: (actor: Actor, ...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response> {
  return withTenant<A>(async (ctx, ...args) => {
    const req = args[0] instanceof Request ? (args[0] as Request) : undefined;
    const role = await roleFor(ctx, req);
    if (!REVIEWER_ROLES.includes(role)) return fail("forbidden", "reviewer role required", 403);
    try {
      return await handler({ userId: ctx.userId, orgId: ctx.orgId, role }, ...args);
    } catch (e) {
      if (e instanceof ReviewError) return fail(e.code, e.message, e.status);
      throw e;
    }
  });
}
