import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// audit FE-04: the first Tab stop skips the hotel picker and the menu (WCAG 2.4.1)
test("skip link: the first Tab reaches 'Skip to main content', Enter moves focus to the page", async ({ page }) => {
  await login(page, "admin");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
});
