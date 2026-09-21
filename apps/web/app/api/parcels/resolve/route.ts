import { resolveSite } from "../../../../lib/parcel-service.ts";
import { fail, ok, readJsonBody, withTenant } from "../../../../lib/http.ts";
import { resolveInputSchema } from "../../../../lib/validation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve an address, TAXKEY, or map point to one parcel. A point over stacked condos returns `ambiguous`.
export const POST = withTenant(async (_ctx, req: Request) => {
  const parsed = resolveInputSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return fail("invalid_input", "expected one of { address }, { taxkey }, { point }", 422, parsed.error.issues);
  return ok(await resolveSite(parsed.data));
});
