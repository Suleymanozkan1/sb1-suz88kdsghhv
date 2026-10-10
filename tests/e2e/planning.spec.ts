import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("menu engineering and saving opportunities (spec 133, 199–200, 255)", async ({ page }) => {
  await login(page, "controller");
  const n = new Date();
  const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).toISOString().slice(0, 10);
  await page.goto(`/menu-engineering?from=${from}&to=${to}`);
  await expect(page.getByText("STAR").first()).toBeVisible();
  await page.goto(`/savings?from=${from}&to=${to}`);
  await expect(page.getByText("Reduce recorded waste")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Tender with two alternative suppliers" })).toBeVisible();
  await expect(page.getByText("OVERDUE").first()).toBeVisible();
});
