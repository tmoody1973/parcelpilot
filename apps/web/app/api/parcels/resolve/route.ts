import { resolveSite } from "../../../../lib/parcel-service.ts";
import { fail, guard, ok } from "../../../../lib/http.ts";
import { resolveInputSchema } from "../../../../lib/validation.ts";

// Resolve an address, TAXKEY, or map point to one parcel. A point over stacked condos returns `ambiguous`.
export async function POST(req: Request): Promise<Response> {
  return guard(async () => {
    const body = await req.json().catch(() => null);
    const parsed = resolveInputSchema.safeParse(body);
    if (!parsed.success) return fail("invalid_input", "expected one of { address }, { taxkey }, { point }", 422);
    return ok(await resolveSite(parsed.data));
  });
}
