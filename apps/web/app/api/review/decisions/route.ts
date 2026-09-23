import { goldComparisons, goldOrgIdIfExists } from "@parcelpilot/db";
import { shadowMetrics } from "@parcelpilot/zoning-core";
import { appSql, serviceSql } from "../../../../lib/db.ts";
import { ok } from "../../../../lib/http.ts";
import { withReviewer } from "../../../../lib/review-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/review/decisions — the gold set in shadow mode (MOO-840): per case, the rules-only route, JEV's route, the
// expert label and the brief outcome, plus the 05 §9 metrics. The gold runs live in the internal gold org; the read is
// a transaction scoped to that org, so RLS still limits it to gold rows (decision 016).
export const GET = withReviewer(async () => {
  const orgId = await goldOrgIdIfExists(serviceSql());
  if (!orgId) return ok({ rows: [], metrics: shadowMetrics([]) });
  const rows = await appSql().begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    return goldComparisons(tx);
  });
  return ok({ rows, metrics: shadowMetrics(rows) });
});
