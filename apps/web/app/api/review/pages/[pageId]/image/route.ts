import { serviceSql } from "../../../../../../lib/db.ts";
import { fail } from "../../../../../../lib/http.ts";
import { withReviewer } from "../../../../../../lib/review-auth.ts";
import { getObjectStream } from "../../../../../../lib/storage.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/review/pages/:id/image — the rendered page PNG (144 dpi) from object storage, reviewer-gated like the data it shows.
export const GET = withReviewer(async (_actor, _req: Request, { params }: { params: Promise<{ pageId: string }> }) => {
  const { pageId } = await params;
  const [row] = await serviceSql()<{ image_ref: string | null }[]>`select image_ref from document_pages where id = ${pageId}`;
  if (!row?.image_ref) return fail("not_found", "no rendered image for this page", 404);
  const obj = await getObjectStream(row.image_ref);
  if (!obj) return fail("not_found", "page image missing from storage", 404);
  return new Response(obj.body, { headers: { "content-type": obj.contentType, "cache-control": "private, max-age=3600" } });
});
