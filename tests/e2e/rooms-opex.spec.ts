import { expect, test } from "@playwright/test";
import { answerDialogs, login, uniq } from "./helpers";

const lastMonth = () => {
  const n = new Date();
  const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
};

test("room cost: occupancy, full room cost, channels and per-room lines (spec 281)", async ({ page }) => {
  await login(page, "controller");
  await page.goto(`/rooms?${lastMonth()}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Room cost");
  await expect(page.getByText("Cost / occupied night")).toBeVisible();
  await expect(page.getByRole("cell", { name: "OTA" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Villa" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Floor", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Floor" }).first()).toBeVisible();
});

test("operating costs: post an expense, see it in the list, reverse it (immutable ledger)", async ({ page }) => {
  await login(page, "rooms");
  await page.goto("/operations?tab=expenses");
  const desc = `E2E chemicals ${uniq()}`;
  await page.getByLabel("Category", { exact: true }).selectOption("HOUSEKEEPING");
  await page.getByLabel("Sub-category").selectOption("CHEMICALS");
  await page.getByLabel("Department").selectOption({ label: "Housekeeping" });
  await page.getByLabel("Description").fill(desc);
  await page.getByLabel("Net amount").fill("1234.50");
  await page.getByRole("button", { name: "Post expense" }).click();
  await expect(page.getByRole("status").filter({ hasText: "posted" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: desc });
  await expect(row).toContainText("POSTED");
  answerDialogs(page, ["E2E correction"]);
  await row.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByRole("row").filter({ hasText: desc })).toContainText("REVERSED");
  // a rooms-division manager cannot book to the restaurant
  await expect(page.getByLabel("Department").locator("option", { hasText: "Restaurant" })).toHaveCount(0);
});

test("operating cost modules show laundry unit cost, energy and cost per asset", async ({ page }) => {
  await login(page, "controller");
  await page.goto(`/operations?${lastMonth()}&tab=laundry`);
  await expect(page.getByText("Cost / kg")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Bath Towel" })).toBeVisible();
  await page.getByRole("link", { name: "Energy", exact: true }).click();
  await expect(page.getByRole("cell", { name: "ELECTRICITY" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Engineering", exact: true }).click();
  await expect(page.getByText("Cost per asset")).toBeVisible();
});

test("imports: preview flags invalid rows and blocks the import", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/imports");
  await page.getByLabel("Data").selectOption("occupancy");
  await page.getByLabel("CSV content").fill("business_date,available_rooms,occupied_rooms,guests,room_revenue\n2020-01-01,10,12,20,5000");
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 invalid")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
});
