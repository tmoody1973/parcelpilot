import { expect, test, type Page } from "@playwright/test";

// Reviewer workbench (MOO-821) with the /api/review layer stubbed: the gate for non-reviewers, the queue at
// 390 px, and the candidate view's approve / reject flows including the audit line the server returns.

const TASK_ID = "11111111-1111-1111-1111-111111111111";
const PAGE_ID = "22222222-2222-2222-2222-222222222222";
const env = (data: unknown) => ({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
const forbidden = { status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "forbidden", message: "reviewer role required" } }) };

const task = (status = "unreviewed") => ({
  id: TASK_ID, jurisdiction_id: "milwaukee-wi", task_type: "rule_candidate_review", entity_type: "rule_candidate", entity_id: "c1", assigned_to: null, status, priority: "high", reason: "Candidate height rule for LB1 extracted by table_row",
  resolved_by: null, resolved_at: null, created_at: "2026-09-22T14:00:00Z", updated_at: "2026-09-22T14:00:00Z",
  subject: { title: "height · LB1 · height_maximum_ft", district: "LB1", category: "height", page: 16, printed_page: 824, document: "Chapter 295 Subchapter 6 — Commercial Districts" },
});
const mergeTask = { ...task(), id: "33333333-3333-3333-3333-333333333333", task_type: "merge_review", entity_type: "source_table", priority: "high", subject: { title: "Table 295-603-1 pages 2-6", district: null, category: null, page: 2, printed_page: null, document: "Chapter 295 Subchapter 6 — Commercial Districts" } };

const detail = (status = "unreviewed") => ({
  task: task(status), kind: "rule_candidate_review",
  candidate: { id: "c1", family_id: "198a9062664e:295-605-2:height_maximum_ft:LB1", district_code: "LB1", category: "height", proposed_rule: { district_code: "LB1", category: "height", kind: "max_height_ft", params: { max_ft: 45 }, conditions: [], criticality: "high" }, extracted_value: { LB1: "45" }, row_key: "height_maximum_ft", reviewer_status: status, reviewer_notes: null, extraction_method: "table_row", approved_rule_id: null },
  table: { family_key: "tbl_295_605_2", columns: ["NS1", "NS2", "LB1", "LB2", "LB3", "RB1", "RB2", "CS"] },
  row: { row_key: "height_maximum_ft", label: "Height, maximum (ft.)", unit: "ft", group: null, cells: { NS1: "45", NS2: "45", LB1: "45", LB2: "60", LB3: "60", RB1: "45", RB2: "60", CS: "60" }, markers: {}, sources: [{ page: 16, row_index_on_page: 9, bbox: [90, 300, 684, 314], fragment_page: 16 }], footnote_refs: [], applicable_footnotes: [], family_id: "198a9062664e:295-605-2:height_maximum_ft" },
  page: { id: PAGE_ID, page_number: 16, printed_page: 824, raw_text: "Table 295-605-2 ... Height, maximum (ft.) 45 45 45 60 60 45 60 60", image_ref: "milwaukee-wi/pages/x/16.png" },
  footnotes: [], citations: [{ id: "cit1", page_number: 16, printed_page: 824, section: "295-605-2", excerpt: "Height, maximum (ft.): LB1 45", document: "Chapter 295 Subchapter 6 — Commercial Districts" }],
});

// A 1×1 PNG so the viewer has a natural size to place boxes against.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function stubReviewer(page: Page, opts: { status?: string } = {}) {
  await page.route("**/api/review/tasks?*", (route) => route.fulfill(env([task(opts.status), mergeTask])));
  await page.route(`**/api/review/tasks/${TASK_ID}`, (route) => route.fulfill(env(detail(opts.status))));
  await page.route(`**/api/review/pages/${PAGE_ID}/image`, (route) => route.fulfill({ contentType: "image/png", body: PNG }));
}

test("a non-reviewer sees the gate page and no queue data", async ({ page }) => {
  await page.route("**/api/review/tasks?*", (route) => route.fulfill(forbidden));
  await page.goto("/review");
  await expect(page.getByTestId("review-gate")).toContainText("Reviewer role required");
  await expect(page.getByTestId("queue-groups")).toHaveCount(0);
  await expect(page.getByTestId("task-row")).toHaveCount(0);
});

test("the queue groups by type with counts and filters by district", async ({ page }) => {
  await stubReviewer(page);
  await page.goto("/review");
  await expect(page.getByTestId("group-rule_candidate_review")).toContainText("Rule candidates");
  await expect(page.getByTestId("group-rule_candidate_review")).toContainText("1");
  await expect(page.getByTestId("group-merge_review")).toContainText("Table merges");
  await expect(page.getByTestId("task-row")).toHaveCount(2);
  await page.getByLabel("District").selectOption("LB1");
  await expect(page).toHaveURL(/\/review$/);
});

test("candidate view: bbox drawn on the page, row and citations shown, approve records the audit line", async ({ page }) => {
  await stubReviewer(page);
  await page.route(`**/api/review/tasks/${TASK_ID}/approve`, (route) => route.fulfill(env({
    task: { ...task("approved"), audit: { id: "aud-1", action: "rule.approved", created_at: "2026-09-22T14:05:00Z" } }, // banned-ok: stubbed database values
    rule: { id: "rule-1", family_id: "198a9062664e:295-605-2:height_maximum_ft:LB1", version: 1, supersedes_id: null },
  })));
  await page.goto(`/review/tasks/${TASK_ID}`);
  await expect(page.getByTestId("task-view")).toHaveAttribute("data-task-type", "rule_candidate_review");
  await expect(page.getByTestId("page-box")).toHaveCount(1);
  await expect(page.getByTestId("page-box")).toHaveAttribute("data-label", "Height, maximum (ft.)");
  await expect(page.getByTestId("extracted-row")).toContainText("Height, maximum (ft.)");
  await expect(page.getByTestId("cell-LB1")).toContainText("45");
  await expect(page.getByTestId("citations")).toContainText("p. 824");
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("action-success")).toContainText("Recorded as rule version 1");
  await expect(page.getByTestId("audit-line")).toContainText("audit rule.approved"); // banned-ok: the audit action name
  await expect(page.getByTestId("rule-line")).toContainText("zoning_rules rule-1");
});

test("reject without a reason is blocked before any request; with a reason it records the audit line", async ({ page }) => {
  await stubReviewer(page);
  let rejectCalls = 0;
  await page.route(`**/api/review/tasks/${TASK_ID}/reject`, (route) => { rejectCalls++; return route.fulfill(env({ ...task("rejected"), reason: "cell reads 46", audit: { id: "aud-2", action: "rule.rejected", created_at: "2026-09-22T14:06:00Z" } })); });
  await page.goto(`/review/tasks/${TASK_ID}`);
  await page.getByTestId("reject-button").click();
  await expect(page.getByTestId("action-error")).toContainText("needs a stated reason");
  expect(rejectCalls).toBe(0);
  await page.getByTestId("reason-input").fill("cell reads 46");
  await page.getByTestId("reject-button").click();
  await expect(page.getByTestId("audit-line")).toContainText("rule.rejected");
  expect(rejectCalls).toBe(1);
});

test("the editor validates against the rule contract and needs a reason", async ({ page }) => {
  await stubReviewer(page);
  await page.goto(`/review/tasks/${TASK_ID}`);
  await page.getByTestId("params-input").fill('{"max_ft": "tall"}');
  await expect(page.getByTestId("validation-errors")).toContainText("params");
  await page.getByTestId("params-input").fill('{"max_ft": 46}');
  await expect(page.getByTestId("validation-errors")).toHaveCount(0);
  await page.getByTestId("save-edit").click();
  await expect(page.getByTestId("edit-message")).toContainText("needs a stated reason");
});

test.describe("390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("the queue has no horizontal page scroll", async ({ page }) => {
    await stubReviewer(page);
    await page.goto("/review");
    await expect(page.getByTestId("task-row")).toHaveCount(2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
