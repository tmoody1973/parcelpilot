import { approveTask, claimTask, editTask, rejectTask } from "@parcelpilot/db";
import { serviceSql } from "../../../../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField } from "../../../../../../lib/http.ts";
import { withReviewer } from "../../../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/review/tasks/:id/{claim,approve,reject,edit}. reject and edit need { reason }; edit also needs { patch }.
// One transaction per call: the task, the candidate, the minted rule, its citations and the audit row land together or not at all.
export const POST = withReviewer(async (actor, req: Request, { params }: { params: Promise<{ taskId: string; action: string }> }) => {
  const { taskId, action } = await params;
  const body = await readJsonBody(req);
  const reason = stringField(body, "reason");
  const sql = serviceSql();
  switch (action) {
    case "claim": return ok(await sql.begin((tx) => claimTask(tx, actor, taskId)));
    case "approve": return ok(await sql.begin((tx) => approveTask(tx, actor, taskId)));
    case "reject": return ok(await sql.begin((tx) => rejectTask(tx, actor, taskId, reason)));
    case "edit": return ok(await sql.begin((tx) => editTask(tx, actor, taskId, reason, (body as { patch?: unknown } | null)?.patch)));
    default: return fail("not_found", `unknown action ${action}`, 404);
  }
});
