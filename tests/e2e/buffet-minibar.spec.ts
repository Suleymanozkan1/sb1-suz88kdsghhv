import { expect, test } from "@playwright/test";
import { answerDialogs, login, pickProduct } from "./helpers";

test("buffet flow: open session, issue production, classify leftovers, close → cost per cover (spec §280)", async ({ page }) => {
  await login(page, "fb");
  await page.goto("/buffet");
  await page.getByLabel("Meal").selectOption("SPECIAL_EVENT");
  await page.getByLabel("Issue from").selectOption({ label: "Main Store" });
  // The E2E database persists between runs and a meal/outlet/date is unique: walk back one day until a free date is found.
  for (let back = 0; back < 25; back++) {
    const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Date", { exact: true }).fill(d);
    // covers sold are filled in from Micros when known; the test types its own once the defaults for this date have loaded
    await expect(page.getByTestId("new-buffet-session")).toHaveAttribute("aria-busy", "false");
    await page.getByLabel("Covers sold").fill("100");
    await page.getByRole("button", { name: "Open session" }).click();
    const opened = await Promise.race([
      page.waitForURL(/\/buffet\/[^/]+$/, { timeout: 10_000 }).then(() => true),
      page.getByRole("alert").filter({ hasText: `${d} already exists` }).waitFor({ timeout: 10_000 }).then(() => false),
    ]);
    if (opened) break;
  }
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SPECIAL_EVENT buffet");

  await pickProduct(page, "Product", "Cheddar", /Cheddar Slices/);
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Issue to buffet" }).click();
  await expect(page.getByRole("cell", { name: /Cheddar Slices/ }).first()).toBeVisible();

  await page.getByLabel("Actual covers").fill("80");
  await page.getByRole("textbox", { name: /^Waste.*Cheddar Slices/ }).fill("0.3");
  answerDialogs(page, [true]); // confirm close
  await page.getByRole("button", { name: "Close session" }).click();
  await expect(page.getByText("CLOSED", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost / cover")).toBeVisible();
  // closed sessions accept no further lines
  await expect(page.getByRole("button", { name: "Issue to buffet" })).toHaveCount(0);
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
