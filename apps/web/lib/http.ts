// Response envelope for every route handler (docs/planning/02_architecture.md §5): { ok, data, error, meta }.

export type ApiError = { code: string; message: string };
export type Envelope<T> = { ok: true; data: T; meta?: Record<string, unknown> } | { ok: false; error: ApiError };

export function ok<T>(data: T, meta?: Record<string, unknown>): Response {
  const body: Envelope<T> = meta ? { ok: true, data, meta } : { ok: true, data };
  return Response.json(body);
}

export function fail(code: string, message: string, status = 400): Response {
  const body: Envelope<never> = { ok: false, error: { code, message } };
  return Response.json(body, { status });
}

// Wraps a handler so an unexpected throw becomes a clean 500 envelope instead of an HTML error page.
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unexpected error";
    return fail("internal_error", message, 500);
  }
}
