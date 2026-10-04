import { expect, test } from "@playwright/test";
import { answerDialogs, login, pickProduct, uniq } from "./helpers";

test.describe("authentication & navigation", () => {
  test("rejects bad credentials and lands on dashboard after login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Email").fill("controller@grandanatolia.test");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Invalid" })).toContainText("Invalid email or password");
    await login(page, "controller");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cost intelligence");
    await expect(page.getByText("Actual cost (inventory)")).toBeVisible();
    await expect(page.getByText("Unexplained variance")).toBeVisible();
  });
});

test("purchase flow: receipt posts stock and appears in the ledger (spec §284)", async ({ page }) => {
  await login(page, "warehouse");
  await page.goto("/purchasing");
  const inv = `E2E-${uniq()}`;
  await page.getByLabel("Invoice no").fill(inv);
  await pickProduct(page, "Product 1", "Tomato", /Tomato/);
  await page.getByLabel("Qty").fill("12");
  await page.getByLabel("Unit price (net)").fill("40");
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expect(page.getByRole("status")).toContainText("posted");
  await expect(page.getByRole("cell", { name: inv })).toBeVisible();
  await page.goto("/inventory/ledger?type=PURCHASE");
  await expect(page.getByRole("cell", { name: "Tomato" }).first()).toBeVisible();
});

test("recipe flow: create with live server-side cost, approve, view cost explosion (spec §279)", async ({ page }) => {
  await login(page, "fb");
  await page.goto("/recipes/new");
  const code = `E2E${uniq()}`;
  await page.getByLabel("Code", { exact: true }).fill(code);
  await page.getByLabel("Menu / product name").fill(`E2E Chicken Bowl ${code}`);
  await page.getByLabel("Usable portions").fill("4");
  await page.getByLabel("Batch yield").fill("4");
  await page.getByLabel("Selling price (net)").fill("300");
  await pickProduct(page, "Search ingredient", "Chicken Breast", /Chicken Breast/);
  await page.getByLabel("Qty (EP)").fill("600");
  await expect(page.getByText("Cost per portion")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E Chicken Bowl");
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
  // F&B manager has recipe:approve
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("cell", { name: "APPROVED" })).toBeVisible();
  await expect(page.getByText("Cost explosion")).toBeVisible();
  await expect(page.getByRole("cell", { name: /Chicken Breast/ })).toBeVisible();
});

test("waste flow: small waste posts at cost and reduces stock (spec §283)", async ({ page }) => {
  await login(page, "fb");
  await page.goto("/waste");
  await pickProduct(page, "Product", "Lettuce", /Iceberg Lettuce/);
  await page.getByLabel("Department").first().selectOption({ label: "Restaurant" });
  await page.getByLabel("Quantity").fill("100");
  await page.getByLabel("Unit").selectOption("g");
  await page.getByLabel("Reason").fill("E2E wilted leaves");
  await page.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByRole("status")).toContainText("Waste posted at cost");
  await expect(page.getByText("E2E wilted leaves").first()).toBeVisible();
});

test("stock delete → request → manager rejects then approves → reversal (spec §285)", async ({ page, browser }) => {
  const tag = uniq();
  await login(page, "warehouse");
  answerDialogs(page, [`E2E duplicate delivery note ${tag}`, true, `E2E second request ${tag}`, true]);
  await page.goto("/inventory/ledger?type=PURCHASE");
  await page.getByRole("button", { name: "Request delete" }).first().click();
  await expect(page.getByRole("button", { name: "Request delete" }).first()).toBeEnabled();

  const mgrCtx = await browser.newContext();
  const mgr = await mgrCtx.newPage();
  answerDialogs(mgr, ["Delivery note checked — not a duplicate", "ok"]);
  await login(mgr, "controller");
  await mgr.goto("/approvals");
  const row = mgr.getByRole("row", { name: new RegExp(`E2E duplicate delivery note ${tag}`) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reject" }).click();
  await expect(mgr.getByRole("row", { name: new RegExp(`E2E duplicate delivery note ${tag}`) }).getByRole("button", { name: "Reject" })).toHaveCount(0);

  // second request on the same entry, approved → controlled reversal
  await page.reload();
  await page.getByRole("button", { name: "Request delete" }).first().click();
  await expect(page.getByRole("button", { name: "Request delete" }).first()).toBeEnabled();
  await mgr.reload();
  const row2 = mgr.getByRole("row", { name: new RegExp(`E2E second request ${tag}`) });
  await row2.getByRole("button", { name: "Approve" }).click();
  await expect(mgr.getByRole("row", { name: new RegExp(`E2E second request ${tag}`) }).getByRole("button", { name: "Approve" })).toHaveCount(0);
  await mgr.goto("/inventory/ledger?type=REVERSAL");
  await expect(mgr.getByText("REVERSAL").first()).toBeVisible();
  await mgrCtx.close();
});

test("variance page reconciles and export is permission-gated (spec §243)", async ({ page, request }) => {
  await login(page, "controller");
  await page.goto("/variance");
  await expect(page.getByText("= Actual usage (COGS)")).toBeVisible();
  await expect(page.getByText("= Unexplained")).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

  const ctx = await page.context().storageState();
  expect(ctx.cookies.some((c) => c.name === "hc_session")).toBeTruthy();
  const anon = await request.get("/api/variance");
  expect(anon.status()).toBe(401);
});

test("department isolation in the UI and API (spec §242, §274)", async ({ page }) => {
  await login(page, "pastry");
  await page.goto("/recipes");
  await expect(page.getByRole("link", { name: "Tiramisu" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Classic Burger" })).toHaveCount(0);
  // nav does not offer purchasing; direct API call is refused server-side
  await expect(page.getByRole("link", { name: "Purchasing" })).toHaveCount(0);
  const res = await page.request.post("/api/receipts", { data: {}, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(403);
  // foreign hotel id (IDOR)
  const idor = await page.request.get("/api/products?hotelId=some-other-hotel");
  expect(idor.status()).toBe(403);
  // cross-origin mutation rejected (CSRF)
  const csrf = await page.request.post("/api/waste", { data: {}, headers: { origin: "https://evil.example" } });
  expect(csrf.status()).toBe(403);
});

test("Excel export: page offers .xlsm download and one-time API token (spec 2, 102, 123)", async ({ page }) => {
  await login(page, "controller");
  await page.getByRole("link", { name: "Excel Export" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Excel full cost report");
  await page.getByLabel("Start date").fill("2026-09-01");
  await page.getByLabel("End date").fill("2026-09-30");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Download .xlsm" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^HotelCost_Cost_Report_GAR_2026_09\.xlsm$/);
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("api-token").textContent();
  expect(token).toMatch(/^hc_[0-9a-f]{64}$/);
  // the token authenticates the Excel refresh endpoint (TSV contract)
  const res = await page.request.get("/api/export/full-cost?format=tsv&from=2026-09-01&to=2026-09-30", { headers: { authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  expect((await res.text()).startsWith("##EXPORT\t1.2")).toBe(true);
  // chefs cannot export
  const chefCtx = await page.context().browser()!.newContext();
  const chef = await chefCtx.newPage();
  await login(chef, "chef");
  await expect(chef.getByRole("link", { name: "Excel Export" })).toHaveCount(0);
  expect((await chef.request.get("/api/export/full-cost")).status()).toBe(403);
  await chefCtx.close();
});
