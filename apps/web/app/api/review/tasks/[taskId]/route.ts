import { getTaskDetail } from "@parcelpilot/db";
import { serviceSql } from "../../../../../lib/db.ts";
import { ok } from "../../../../../lib/http.ts";
import { withReviewer } from "../../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/review/tasks/:id — everything the task view shows, assembled server-side (page, row, footnotes, proposal).
export const GET = withReviewer(async (actor, _req: Request, { params }: { params: Promise<{ taskId: string }> }) => {
  const { taskId } = await params;
  return ok({ ...(await getTaskDetail(serviceSql(), taskId)), viewer_role: actor.role });
});
