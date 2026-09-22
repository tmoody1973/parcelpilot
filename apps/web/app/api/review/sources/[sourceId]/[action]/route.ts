import { transitionSource } from "@parcelpilot/db";
import { serviceSql } from "../../../../../../lib/db.ts";
import { fail, ok, readJsonBody, stringField } from "../../../../../../lib/http.ts";
import { withReviewer } from "../../../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const ACTIONS = ["activate", "supersede", "withdraw"] as const;

// POST /api/review/sources/:id/{activate,supersede,withdraw}; supersede needs { successor_id }.
export const POST = withReviewer(async (actor, req: Request, { params }: { params: Promise<{ sourceId: string; action: string }> }) => {
  const { sourceId, action } = await params;
  if (!(ACTIONS as readonly string[]).includes(action)) return fail("not_found", `unknown action ${action}`, 404);
  const body = await readJsonBody(req);
  return ok(await serviceSql().begin((tx) => transitionSource(tx, actor, sourceId, action as (typeof ACTIONS)[number], stringField(body, "successor_id"), stringField(body, "reason"))));
});
