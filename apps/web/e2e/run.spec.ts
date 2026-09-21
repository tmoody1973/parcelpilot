import { expect, test } from "@playwright/test";
import { resolvedProfile, stubCommonRoutes, stubRunRoutes } from "./fixtures.ts";

// MOO-815: the decision panel after "Run scenario". API stubbed; the panel's contract is what is under test.
async function saveScenario(page: import("@playwright/test").Page) {
  await page.route("**/api/parcels/resolve", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: resolvedProfile("2500011000", "4843 N Green Bay Av") }) }));
  await page.goto("/");
  await page.getByTestId("search-input").fill("4843 N Green Bay Av");
  await page.getByRole("button", { name: "Find parcel" }).click();
  await expect(page.getByText("Site profile")).toBeVisible();
  const form = page.getByTestId("scenario-form");
  await form.getByLabel("Scenario name").fill("Demo concept");
  await form.getByLabel("Units").fill("24");
  await form.getByLabel("Height (ft)").fill("46");
  await form.getByRole("button", { name: /Save draft scenario/ }).click();
  await expect(page.getByTestId("run-history").getByText("Demo concept")).toBeVisible();
}

test("G01: revise scenario, two fail rows, coverage lists all eight categories, next action", async ({ page }) => {
  await stubCommonRoutes(page);
  await stubRunRoutes(page, "g01");
  await saveScenario(page);
  await page.getByRole("button", { name: "Run scenario" }).click();

  const panel = page.getByTestId("run-panel");
  await expect(panel.getByTestId("status-card")).toContainText("Revise scenario");
  await expect(panel.getByTestId("scope-caveat")).toContainText("Checked 6 of 8 categories");
  await expect(panel.getByTestId("scope-caveat")).toContainText("not an official zoning determination");
  await expect(panel.locator('[data-testid^="finding-"][data-status="fail"]')).toHaveCount(2);
  await expect(panel.getByTestId("finding-height")).toContainText("46 ft");
  await expect(panel.getByTestId("finding-height")).toContainText("<= 45 ft");
  await expect(panel.getByTestId("finding-height")).toContainText("Table 295-605-2 · p. 824");
  for (const c of ["Use", "Height", "Front setback", "Side setback", "Rear setback", "Density", "Parking", "Lot coverage"]) await expect(panel.getByTestId("coverage-panel")).toContainText(c);
  await expect(panel.getByTestId("coverage-unknown")).toContainText("Parking");
  await expect(panel.getByTestId("next-actions")).toContainText("Revise the concept");
  await expect(page.getByTestId("scenario-compare")).toContainText("Revise scenario");
  await expect(page.getByTestId("memo-link")).toHaveAttribute("href", "/runs/run-g01/memo");
  await page.screenshot({ path: "test-results/run-panel-g01.png", fullPage: true });
});

test("G09: insufficient evidence names the missing input and offers only collect / contact actions", async ({ page }) => {
  await stubCommonRoutes(page);
  await stubRunRoutes(page, "g09");
  await saveScenario(page);
  await page.getByRole("button", { name: "Run scenario" }).click();

  const panel = page.getByTestId("run-panel");
  await expect(panel.getByTestId("status-card")).toContainText("Insufficient evidence");
  await expect(panel.getByTestId("missing-inputs")).toContainText("building height (ft)");
  await expect(panel.getByTestId("finding-height")).toHaveAttribute("data-status", "insufficient_evidence");
  const actions = panel.getByTestId("next-actions").locator("li");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toContainText("Collect the missing information");
  await expect(actions.nth(1)).toContainText("Contact the Department of City Development");
  await expect(panel.getByTestId("coverage-manual_review")).toContainText("Height");
});
