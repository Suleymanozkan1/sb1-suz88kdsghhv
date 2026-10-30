import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// the audit measured on a 390 px wide phone (Pixel 7 default is 412)
test.use({ viewport: { width: 390, height: 844 } });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("mobile: menu opens and waste entry is usable without horizontal overflow (spec §269)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("fb@grandanatolia.test");
  await page.getByLabel("Password").fill("HotelCost!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Waste", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Waste");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

// Every page of the role's main menu fits a phone screen: wide tables scroll inside their own region, the page
// itself never scrolls sideways (audit FE-01: dashboard, review, variance, budget and forecast overflowed by up to 1200 px).
for (const user of ["admin", "fb", "breakfast"]) {
  test(`mobile: no menu page of ${user} scrolls sideways`, async ({ page }) => {
    test.setTimeout(240_000);
    await login(page, user);
    const hrefs = await page.locator("aside nav a").evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))]);
    expect(hrefs.length).toBeGreaterThan(3);
    const wide: string[] = [];
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const px = await overflow(page);
      if (px > 1) wide.push(`${href} +${px}px`);
    }
    expect(wide).toEqual([]);
  });
}
