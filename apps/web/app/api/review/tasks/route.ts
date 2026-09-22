import { listTasks, REVIEW_TASK_TYPES, type TaskType } from "@parcelpilot/db";
import { ReviewStatus } from "@parcelpilot/contracts";
import { serviceSql } from "../../../../lib/db.ts";
import { fail, ok } from "../../../../lib/http.ts";
import { withReviewer } from "../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const JURISDICTION = "milwaukee-wi";

// GET /api/review/tasks?status=unreviewed&type=rule_candidate_review — the queue, in-review first, then by priority.
export const GET = withReviewer(async (_actor, req: Request) => {
  const u = new URL(req.url);
  const status = ReviewStatus.safeParse(u.searchParams.get("status"));
  const type = u.searchParams.get("type");
  if (type && !(REVIEW_TASK_TYPES as readonly string[]).includes(type)) return fail("invalid_type", `type must be one of ${REVIEW_TASK_TYPES.join(", ")}`, 400);
  const tasks = await listTasks(serviceSql(), { jurisdictionId: JURISDICTION, ...(status.success ? { status: status.data } : {}), ...(type ? { taskType: type as TaskType } : {}) });
  return ok(tasks, { meta: { total: tasks.length } });
});
