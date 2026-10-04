import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, login, uniq } from "./helpers";

async function loginAs(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("platform → new tenant → invitation accepted → company admin sees only its own hotel (spec 29-35, 144-145)", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const id = uniq();
  await loginAs(page, "superadmin@hotelcost.test");
  await expect(page).toHaveURL(/\/platform/);
  await expect(page.getByText(/tenant data \(costs, stock, revenue\) is not visible here/)).toBeVisible();
  await page.getByLabel("Company name").fill(`E2E Company ${id}`);
  await page.getByLabel("First hotel code").fill(`E2E${id.slice(-4)}`);
  await page.getByLabel("First hotel name").fill(`E2E Hotel ${id}`);
  await page.getByLabel("Company administrator").fill("E2E Owner");
  await page.getByLabel("Administrator e-mail").fill(`owner-${id.toLowerCase()}@e2e.test`);
  await page.getByRole("button", { name: "Create tenant" }).click();
  const link = await page.getByTestId("invite-link").textContent();
  expect(link).toMatch(/\/invite\?token=/);

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(link!);
  await expect(p2.getByText(`E2E Company ${id}`)).toBeVisible();
  await p2.getByLabel("Your name").fill("E2E Owner");
  await p2.getByLabel(/^Password/).fill("E2e-Str0ng-Pass!");
  await p2.getByLabel("Repeat password").fill("E2e-Str0ng-Pass!");
  await p2.getByRole("button", { name: "Create my account" }).click();
  await expect(p2).toHaveURL(/\/login/);
  await loginAs(p2, `owner-${id.toLowerCase()}@e2e.test`, "E2e-Str0ng-Pass!");
  await expect(p2.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await p2.goto("/admin");
  await expect(p2.getByRole("heading", { level: 1 })).toHaveText("Administration");
  // the new company's admin sees exactly one user (itself) and none of Grand Anatolia's
  await expect(p2.getByText("@grandanatolia.test")).toHaveCount(0);
  await p2.getByRole("tab", { name: "Departments" }).click();
  await expect(p2.getByRole("cell", { name: "Breakfast", exact: true })).toBeVisible();
  // the invitation link cannot be used twice
  await p2.goto(link!);
  await expect(p2.getByText(/invalid, already used or expired/)).toBeVisible();
  await ctx.close();
});

test("company admin invites a department-scoped user; chef cannot open administration", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByLabel("E-mail").fill(`brk-${uniq().toLowerCase()}@grandanatolia.test`);
  await page.getByLabel("Role").selectOption({ label: "Breakfast Chef" });
  await page.getByRole("checkbox", { name: "Breakfast" }).first().check();
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite?token=");
  await expect(page.getByRole("row").filter({ hasText: "OPEN" }).first()).toBeVisible();

  const chef = await page.context().browser()!.newContext();
  const cp = await chef.newPage();
  await login(cp, "chef");
  await expect(cp.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await cp.goto("/admin");
  await expect(cp.getByText(/admin:users/)).toBeVisible();
  const res = await cp.request.post("/api/admin/users", { data: { email: "x@x.test", name: "Xx", password: "Str0ng-Passw0rd!", roleKey: "admin" } });
  expect(res.status()).toBe(403);
  await chef.close();
});
