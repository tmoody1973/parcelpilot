import { expect, test } from "@playwright/test";
import { resolvedProfile, stubCommonRoutes } from "./fixtures.ts";

// ENG-04 / M1 exit: search an address, resolve the parcel, save a scenario, see it in the project's scenarios.
test("resolve a parcel and save two scenarios", async ({ page }) => {
  await stubCommonRoutes(page);
  await page.route("**/api/parcels/resolve", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: resolvedProfile("2500011000", "4843 N Green Bay Av") }) }),
  );

  await page.goto("/");
  await page.getByTestId("search-input").fill("4843 N Green Bay Av");
  await page.getByRole("button", { name: "Find parcel" }).click();

  await expect(page.getByText("Site profile")).toBeVisible();
  await expect(page.getByText("TAXKEY 2500011000")).toBeVisible();

  const form = page.getByTestId("scenario-form");
  await form.getByLabel("Scenario name").fill("Baseline duplex");
  await form.getByLabel("Units").fill("2");
  await form.getByRole("button", { name: /Save draft scenario/ }).click();

  const compare = page.getByTestId("scenario-compare");
  await expect(compare.getByText("Baseline duplex")).toBeVisible();

  await form.getByLabel("Scenario name").fill("Triplex option");
  await form.getByLabel("Units").fill("3");
  await form.getByRole("button", { name: /Save draft scenario/ }).click();

  await expect(compare.getByText("Triplex option")).toBeVisible();
  await expect(compare.getByText("Baseline duplex")).toBeVisible();
});
