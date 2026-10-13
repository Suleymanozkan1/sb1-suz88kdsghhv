import { expect, test } from "@playwright/test";
import { login, pickProduct } from "./helpers";

test("breakfast flow: day, covers, issue, breakfast count → cost per cover (r3 §4)", async ({ page }) => {
  await login(page, "fb");
  await page.goto("/buffet");
  // meal (breakfast only) and date (today by default): the day's record is opened, or created the first time
  await expect(page.getByLabel("Meal").locator("option")).toHaveText(["Breakfast"]);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/buffet\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Breakfast ·");
  await page.getByLabel(/^Package-included breakfast/).fill("110");
  await page.getByLabel(/^Breakfast not included/).fill("10");
  await page.getByRole("button", { name: "Save covers" }).click();
  await expect(page.getByTestId("breakfast-covers").getByText("Saved.")).toBeVisible();
  await pickProduct(page, "Product", "Cheddar", /Cheddar Slices/);
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Issue to breakfast" }).click();
  await expect(page.getByRole("cell", { name: /Cheddar Slices/ }).first()).toBeVisible();
  // the count: remaining quantity, F marks the remainder as waste, Enter moves on (last row → Save)
  await page.getByRole("link", { name: /Breakfast count/ }).first().click();
  await page.waitForURL(/\/buffet\/count/);
  const box = page.getByRole("textbox", { name: /^Remaining .*Cheddar/ });
  await box.fill("0.2");
  await box.press("f");
  await expect(page.getByRole("radiogroup", { name: /Cheddar/ }).getByRole("radio", { name: "Waste" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /^Save count/ }).click();
  await expect(page.getByText("Breakfast count saved.")).toBeVisible();
  await page.getByRole("link", { name: "Open the breakfast day" }).click();
  await expect(page.getByText("Cost / cover")).toBeVisible();
  await expect(page.getByText("CLOSED", { exact: true })).toHaveCount(0); // no open / closed service any more
});

test("minibar flow: restock a room to par and charge consumption (spec §282)", async ({ page }) => {
  await login(page, "warehouse");
  await page.goto("/minibar");
  await page.getByRole("button", { name: "205", exact: true }).click();
  await expect(page.getByText("Room 205")).toBeVisible();
  await page.getByRole("button", { name: "Restock to par" }).click();
  // a room already at par says so instead of claiming a restock
  await expect(page.getByRole("status").filter({ hasText: /Restocked to par|Already at par/ })).toBeVisible();
  await page.getByLabel("Folio").fill("F-E2E");
  await page.getByRole("textbox", { name: /^CONSUMED .*Cola/ }).fill("1");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Posted" })).toBeVisible();
});
