import { chromium, type Page } from "@playwright/test";
const BASE = "http://localhost:3000";
async function rows(page: Page) { return page.locator("table tbody tr").count(); }
async function check(page: Page, path: string, change: (p: Page) => Promise<void>, expectParam: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
  const url0 = page.url(); const r0 = await rows(page);
  await change(page);
  await page.waitForTimeout(1500);
  const sameUrl = page.url() === url0; const r1 = await rows(page);
  const btn = page.locator("form button[type=submit]", { hasText: "Filtrele" }).first();
  await Promise.all([page.waitForURL((u) => u.toString().includes(expectParam), { timeout: 60_000 }), btn.click()]);
  await page.waitForLoadState("networkidle");
  const r2 = await rows(page);
  const pdf = await page.locator("a[download]", { hasText: "PDF" }).first().getAttribute("href").catch(() => null);
  console.log(JSON.stringify({ path, beforeSubmit: { sameUrl, rowsUnchanged: r0 === r1 }, after: { url: page.url().replace(BASE, ""), rows: r2, pdfHasFilter: pdf ? pdf.includes(expectParam) : "no-export" } }));
}
async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "tr-TR" });
  await ctx.addCookies([{ name: "hc_lang", value: "tr", url: BASE }]);
  const page = await ctx.newPage();
  const email = process.env.USER_EMAIL ?? "admin@grandanatolia.test";
  await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: "HotelCost!2026" }, headers: { origin: BASE } });
  const steps = (process.env.STEPS ?? "ledger,ledgerdate,products,recipes,auto,variance,waste,roomexp,savings").split(",");
  for (const s of steps) {
    try {
      if (s === "ledger") await check(page, "/inventory/ledger", async (p) => { await p.locator("#lf-type").selectOption({ index: 1 }); }, "type=");
      if (s === "ledgerdate") await check(page, "/inventory/ledger", async (p) => { await p.locator("#fb-from").fill("2026-09-01"); }, "from=2026-09-01");
      if (s === "products") await check(page, "/products", async (p) => { await p.locator("#pf-q").fill("milk"); await p.locator("#pf-q").press("Tab"); }, "q=milk");
      if (s === "recipes") await check(page, "/recipes", async (p) => { await p.locator("#rf-type").selectOption({ index: 1 }); }, "type=");
      if (s === "auto") await check(page, "/purchasing/orders?tab=auto", async (p) => { await p.locator("#ao-q").fill("zzz"); }, "q=zzz");
      if (s === "variance") await check(page, "/variance", async (p) => { await p.locator("#group").selectOption("FOOD"); }, "group=FOOD");
      if (s === "waste") await check(page, "/waste", async (p) => { await p.locator("#fb-from").fill("2026-09-01"); }, "from=2026-09-01");
      if (s === "roomexp") await check(page, "/rooms/expenses", async (p) => { await p.locator("#rc-month").fill("2026-09"); }, "month=2026-09");
      if (s === "savings") await check(page, "/savings", async (p) => { await p.locator("#fb-from").fill("2026-09-01"); }, "from=2026-09-01");
    } catch (e) { console.log(JSON.stringify({ step: s, error: String(e).slice(0, 300) })); }
  }
  await browser.close();
}
void main();
