import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const lastMonth = () => {
  const n = new Date();
  return { y: n.getUTCMonth() === 0 ? n.getUTCFullYear() - 1 : n.getUTCFullYear(), m: n.getUTCMonth() === 0 ? 12 : n.getUTCMonth() };
};

test("budget vs actual and targets (spec 192–194)", async ({ page }) => {
  const { y, m } = lastMonth();
  await login(page, "controller");
  await page.goto(`/budget?year=${y}&month=${m}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Budget");
  await expect(page.getByRole("cell", { name: "TOTAL COST" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "LABOR", exact: true })).toBeVisible();
  await expect(page.getByText("APPROVED").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Waste % \(waste/ })).toBeVisible();
});

test("forecast with scenarios and a what-if question (spec 195–198)", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/forecast");
  await expect(page.getByRole("heading", { name: "Scenarios (spec 197)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "FOOD", exact: true })).toBeVisible();
  await page.getByLabel("Ingredient").selectOption({ label: "Chicken Breast" });
  await page.getByLabel("Price %").fill("20");
  await page.getByLabel("Labor %").fill("8");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByRole("cell", { name: "Chicken Breast price +20.0%" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Total cost impact / month" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Affected recipe" })).toBeVisible();
});

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
