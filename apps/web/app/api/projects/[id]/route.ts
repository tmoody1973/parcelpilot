import { getProjectDetail } from "../../../../lib/projects.ts";
import { resolveOrgContext } from "../../../../lib/org.ts";
import { fail, guard, ok } from "../../../../lib/http.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return guard(async () => {
    const { id } = await params;
    const { orgId } = resolveOrgContext(req);
    const detail = await getProjectDetail(orgId, id);
    if (!detail) return fail("not_found", "project not found", 404);
    return ok(detail);
  });
}
