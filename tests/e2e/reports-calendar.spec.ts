import { expect, test } from "@playwright/test";
import { answerDialogs, login, uniq } from "./helpers";

test("management pack PDF downloads and its archive entry reproduces (spec 252–254)", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/reports");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download management pack/ }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^HotelCost_Management_Pack_.*\.pdf$/);
  await page.waitForLoadState("load");
  const row = page.getByRole("row").filter({ hasText: "Management pack (PDF)" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Verify" }).click();
  await expect(row.getByText("REPRODUCIBLE")).toBeVisible({ timeout: 30_000 });
});

test("imports: product master preview from CSV flags duplicates and invalid rows (spec 246)", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/imports");
  await page.getByLabel("Data").selectOption("products");
  const sku = `E2E-${uniq()}`;
  await page.getByLabel("CSV content").fill(`sku,name,category,stock_unit\n${sku},E2E Item,Vegetables,kg\nCHK-BREAST,Dup,Chicken,kg\nX-1,Bad,NoSuchCategory,kg`);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 valid")).toBeVisible();
  await expect(page.getByText("1 duplicate")).toBeVisible();
  await expect(page.getByText("1 invalid")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
});

test("control calendar: overdue control can be marked done; weekly review renders (spec 257–258)", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Cost control calendar");
  const overdue = page.getByRole("row").filter({ hasText: "OVERDUE" }).first();
  if (await overdue.count()) {
    answerDialogs(page, ["E2E check"]);
    const title = (await overdue.getByRole("cell").nth(1).textContent()) ?? "";
    const due = (await overdue.getByRole("cell").nth(0).textContent()) ?? "";
    await overdue.getByRole("button", { name: "Mark done" }).click();
    await expect(page.getByRole("row").filter({ hasText: title }).filter({ hasText: due }).first()).toContainText("DONE");
  }
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Top 10 waste items" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Critical stock" })).toBeVisible();
});
