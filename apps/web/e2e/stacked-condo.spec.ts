import { expect, test } from "@playwright/test";
import { ambiguousResult, resolvedProfile, stubCommonRoutes } from "./fixtures.ts";

// ENG-02: a stacked-condo address maps to more than one TAXKEY. The app must block on a picker and
// never silently choose. Picking a candidate resolves to that single parcel.
test("stacked-condo address shows the picker and resolves the chosen TAXKEY", async ({ page }) => {
  await stubCommonRoutes(page);
  await page.route("**/api/parcels/resolve", (route) => {
    const body = route.request().postDataJSON() as { taxkey?: string };
    const data = body.taxkey ? resolvedProfile(body.taxkey, "1901 N Dr Martin Luther King Jr Dr") : ambiguousResult();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
  });

  await page.goto("/");
  await page.getByTestId("search-input").fill("1901 N Dr Martin Luther King Jr Dr");
  await page.getByRole("button", { name: "Find parcel" }).click();

  const picker = page.getByTestId("candidate-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("TAXKEY 3900011000")).toBeVisible();
  await expect(picker.getByText("TAXKEY 3900011001")).toBeVisible();
  // No site profile until the user chooses.
  await expect(page.getByText("Site profile")).toHaveCount(0);

  await picker.getByRole("button", { name: /Unit 201/ }).click();

  await expect(page.getByText("Site profile")).toBeVisible();
  await expect(page.getByText("TAXKEY 3900011001")).toBeVisible();
});
