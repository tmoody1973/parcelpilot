// Generates review_tasks for everything code says needs a human look (MOO-819): multi-fragment table families,
// thin or OCR'd pages, footnotes, rule candidates. Idempotent per entity. Usage: pnpm review:sweep
import postgres from "postgres";
import { generateReviewTasks } from "../review-store.ts";

const sql = postgres(process.env["DATABASE_SERVICE_URL"] ?? "postgres://parcelpilot_service:parcelpilot-service@localhost:5432/parcelpilot", { max: 1 });
try {
  const inserted = await generateReviewTasks(sql, "milwaukee-wi");
  const [open] = await sql`select task_type, count(*)::int as n from review_tasks where status in ('unreviewed', 'in_review') group by task_type order by 1`.then((rows) => [Object.fromEntries(rows.map((r) => [r["task_type"], r["n"]]))]);
  console.log(`review sweep: inserted ${JSON.stringify(inserted)}; open ${JSON.stringify(open)}`);
} finally {
  await sql.end();
}
