import { auth, currentUser } from "@clerk/nextjs/server";
import { memberships, organizations, users } from "@parcelpilot/db";
import { serviceDb } from "./db.ts";

export type OrgContext = { orgId: string; userId: string };

// Thrown when the caller has no session (401) or no active organization (403). Route handlers map
// it to the matching HTTP status so tenant data never leaks to an unscoped caller.
export class OrgContextError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
    this.name = "OrgContextError";
  }
}

// Resolves the Clerk session into internal org + user ids, provisioning both on first sign-in and
// mapping the Clerk org id onto `organizations`. It runs on the service connection (BYPASSRLS) on
// purpose: a brand-new org's row is invisible to an RLS-bound app connection until `app.org_id`
// already equals its id, so the mapping itself cannot bootstrap under RLS. Tenant data reads/writes
// still go through the app connection and `withOrg`.
import { devAuthEnabled } from "./auth-mode.ts";
export { devAuthEnabled };
// Development-only identity (see auth-mode.ts): the caller's identity comes from request headers so the API and UI
// can be exercised locally and in CI without a Clerk instance.

type Identity = { clerkUserId: string; clerkOrgId: string; orgName: string; email: string; fullName: string | null };

async function identityFromRequest(req?: Request): Promise<Identity> {
  if (devAuthEnabled()) {
    const h = req?.headers;
    const clerkUserId = h?.get("x-dev-user") ?? "";
    const clerkOrgId = h?.get("x-dev-org") ?? "";
    if (!clerkUserId) throw new OrgContextError(401, "not signed in (dev: set x-dev-user)");
    if (!clerkOrgId) throw new OrgContextError(403, "no active organization (dev: set x-dev-org)");
    return { clerkUserId, clerkOrgId, orgName: h?.get("x-dev-org-name") ?? clerkOrgId, email: `${clerkUserId}@dev.local`, fullName: null };
  }
  const { userId: clerkUserId, orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkUserId) throw new OrgContextError(401, "not signed in");
  if (!clerkOrgId) throw new OrgContextError(403, "no active organization");
  const user = await currentUser();
  const email =
    user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@clerk.local`;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
  return { clerkUserId, clerkOrgId, orgName: orgSlug ?? clerkOrgId, email, fullName };
}

export async function requireOrgContext(req?: Request): Promise<OrgContext> {
  const { clerkUserId, clerkOrgId, orgName, email, fullName } = await identityFromRequest(req);
  const orgSlug = orgName;
  const now = new Date();

  return serviceDb().transaction(async (tx) => {
    const [org] = await tx
      .insert(organizations)
      .values({ name: orgName, slug: orgSlug ?? clerkOrgId, clerkOrgId })
      .onConflictDoUpdate({ target: organizations.clerkOrgId, set: { updatedAt: now } })
      .returning({ id: organizations.id });

    const [dbUser] = await tx
      .insert(users)
      .values({ email, fullName, authProviderId: clerkUserId, lastLoginAt: now })
      .onConflictDoUpdate({ target: users.authProviderId, set: { email, fullName, lastLoginAt: now, updatedAt: now } })
      .returning({ id: users.id });

    await tx
      .insert(memberships)
      .values({ orgId: org!.id, userId: dbUser!.id, role: "member" })
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] });

    return { orgId: org!.id, userId: dbUser!.id };
  });
}
