import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { answerDialogs, login } from "./helpers";

test("calculation integrity: check runs and balances rebuild is audited (spec 300–305)", async ({ page }) => {
  await login(page, "controller");
  await page.goto("/integrity");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Calculation integrity/i);
  await page.getByRole("button", { name: "Run integrity check" }).click();
  await expect(page.getByText(/^Result:/)).toBeVisible({ timeout: 60_000 });
  const balances = page.getByRole("row").filter({ hasText: /balance/i }).first();
  await expect(balances.getByText("PASS")).toBeVisible();
  answerDialogs(page, ["E2E rebuild check"]);
  await page.getByRole("button", { name: "Rebuild balances from ledger" }).click();
  await expect(page.getByText(/Balances already match the ledger|balance\(s\) corrected/)).toBeVisible({ timeout: 60_000 });
});

test("integrity tools are hidden from roles without audit rights", async ({ page }) => {
  await login(page, "chef");
  await expect(page.getByRole("link", { name: "Calculation Integrity" })).toHaveCount(0);
  const res = await page.request.post("/api/integrity/rebuild", { data: { reason: "x" } });
  expect(res.status()).toBe(403);
});

// Accessibility smoke (spec 316): no serious/critical WCAG A/AA violations on the main screens.
// Production CSP (no 'unsafe-eval') must not block anything the app needs.
// One login for all screens (the login endpoint is rate-limited per IP).
const SCREENS = ["/", "/variance", "/inventory", "/recipes", "/buffet", "/rooms", "/budget", "/reports", "/integrity", "/excel"];
test("a11y + CSP on the main screens", async ({ page }) => {
  test.setTimeout(180_000);
  const cspErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) cspErrors.push(`${page.url()}: ${m.text()}`);
  });
  await login(page, "controller");
  const found: string[] = [];
  for (const path of SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    for (const v of r.violations.filter((x) => x.impact === "serious" || x.impact === "critical")) found.push(`${path} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  }
  expect(found).toEqual([]);
  expect(cspErrors).toEqual([]);
});

test("a11y: login screen", async ({ page }) => {
  await page.goto("/login");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});

test("background Excel export: queue, wait, download (spec 292–293)", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "controller");
  await page.goto("/excel");
  await page.getByRole("button", { name: "Generate in background" }).click();
  const row = page.getByRole("region", { name: "Background exports" }).getByRole("row").nth(1);
  await expect(row.getByText("COMPLETED")).toBeVisible({ timeout: 150_000 });
  const download = page.waitForEvent("download");
  await row.getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toMatch(/^HotelCost_Cost_Report_.*\.xlsm$/);
});

test("stored XSS is rendered as text; oversized and malformed uploads are refused (spec 115)", async ({ page }) => {
  await login(page, "controller");
  const origin = new URL(page.url()).origin;
  let alerted = false;
  page.on("dialog", async (d) => {
    alerted = true;
    await d.dismiss();
  });
  const payload = `<img src=x onerror=alert('xss')>`;
  const sku = `XSS-${Date.now().toString(36)}`;
  const anyProduct = (await (await page.request.get("/api/products?q=Chicken")).json()) as Array<{ categoryId: string }>;
  const created = await page.request.post("/api/products", { headers: { origin }, data: { sku, name: payload, categoryId: anyProduct[0]!.categoryId, purchaseUnit: "kg", stockUnit: "kg", recipeUnit: "g" } });
  expect(created.ok()).toBe(true);
  await page.goto(`/products?q=${encodeURIComponent(sku)}`);
  await expect(page.getByText(payload).first()).toBeVisible();
  expect(alerted).toBe(false);
  expect(await page.locator("img[src='x']").count()).toBe(0);

  const big = await page.request.post("/api/products", { headers: { origin, "content-type": "application/json" }, data: JSON.stringify({ sku: "BIG", name: "x".repeat(6 * 1024 * 1024) }) });
  expect(big.status()).toBe(413);
  const broken = await page.request.post("/api/products", { headers: { origin, "content-type": "application/json" }, data: "{not json" });
  expect(broken.status()).toBe(422);
  const csrf = await page.request.post("/api/products", { headers: { origin: "https://evil.example" }, data: { sku: "CSRF" } });
  expect(csrf.status()).toBe(403);
});
