/**
 * Every main write flow, through the UI, as the demo users on a generated demo dataset (5 companies, 10 hotels).
 * Company A = "Demo Hotel Group" (short addresses @test.local), first hotel DHG-IST.
 * Run: npx playwright test -c playwright.demo.config.ts
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo!2026-QA";
const uniq = () => Date.now().toString(36).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const lastMonth = () => {
  const n = new Date();
  const from = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0)).toISOString().slice(0, 10);
  return { from, to };
};

async function signIn(page: Page, email: string, hotelCode = "DHG-IST") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  const sel = page.locator("select#hotel");
  if (await sel.count()) {
    const opt = sel.locator("option", { hasText: hotelCodeName[hotelCode] ?? hotelCode });
    if ((await opt.count()) && (await sel.inputValue()) !== (await opt.getAttribute("value"))) {
      await sel.selectOption((await opt.getAttribute("value"))!);
      await expect(sel).toHaveValue((await opt.getAttribute("value"))!);
      await page.waitForLoadState("networkidle");
    }
  }
}
const hotelCodeName: Record<string, string> = { "DHG-IST": "Demo Grand İstanbul", "DHG-AYT": "Demo Lara Antalya", "DHG-IZM": "Demo Kordon İzmir" };

function answerDialogs(page: Page, answers: Array<string | true>) {
  const queue = [...answers];
  page.on("dialog", async (d) => {
    const a = queue.shift();
    if (a === undefined) return d.dismiss();
    await d.accept(a === true ? undefined : a);
  });
}

async function pickProduct(page: Page, label: string | RegExp, search: string, option: string | RegExp) {
  const box = page.getByLabel(label);
  await box.click();
  await box.fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

test("dashboard and hotel switch: controller sees each of its 3 hotels, no other company", async ({ page }) => {
  await signIn(page, "controller@test.local");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Cost intelligence");
  const options = await page.locator("select#hotel option").allTextContents();
  expect(options.sort()).toEqual(["Demo Grand İstanbul", "Demo Kordon İzmir", "Demo Lara Antalya"]);
  for (const name of ["Demo Lara Antalya", "Demo Kordon İzmir"]) {
    await page.locator("select#hotel").selectOption({ label: name });
    await page.waitForLoadState("networkidle");
    await page.goto("/products");
    await expect(page.locator("select#hotel option:checked")).toHaveText(name);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("purchase receipt (warehouse) posts stock and shows in the ledger", async ({ page }) => {
  await signIn(page, "warehouse@test.local");
  await page.goto("/purchasing");
  const inv = `DEMO-E2E-${uniq()}`;
  await page.getByLabel("Invoice no").fill(inv);
  await pickProduct(page, "Product 1", "Tomato", /^Tomato/);
  await page.getByLabel("Qty").fill("12");
  await page.getByLabel("Unit price (net)").fill("40");
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expect(page.getByRole("status")).toContainText("posted");
  await expect(page.getByRole("cell", { name: inv })).toBeVisible();
  await page.goto("/inventory/ledger?type=PURCHASE");
  await expect(page.getByRole("cell", { name: "Tomato", exact: true }).first()).toBeVisible();
});

test("stock correction: warehouse requests delete, controller approves → reversal", async ({ page, browser }) => {
  const tag = uniq();
  await signIn(page, "warehouse@test.local");
  answerDialogs(page, [`Demo duplicate delivery ${tag}`, true]);
  await page.goto("/inventory/ledger?type=PURCHASE");
  await page.getByRole("button", { name: "Request delete" }).first().click();
  await expect(page.getByRole("button", { name: "Request delete" }).first()).toBeEnabled();

  const ctx = await browser.newContext();
  const mgr = await ctx.newPage();
  answerDialogs(mgr, ["checked"]);
  await signIn(mgr, "controller@test.local");
  await mgr.goto("/approvals");
  const row = mgr.getByRole("row", { name: new RegExp(`Demo duplicate delivery ${tag}`) });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(mgr.getByRole("row", { name: new RegExp(`Demo duplicate delivery ${tag}`) }).getByRole("button", { name: "Approve" })).toHaveCount(0);
  await mgr.goto("/inventory/ledger?type=REVERSAL");
  await expect(mgr.getByText("REVERSAL").first()).toBeVisible();
  await ctx.close();
});

test("waste (chef) posts at cost", async ({ page }) => {
  await signIn(page, "chef@test.local");
  await page.goto("/waste");
  await pickProduct(page, "Product", "Lettuce", /Lettuce Iceberg/);
  await page.getByLabel("Department").first().selectOption({ index: 0 });
  await page.getByLabel("Quantity").fill("50");
  await page.getByLabel("Unit").selectOption("g");
  const reason = `Demo wilted ${uniq()}`;
  await page.getByLabel("Reason").fill(reason);
  await page.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByRole("status")).toContainText(/line\(s\) posted|approval/);
  await expect(page.getByText(reason).first()).toBeVisible();
});

test("stock count (warehouse): start a sheet, count one line, submit", async ({ page }) => {
  await signIn(page, "warehouse@test.local");
  await page.goto("/inventory/counts");
  await page.getByLabel("Warehouse").selectOption({ label: "Bar Warehouse" });
  await page.getByLabel("Count date").fill(today());
  await page.getByRole("button", { name: "Start count sheet" }).click();
  await page.waitForLoadState("networkidle");
  const open = page.getByRole("link", { name: /Bar Warehouse/ }).first();
  if (await open.count()) await open.click();
  const counted = page.getByRole("textbox", { name: /^Counted / }).first();
  await expect(counted).toBeVisible();
  const label = (await counted.getAttribute("aria-label"))!.replace(/^Counted /, "");
  await counted.fill("1");
  await page.getByRole("textbox", { name: `Reason ${label}` }).fill("demo e2e count");
  await page.getByRole("button", { name: "Submit & post" }).click();
  await expect(page.getByText(/Count posted to the ledger|sent for manager approval/)).toBeVisible();
});

test("recipe (F&B manager): create with live cost, approve, cost explosion", async ({ page }) => {
  await signIn(page, "fbm@test.local");
  await page.goto("/recipes/new");
  const code = `DEMO${uniq()}`;
  await page.getByLabel("Code (optional)", { exact: true }).fill(code);
  await page.getByLabel("Menu / product name").fill(`Demo Wings Plate ${code}`);
  await page.getByLabel("Portions").fill("4");
  await page.getByLabel("Selling price (net)").fill("350");
  await pickProduct(page, "Search ingredient", "Chicken Wings", /Chicken Wings/);
  await page.getByLabel("Quantity used").fill("800");
  await expect(page.getByText("Cost per portion")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo Wings Plate");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("cell", { name: "APPROVED" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /Chicken Wings/ }).first()).toBeVisible();
});

test("POS sales import (controller): preview and commit two lines", async ({ page }) => {
  await signIn(page, "controller@test.local");
  await page.goto("/sales");
  const id = uniq();
  const csv = `external_id,sale_date,department,pos_code,quantity,net_revenue\nDEMO-${id}-1,${today()},REST,RST-001,2,1800\nDEMO-${id}-2,${today()},REST,RST-002,1,950\n`;
  await page.getByLabel("Sales CSV file").setInputFiles({ name: `demo-${id}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("2 valid")).toBeVisible();
  await page.getByRole("button", { name: "Commit 2 lines" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Imported 2 lines" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `demo-${id}.csv` })).toContainText("POSTED");
});

test("buffet (F&B manager): open session, issue, leftovers, close → cost per cover", async ({ page }) => {
  await signIn(page, "fbm@test.local");
  await page.goto("/buffet");
  await page.getByLabel("Meal").selectOption("SPECIAL_EVENT");
  await page.getByLabel("Issue from").selectOption({ label: "Main Warehouse" });
  await page.getByLabel("Covers sold").fill("120");
  for (let back = 0; back < 25; back++) {
    const d = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Date", { exact: true }).fill(d);
    // decide on this attempt's answer: the "already exists" alert of a previous attempt can still be on screen
    const answer = page.waitForResponse((r) => r.url().endsWith("/api/buffet/sessions") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Open session" }).click();
    if ((await answer).ok()) {
      await page.waitForURL(/\/buffet\/[^/]+$/);
      break;
    }
  }
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SPECIAL_EVENT buffet");
  await pickProduct(page, "Product", "Chicken Wings", /Chicken Wings/);
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Issue to buffet" }).click();
  await expect(page.getByRole("cell", { name: /Chicken Wings/ }).first()).toBeVisible();
  await page.getByLabel("Actual covers").fill("100");
  await page.getByRole("textbox", { name: /^Waste.*Chicken Wings/ }).fill("0.2");
  answerDialogs(page, [true]);
  await page.getByRole("button", { name: "Close session" }).click();
  await expect(page.getByText("CLOSED", { exact: true })).toBeVisible();
  await expect(page.getByText("Cost / cover")).toBeVisible();
});

test("minibar (warehouse): restock a room to par and charge consumption", async ({ page }) => {
  await signIn(page, "warehouse@test.local");
  await page.goto("/minibar");
  await page.getByRole("button", { name: "105", exact: true }).click();
  await expect(page.getByText("Room 105")).toBeVisible();
  await page.getByRole("button", { name: "Restock to par" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Restocked to par|Already at par/ })).toBeVisible();
  await page.getByLabel("Folio").fill("F-DEMO");
  await page.getByRole("textbox", { name: /^CONSUMED .*Cola 330ml/ }).first().fill("1");
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Posted" })).toBeVisible();
});

test("operating expense (rooms division): post and reverse", async ({ page }) => {
  await signIn(page, "rooms@test.local");
  await page.goto("/operations?tab=expenses");
  const desc = `Demo chemicals ${uniq()}`;
  await page.getByLabel("Category", { exact: true }).selectOption("HOUSEKEEPING");
  await page.getByLabel("Sub-category").selectOption("CHEMICALS");
  await page.getByLabel("Department").selectOption({ label: "Housekeeping" });
  await page.getByLabel("Description").fill(desc);
  await page.getByLabel("Net amount").fill("980.40");
  await page.getByRole("button", { name: "Post expense" }).click();
  await expect(page.getByRole("status").filter({ hasText: "posted" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: desc });
  await expect(row).toContainText("POSTED");
  answerDialogs(page, ["demo correction"]);
  await row.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByRole("row").filter({ hasText: desc })).toContainText("REVERSED");
});

test("reports on demo data: variance, rooms, budget, forecast what-if, menu engineering, savings", async ({ page }) => {
  const { from, to } = lastMonth();
  await signIn(page, "controller@test.local");
  await page.goto(`/variance?from=${from}&to=${to}`);
  await expect(page.getByText("= Unexplained")).toBeVisible();
  await page.goto(`/rooms?from=${from}&to=${to}`);
  await expect(page.getByText("Cost / occupied night")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Suite" }).first()).toBeVisible();
  const [y, m] = from.split("-");
  await page.goto(`/budget?year=${y}&month=${Number(m)}`);
  await expect(page.getByRole("cell", { name: "TOTAL COST" })).toBeVisible();
  await page.goto("/forecast");
  await page.getByLabel("Ingredient").selectOption({ label: "Chicken Breast" });
  await page.getByLabel("Price %").fill("15");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByRole("cell", { name: "Chicken Breast price +15.0%" })).toBeVisible();
  await page.goto(`/menu-engineering?from=${from}&to=${to}`);
  await expect(page.getByText(/STAR|PLOWHORSE|PUZZLE|DOG/).first()).toBeVisible();
  await page.goto(`/operations?from=${from}&to=${to}&tab=energy`);
  await expect(page.getByRole("cell", { name: "ELECTRICITY" }).first()).toBeVisible();
  await page.goto("/allocation");
  await expect(page.getByText("POSTED").first()).toBeVisible();
});

test("Excel .xlsm (sync), background export and PDF management pack", async ({ page }) => {
  test.setTimeout(300_000);
  const { from, to } = lastMonth();
  await signIn(page, "controller@test.local");
  await page.goto("/excel");
  await page.getByLabel("Start date").fill(from);
  await page.getByLabel("End date").fill(to);
  const [d1] = await Promise.all([page.waitForEvent("download", { timeout: 180_000 }), page.getByRole("button", { name: "Download .xlsm" }).click()]);
  expect(d1.suggestedFilename()).toMatch(/^HotelCost_Cost_Report_DHG-IST_.*\.xlsm$/);
  await page.getByRole("button", { name: "Generate in background" }).click();
  const row = page.getByRole("region", { name: "Background exports" }).getByRole("row").nth(1);
  await expect(row.getByText("COMPLETED")).toBeVisible({ timeout: 200_000 });
  await page.goto("/reports");
  const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), page.getByRole("button", { name: /Download management pack/ }).click()]);
  expect(d2.suggestedFilename()).toMatch(/\.pdf$/);
});

test("integrity and data quality: clean company passes, QA tenant shows every intentional error", async ({ page, browser }) => {
  await signIn(page, "controller@test.local");
  await page.goto("/integrity");
  await page.getByRole("button", { name: "Run integrity check" }).click();
  const tenantRow = page.getByRole("row").filter({ hasText: "tenant integrity" });
  await expect(tenantRow).toContainText("PASS", { timeout: 60_000 });
  const ctx = await browser.newContext();
  const qa = await ctx.newPage();
  await signIn(qa, "controller@demo-all-inclusive.test.local", "DAI-BLK");
  await qa.goto("/data-quality");
  for (const t of ["Purchase unit without a conversion", "Negative inventory", "Sales or waste dated in the future"]) {
    await expect(qa.getByText(t).first()).toBeVisible();
  }
  await ctx.close();
});

test("company admin: create a department, invite a user; viewer cannot write", async ({ page, browser }) => {
  const id = uniq();
  await signIn(page, "companyadmin@test.local");
  await page.goto("/admin");
  await page.getByRole("tab", { name: "Departments" }).click();
  await page.getByLabel("Code").fill(`D${id.slice(-5)}`);
  await page.getByLabel("Name").fill(`Demo Spa ${id}`);
  await page.getByRole("button", { name: "Create department" }).click();
  await expect(page.getByRole("cell", { name: `Demo Spa ${id}` })).toBeVisible();
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByLabel("E-mail").fill(`invitee-${id.toLowerCase()}@demo.test`);
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite?token=");
  // no user of another company is listed
  await page.getByRole("tab", { name: "Users" }).click();
  await expect(page.getByText(/@demo-resort-group\.test\.local/)).toHaveCount(0);

  const ctx = await browser.newContext();
  const v = await ctx.newPage();
  await signIn(v, "user002@demo-hotel-group.test.local");
  await v.goto("/waste");
  await expect(v.getByRole("button", { name: "Record waste" })).toHaveCount(0);
  const res = await v.request.post("/api/waste", { data: {}, headers: { origin: new URL(v.url()).origin } });
  expect(res.status()).toBe(403);
  await ctx.close();
});

test("platform admin: tenants listed without tenant data; new tenant created", async ({ page }) => {
  const id = uniq();
  await page.goto("/login");
  await page.getByLabel("Email").fill("superadmin@test.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/platform/);
  for (const n of ["Demo Hotel Group", "Demo Resort Group", "Demo City Hotel", "Demo Boutique Hotel", "Demo All Inclusive"]) await expect(page.getByRole("cell", { name: new RegExp(n) })).toBeVisible();
  await page.getByLabel("Company name").fill(`Demo New Co ${id}`);
  await page.getByLabel("First hotel code").fill(`N${id.slice(-5)}`);
  await page.getByLabel("First hotel name").fill(`Demo New Hotel ${id}`);
  await page.getByLabel("Company administrator").fill("Owner");
  await page.getByLabel("Administrator e-mail").fill(`owner-${id.toLowerCase()}@demo.test`);
  await page.getByRole("button", { name: "Create tenant" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite?token=");
  // tenant data is not reachable for the platform operator
  expect((await page.request.get("/api/products")).status()).toBeGreaterThanOrEqual(400);
});
