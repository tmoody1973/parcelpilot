import { NextResponse } from "next/server";
import { OrgContextError, requireOrgContext, type OrgContext } from "./tenant.ts";

// Wraps a tenant-scoped route handler: it resolves the caller's org context first and passes it in,
// or returns the matching 401/403 response, so an unscoped caller is rejected before any query runs.
// `args` are the handler's own Next arguments (the request, and the route params when present).
export function withTenant<A extends unknown[]>(
  handler: (ctx: OrgContext, ...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(await requireOrgContext(), ...args);
    } catch (e) {
      if (e instanceof OrgContextError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  };
}

// Parses a JSON request body into an object, or an empty object when it is missing or not JSON.
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// Returns a trimmed non-empty string field, or null when it is absent or blank.
export function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
