/**
 * QA helper: sign in to the running app and screenshot pages (Turkish UI). Not part of the product.
 *   npx tsx scripts/qa/shot.ts <out-dir> <path> [<path> …]
 * Env: BASE (default http://localhost:3000), USER_EMAIL (default admin@grandanatolia.test), USER_PASSWORD
 * (default the seed password). Prints the page title, the h1, any error text and console errors per page.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [outDir, ...paths] = process.argv.slice(2);
  if (!outDir || !paths.length) { console.error("usage: shot.ts <out-dir> <path> [<path> …]"); process.exit(2); }
  const BASE = process.env.BASE ?? "http://localhost:3000";
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "tr-TR" });
  await ctx.addCookies([{ name: "hc_lang", value: "tr", url: BASE }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const r = await page.request.post(`${BASE}/api/auth/login`, { data: { email: process.env.USER_EMAIL ?? "admin@grandanatolia.test", password: process.env.USER_PASSWORD ?? "HotelCost!2026" }, headers: { origin: BASE } });
  if (!r.ok()) { console.error("login failed", r.status(), await r.text()); process.exit(1); }
  for (const p of paths) {
    errors.length = 0;
    const res = await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 120_000 });
    const h1 = await page.locator("h1").first().textContent().catch(() => null);
    const alert = await page.locator("[role=alert]").allTextContents().catch(() => []);
    const file = path.join(outDir, `${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(JSON.stringify({ path: p, status: res?.status(), h1, alerts: alert.filter(Boolean), consoleErrors: errors.slice(0, 5), file }));
  }
  await browser.close();
}

void main();
