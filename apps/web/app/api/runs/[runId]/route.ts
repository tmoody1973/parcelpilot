import { fail, ok, withTenant } from "../../../../lib/http.ts";
import { getRun } from "../../../../lib/run-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ runId: string }> };

export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { runId } = await params;
  const run = await getRun(ctx, runId);
  if (!run) return fail("not_found", "run not found", 404);
  return ok(run);
});
