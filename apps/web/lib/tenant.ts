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
export async function requireOrgContext(): Promise<OrgContext> {
  const { userId: clerkUserId, orgId: clerkOrgId, orgSlug } = await auth();
  if (!clerkUserId) throw new OrgContextError(401, "not signed in");
  if (!clerkOrgId) throw new OrgContextError(403, "no active organization");

  const user = await currentUser();
  const email =
    user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@clerk.local`;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
  const orgName = orgSlug ?? clerkOrgId;
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
      .onConflictDoUpdate({ target: users.email, set: { authProviderId: clerkUserId, lastLoginAt: now } })
      .returning({ id: users.id });

    await tx
      .insert(memberships)
      .values({ orgId: org!.id, userId: dbUser!.id, role: "member" })
      .onConflictDoNothing({ target: [memberships.orgId, memberships.userId] });

    return { orgId: org!.id, userId: dbUser!.id };
  });
}
