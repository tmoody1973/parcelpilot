import { NextResponse } from "next/server";
import { devAuthEnabled } from "../../../../lib/auth-mode.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dev auth mode only: sets the identity cookies a real browser cannot send as headers, then goes home.
// GET /api/dev/session?user=alice&org=alpha&orgName=Alpha%20Dev   (404 when dev auth mode is off)
export async function GET(req: Request): Promise<Response> {
  if (!devAuthEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const u = new URL(req.url);
  const user = u.searchParams.get("user") ?? "dev_user";
  const org = u.searchParams.get("org") ?? "dev_org";
  const orgName = u.searchParams.get("orgName") ?? org;
  const res = NextResponse.redirect(new URL("/", u.origin));
  for (const [k, v] of [["pp-dev-user", user], ["pp-dev-org", org], ["pp-dev-org-name", orgName]] as const) res.cookies.set(k, v, { path: "/", httpOnly: true, sameSite: "lax" });
  return res;
}
