import { expect, test } from "@playwright/test";
import { resolvedProfile, stubCommonRoutes, stubRunRoutes } from "./fixtures.ts";

// Contract: desktop-first, but 390px must render without horizontal page scroll.
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }); // iPhone-class viewport on Chromium (WebKit not installed in CI)

test("workspace at 390px has no horizontal page scroll: before resolving, after resolving, and with the findings panel open", async ({ page }) => {
  await stubCommonRoutes(page);
  await stubRunRoutes(page, "g01");
  await page.route("**/api/parcels/resolve", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: resolvedProfile("2500011000", "4843 N Green Bay Av") }) }));
  await page.goto("/");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.getByTestId("search-input").fill("4843 N Green Bay Av");
  await page.getByRole("button", { name: "Find parcel" }).click();
  await expect(page.getByText("Site profile")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  const form = page.getByTestId("scenario-form");
  await form.getByLabel("Scenario name").fill("Demo concept");
  await form.getByLabel("Units").fill("24");
  await form.getByRole("button", { name: /Save draft scenario/ }).click();
  await page.getByRole("button", { name: "Run scenario" }).click();
  await expect(page.getByTestId("run-panel")).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});
