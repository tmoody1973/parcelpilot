import { fail, ok, withTenant } from "../../../../../lib/http.ts";
import { runScenario } from "../../../../../lib/run-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ scenarioId: string }> };

// Scores a saved scenario and locks the result. Each call is a new immutable run.
export const POST = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { scenarioId } = await params;
  const outcome = await runScenario(ctx, scenarioId);
  if (outcome.kind === "not_found") return fail("not_found", "scenario not found", 404);
  if (outcome.kind === "no_parcel") return fail("not_runnable", outcome.message, 409);
  return ok(outcome.run, { status: 201 });
});
