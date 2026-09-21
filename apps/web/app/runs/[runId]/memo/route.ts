import { fail, withTenant } from "../../../../lib/http.ts";
import { renderRunMemo } from "../../../../lib/memo-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ runId: string }> };

// The memo is its own printable page: standalone HTML with a print stylesheet (browser print → PDF).
// Validators run on every render; a failure is reported in headers and never hidden.
export const GET = withTenant(async (ctx, _req: Request, { params }: Params) => {
  const { runId } = await params;
  const memo = await renderRunMemo(ctx, runId);
  if (!memo) return fail("not_found", "run not found or not locked", 404);
  return new Response(memo.html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-memo-contract-hash": memo.contract_hash,
      "x-memo-validation": memo.validation.passed ? "passed" : `failed:${memo.validation.problems.join(",")}`,
    },
  });
});
