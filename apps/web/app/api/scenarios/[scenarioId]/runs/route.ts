import { ok, withTenant } from "../../../../../lib/http.ts";
import { listRuns } from "../../../../../lib/run-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ scenarioId: string }> };

// Run history for one scenario, newest first (empty for an unknown or foreign scenario: RLS hides it).
export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  return ok(await listRuns(ctx, { scenarioId }));
});
