import { listSources } from "@parcelpilot/db";
import { serviceSql } from "../../../../lib/db.ts";
import { ok } from "../../../../lib/http.ts";
import { withReviewer } from "../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/review/sources — every registered source document with its lifecycle state.
export const GET = withReviewer(async () => ok(await listSources(serviceSql(), "milwaukee-wi")));
