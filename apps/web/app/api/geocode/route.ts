import { geocodeSuggest } from "../../../lib/parcel-service.ts";
import { ok, withTenant } from "../../../lib/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Address autocomplete. The browser calls this, never the City geocoder directly (02_architecture.md §5).
export const GET = withTenant(async (_ctx, req: Request) => {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return ok([]);
  return ok(await geocodeSuggest(q));
});
