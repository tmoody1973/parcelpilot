import { geocodeSuggest } from "../../../lib/parcel-service.ts";
import { guard, ok } from "../../../lib/http.ts";

// Address autocomplete. The browser calls this, never the City geocoder directly (02_architecture.md §5).
export async function GET(req: Request): Promise<Response> {
  return guard(async () => {
    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 3) return ok([]);
    return ok(await geocodeSuggest(q));
  });
}
