import { DEMO_ORG_ID, DEMO_USER_ID } from "@parcelpilot/db";

// Org context for a request. M1 has no auth provider yet (Clerk arrives with MOO-807), so it runs against
// the seeded bootstrap org. Headers let tests and internal tools act as another org; real sign-in replaces this.
export type OrgContext = { orgId: string; userId: string };

export function resolveOrgContext(req: Request): OrgContext {
  return {
    orgId: req.headers.get("x-org-id") ?? process.env["DEMO_ORG_ID"] ?? DEMO_ORG_ID,
    userId: req.headers.get("x-user-id") ?? DEMO_USER_ID,
  };
}
