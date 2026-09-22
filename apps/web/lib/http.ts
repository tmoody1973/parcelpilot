import { OrgContextError, requireOrgContext, type OrgContext } from "./tenant.ts";

// Response envelope for every route handler (docs/planning/02_architecture.md §5): { ok, data, error, meta }.
export type ApiError = { code: string; message: string; issues?: unknown };
export type Envelope<T> = { ok: true; data: T; meta?: Record<string, unknown> } | { ok: false; error: ApiError };

export function ok<T>(data: T, init: { status?: number; meta?: Record<string, unknown> } = {}): Response {
  const body: Envelope<T> = init.meta ? { ok: true, data, meta: init.meta } : { ok: true, data };
  return Response.json(body, { status: init.status ?? 200 });
}

export function fail(code: string, message: string, status = 400, issues?: unknown): Response {
  const body: Envelope<never> = { ok: false, error: issues ? { code, message, issues } : { code, message } };
  return Response.json(body, { status });
}

// Wraps a tenant-scoped route handler: resolves the caller's org context first (401/403 as envelopes),
// turns unexpected throws into a clean 500 envelope, and passes Next's own args through.
export function withTenant<A extends unknown[]>(handler: (ctx: OrgContext, ...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      const req = args[0] instanceof Request ? (args[0] as Request) : undefined;
      return await handler(await requireOrgContext(req), ...args);
    } catch (e) {
      if (e instanceof OrgContextError) return fail(e.status === 401 ? "unauthenticated" : "no_active_org", e.message, e.status);
      console.error("route handler failed", e); // full detail stays server-side; the caller never sees driver or schema text
      return fail("internal_error", "unexpected error", 500);
    }
  };
}

export async function readJsonBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export function stringField(body: unknown, key: string): string | null {
  const v = (body as Record<string, unknown> | null)?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
