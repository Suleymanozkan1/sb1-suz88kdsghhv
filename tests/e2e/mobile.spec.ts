import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobile: menu opens and waste entry is usable without horizontal overflow (spec §269)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("fb@grandanatolia.test");
  await page.getByLabel("Password").fill("HotelCost!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Waste", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Waste");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  void login;
});
